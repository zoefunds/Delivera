/**
 * Base Sepolia escrow relay.
 *
 * GenLayer (lib/genlayer.ts) only decides outcomes now — an approved
 * milestone or a resolved dispute is just a status flip in Postgres (mirror
 * of on-chain state, written by routes/contracts.ts's chainAction "after"
 * hooks). Nothing on GenLayer moves money anymore. This job is what
 * actually pays: it polls for decisions that haven't been relayed to the
 * Base Sepolia USDC escrow yet, calls the relevant escrow function, and
 * stamps the resulting tx hash back onto the row so the same decision is
 * never relayed twice — the idempotency guard is the stored *RelayTxHash
 * column itself, so a plain retry sweep over "still null" rows is safe to
 * run on every tick without any separate locking.
 *
 * Amounts: every Milestone/Contract *Atto column is denominated the same
 * way a milestone amount is entered in the "new contract" form — a decimal
 * dollar-equivalent value scaled by 1e18 (see frontend's dollarsToAtto; this is
 * inherited from GenLayer's native-GEN 18-decimal accounting convention,
 * not an actual GEN price). DeliveraEscrow.sol holds real USDC, which is
 * 6-decimal, so every amount relayed to it is rescaled 1e18 -> 1e6 here, in
 * one place. This only rescales *decimal precision* — it assumes 1 unit of
 * *Atto value is meant to equal 1 unit of USDC value (a $100 milestone is
 * stored as 100 * 1e18 and relayed as 100 * 1e6 USDC base units), which
 * matches how the contract-creation form collects the amount (a plain
 * dollar figure, not a GEN price) — see frontend/src/app/dashboard/new/page.tsx.
 */
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { isEscrowConfigured, releaseMilestone, refund, resolveDispute, getRemainingEscrow, isSettlementProcessed, settlementId } from "../services/baseSepolia.js";

const ATTO_TO_USDC_BASE_UNITS = 10n ** 12n; // 1e18 -> 1e6

function attoToUsdcBaseUnits(atto: string | bigint): bigint {
  const value = typeof atto === "string" ? BigInt(atto) : atto;
  return value / ATTO_TO_USDC_BASE_UNITS;
}

/** Relay every APPROVED milestone that hasn't been paid out yet. Safe to
 * call repeatedly: rows with relayTxHash already set are skipped, and a
 * failure on one milestone doesn't stop the others. The freelancer address
 * itself lives on-chain (set once when the client called fundEscrow), so we
 * only need the contractId and the amount here. */
export async function relayApprovedMilestones(): Promise<{ relayed: string[] }> {
  if (!isEscrowConfigured()) return { relayed: [] };
  const pending = await prisma.milestone.findMany({
    where: { status: "APPROVED", relayTxHash: null, contract: { chainContractId: { not: null } } },
    include: { contract: true },
    take: 25,
  });

  const relayed: string[] = [];
  for (const milestone of pending) {
    const { contract } = milestone;
    if (!contract.chainContractId) continue;
    try {
      const amount = attoToUsdcBaseUnits(milestone.amountAtto.toString());
      const sid = settlementId(contract.chainContractId, "release", milestone.index);
      const recovered = await isSettlementProcessed(sid);
      const result = recovered ? { txHash: `RECOVERED:${sid}`, settlementId: sid } : await releaseMilestone(contract.chainContractId, milestone.index, amount);
      const claimed = await prisma.$transaction(async (db) => {
        const row = await db.milestone.updateMany({ where: { id: milestone.id, relayTxHash: null }, data: { relayTxHash: result.txHash } });
        if (row.count === 1) await db.contract.update({ where: { id: contract.id }, data: { releasedAtto: { increment: milestone.amountAtto } } });
        return row;
      });
      if (claimed.count === 0) continue;
      await prisma.transaction.create({
        data: {
          userId: contract.providerId ?? contract.clientId,
          contractId: contract.id,
          kind: "base_relay_release",
          txHash: recovered ? null : result.txHash,
          status: "CONFIRMED",
          payload: { milestoneIndex: milestone.index, amount: amount.toString(), settlementId: sid, recovered },
        },
      });
      relayed.push(milestone.id);
    } catch (err) {
      logger.error(
        { milestoneId: milestone.id, contractId: contract.id, err: (err as Error).message },
        "milestone release relay failed; will retry next sweep",
      );
    }
  }
  return { relayed };
}

/** Refund whatever's left in escrow for a CANCELLED contract, once. The
 * escrow contract sends it back to whichever address originally called
 * fundEscrow — we don't (and can't) name a recipient here.
 *
 * The refund amount comes from the escrow contract's own `remainingEscrow`
 * on-chain read, NOT from Postgres's fundedAtto/releasedAtto/refundedAtto
 * bookkeeping. Those Postgres fields are only ever written by a client
 * hitting the /fund confirm route successfully — if that confirm call fails
 * for any reason (e.g. an expired session token) after the REAL on-chain
 * fundEscrow already succeeded, Postgres never learns the contract was
 * funded, fundedAtto stays 0, and this job would previously conclude there
 * was nothing to refund while real USDC sat stuck in escrow. Reading the
 * actual on-chain balance makes this correct regardless of whether Postgres
 * ever caught up. */
export async function relayCancelledRefunds(): Promise<{ relayed: string[] }> {
  if (!isEscrowConfigured()) return { relayed: [] };
  const candidates = await prisma.contract.findMany({
    where: { status: { in: ["CANCELLED", "COMPLETED"] }, refundRelayTxHash: null, chainContractId: { not: null } },
    include: { milestones: true },
    take: 25,
  });

  const relayed: string[] = [];
  for (const contract of candidates) {
    if (!contract.chainContractId) continue;
    const sid = settlementId(contract.chainContractId, "refund", 0);
    const recovered = await isSettlementProcessed(sid).catch(() => false);
    const expectedRefund = contract.milestones
      .filter((m) => m.relayTxHash === null)
      .reduce((sum, m) => sum + attoToUsdcBaseUnits(m.amountAtto.toString()), 0n);
    let remainingOnChain: bigint;
    try {
      remainingOnChain = BigInt(await getRemainingEscrow(contract.chainContractId));
    } catch (err) {
      logger.error({ contractId: contract.id, err: (err as Error).message }, "could not read remaining escrow; will retry next sweep");
      continue;
    }
    if (remainingOnChain <= 0n && !recovered) {
      // Nothing left on-chain, but still mark it so the sweep stops revisiting it.
      await prisma.contract.update({ where: { id: contract.id }, data: { refundRelayTxHash: "NOOP" } });
      continue;
    }
    try {
      if (!recovered && remainingOnChain !== expectedRefund) {
        throw new Error(`on-chain remaining ${remainingOnChain} does not match unsettled allocation total ${expectedRefund}`);
      }
      const refundAmount = recovered ? expectedRefund : remainingOnChain;
      const result = recovered ? { txHash: `RECOVERED:${sid}`, settlementId: sid } : await refund(contract.chainContractId, refundAmount, "contract_cancelled");
      // Postgres's *Atto columns are 1e18-scaled; the on-chain amount just
      // refunded is 1e6 USDC base units — scale back up for the mirror.
      const refundedAttoDelta = refundAmount * ATTO_TO_USDC_BASE_UNITS;
      await prisma.contract.update({
        where: { id: contract.id },
        data: { refundRelayTxHash: result.txHash, refundedAtto: (BigInt(contract.refundedAtto.toString()) + refundedAttoDelta).toString() },
      });
      await prisma.transaction.create({
        data: {
          userId: contract.clientId,
          contractId: contract.id,
          kind: "base_relay_refund",
          txHash: recovered ? null : result.txHash,
          status: "CONFIRMED",
          payload: { amount: refundAmount.toString(), reason: "contract_cancelled", settlementId: sid, recovered },
        },
      });
      relayed.push(contract.id);
    } catch (err) {
      logger.error(
        { contractId: contract.id, err: (err as Error).message },
        "cancellation refund relay failed; will retry next sweep",
      );
    }
  }
  return { relayed };
}

/** Settle a RESOLVED dispute's remaining escrow, once, in a single atomic
 * on-chain call — `providerBps` (basis points to the provider; the rest
 * goes back to the client) is passed straight through to
 * DeliveraEscrow.resolveDispute, which does the split itself. */
export async function relayResolvedDisputes(): Promise<{ relayed: string[] }> {
  if (!isEscrowConfigured()) return { relayed: [] };
  const disputes = await prisma.dispute.findMany({
    where: { status: "RESOLVED", relayTxHash: null, providerBps: { not: null } },
    include: { contract: true },
    take: 25,
  });

  const relayed: string[] = [];
  for (const dispute of disputes) {
    const { contract } = dispute;
    if (!contract.chainContractId) continue;
    const milestone = await prisma.milestone.findUnique({ where: { contractId_index: { contractId: contract.id, index: dispute.milestoneIndex } } });
    if (!milestone) continue;
    // Never use the contract-wide remaining balance here. GenLayer resolves
    // exactly this unpaid milestone, and the Base contract independently
    // enforces the same immutable allocation.
    const disputedAmount = attoToUsdcBaseUnits(milestone.amountAtto.toString());
    const providerBps = BigInt(dispute.providerBps ?? 0);
    const providerShareUsdc = (disputedAmount * providerBps) / 10_000n;
    const clientShareUsdc = disputedAmount - providerShareUsdc;
    try {
      const disputeIndex = dispute.chainDisputeIndex ?? dispute.milestoneIndex;
      const sid = settlementId(contract.chainContractId, "dispute", disputeIndex);
      const recovered = await isSettlementProcessed(sid);
      const result = recovered
        ? { txHash: `RECOVERED:${sid}`, settlementId: sid }
        : await resolveDispute(contract.chainContractId, disputeIndex, dispute.milestoneIndex, disputedAmount, providerBps);
      const claimed = await prisma.$transaction(async (db) => {
        const row = await db.dispute.updateMany({ where: { id: dispute.id, relayTxHash: null }, data: { relayTxHash: result.txHash } });
        if (row.count === 1) {
          await db.milestone.update({ where: { id: milestone.id }, data: { relayTxHash: result.txHash } });
          await db.contract.update({
            where: { id: contract.id },
            data: {
              releasedAtto: { increment: (providerShareUsdc * ATTO_TO_USDC_BASE_UNITS).toString() },
              refundedAtto: { increment: (clientShareUsdc * ATTO_TO_USDC_BASE_UNITS).toString() },
            },
          });
        }
        return row;
      });
      if (claimed.count === 0) continue;
      await prisma.transaction.create({
        data: {
          userId: contract.providerId ?? contract.clientId,
          contractId: contract.id,
          kind: "base_relay_dispute_resolution",
          txHash: recovered ? null : result.txHash,
          status: "CONFIRMED",
          payload: { milestoneIndex: dispute.milestoneIndex, disputedAmount: disputedAmount.toString(), providerBps: providerBps.toString(), settlementId: sid, recovered },
        },
      });
      relayed.push(dispute.id);
    } catch (err) {
      logger.error({ disputeId: dispute.id, err: (err as Error).message }, "dispute resolution relay failed; will retry next sweep");
    }
  }
  return { relayed };
}

let tickRunning = false;

/** One sweep across every relay kind. Doubles as both the "just decided"
 * fast path and the retry sweep — every function above only ever acts on
 * rows still missing their relay tx hash, so calling this on an interval is
 * the entire retry strategy. */
export async function runRelaySweep(): Promise<void> {
  if (tickRunning) return;
  tickRunning = true;
  try {
    // Run settlement kinds sequentially so two different decisions for the
    // same agreement cannot race each other in the same process tick.
    const milestones = await relayApprovedMilestones();
    const disputes = await relayResolvedDisputes();
    const cancellations = await relayCancelledRefunds();
    if (milestones.relayed.length || cancellations.relayed.length || disputes.relayed.length) {
      logger.info(
        { milestones: milestones.relayed.length, cancellations: cancellations.relayed.length, disputes: disputes.relayed.length },
        "base sepolia relay sweep complete",
      );
    }
  } catch (err) {
    logger.error({ err: (err as Error).message }, "relay sweep failed");
  } finally {
    tickRunning = false;
  }
}

const SWEEP_INTERVAL_MS = 30_000;
let sweepHandle: NodeJS.Timeout | null = null;

/** Start the periodic relay/retry sweep. Called once from server.ts at
 * process start; a no-op (still scheduled, but every relay function short-
 * circuits) when the escrow isn't configured yet. */
export function startRelayJobs(): void {
  if (sweepHandle) return;
  sweepHandle = setInterval(() => void runRelaySweep(), SWEEP_INTERVAL_MS);
  sweepHandle.unref?.();
  void runRelaySweep();
}

export function stopRelayJobs(): void {
  if (sweepHandle) clearInterval(sweepHandle);
  sweepHandle = null;
}

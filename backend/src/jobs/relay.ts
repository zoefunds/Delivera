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
import { isEscrowConfigured, releaseMilestone, refund, resolveDispute, getRemainingEscrow } from "../services/baseSepolia.js";

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
      const txHash = await releaseMilestone(contract.chainContractId, amount);
      await prisma.milestone.update({ where: { id: milestone.id }, data: { relayTxHash: txHash } });
      await prisma.contract.update({
        where: { id: contract.id },
        data: { releasedAtto: (BigInt(contract.releasedAtto.toString()) + BigInt(milestone.amountAtto.toString())).toString() },
      });
      await prisma.transaction.create({
        data: {
          userId: contract.providerId ?? contract.clientId,
          contractId: contract.id,
          kind: "base_relay_release",
          txHash,
          status: "CONFIRMED",
          payload: { milestoneIndex: milestone.index, amount: amount.toString() },
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
    where: { status: "CANCELLED", refundRelayTxHash: null, chainContractId: { not: null } },
    take: 25,
  });

  const relayed: string[] = [];
  for (const contract of candidates) {
    if (!contract.chainContractId) continue;
    let remainingOnChain: bigint;
    try {
      remainingOnChain = BigInt(await getRemainingEscrow(contract.chainContractId));
    } catch (err) {
      logger.error({ contractId: contract.id, err: (err as Error).message }, "could not read remaining escrow; will retry next sweep");
      continue;
    }
    if (remainingOnChain <= 0n) {
      // Nothing left on-chain, but still mark it so the sweep stops revisiting it.
      await prisma.contract.update({ where: { id: contract.id }, data: { refundRelayTxHash: "NOOP" } });
      continue;
    }
    try {
      const txHash = await refund(contract.chainContractId, "contract_cancelled");
      // Postgres's *Atto columns are 1e18-scaled; the on-chain amount just
      // refunded is 1e6 USDC base units — scale back up for the mirror.
      const refundedAttoDelta = remainingOnChain * ATTO_TO_USDC_BASE_UNITS;
      await prisma.contract.update({
        where: { id: contract.id },
        data: { refundRelayTxHash: txHash, refundedAtto: (BigInt(contract.refundedAtto.toString()) + refundedAttoDelta).toString() },
      });
      await prisma.transaction.create({
        data: {
          userId: contract.clientId,
          contractId: contract.id,
          kind: "base_relay_refund",
          txHash,
          status: "CONFIRMED",
          payload: { amount: remainingOnChain.toString(), reason: "contract_cancelled" },
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
    let remainingOnChain: bigint;
    try {
      remainingOnChain = BigInt(await getRemainingEscrow(contract.chainContractId));
    } catch (err) {
      logger.error({ disputeId: dispute.id, err: (err as Error).message }, "could not read remaining escrow; will retry next sweep");
      continue;
    }
    if (remainingOnChain <= 0n) {
      await prisma.dispute.update({ where: { id: dispute.id }, data: { relayTxHash: "NOOP" } });
      continue;
    }
    const providerBps = BigInt(dispute.providerBps ?? 0);
    const providerShareUsdc = (remainingOnChain * providerBps) / 10_000n;
    const clientShareUsdc = remainingOnChain - providerShareUsdc;
    try {
      const txHash = await resolveDispute(contract.chainContractId, remainingOnChain, providerBps);
      await prisma.dispute.update({ where: { id: dispute.id }, data: { relayTxHash: txHash } });
      await prisma.contract.update({
        where: { id: contract.id },
        data: {
          releasedAtto: (BigInt(contract.releasedAtto.toString()) + providerShareUsdc * ATTO_TO_USDC_BASE_UNITS).toString(),
          refundedAtto: (BigInt(contract.refundedAtto.toString()) + clientShareUsdc * ATTO_TO_USDC_BASE_UNITS).toString(),
        },
      });
      await prisma.transaction.create({
        data: {
          userId: contract.providerId ?? contract.clientId,
          contractId: contract.id,
          kind: "base_relay_dispute_resolution",
          txHash,
          status: "CONFIRMED",
          payload: { disputedAmount: remainingOnChain.toString(), providerBps: providerBps.toString() },
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
    const [milestones, cancellations, disputes] = await Promise.all([
      relayApprovedMilestones(),
      relayCancelledRefunds(),
      relayResolvedDisputes(),
    ]);
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

/**
 * Base Sepolia payment layer.
 *
 * GenLayer (lib/genlayer.ts) is the adjudication layer only — it decides
 * whether a milestone is approved or how a dispute is resolved, but it never
 * moves real money anymore. Real USDC escrow lives in DeliveraEscrow
 * (contracts/base/DeliveraEscrow.sol) on Base Sepolia. This module is the
 * only place that talks to that contract: turning a GenLayer
 * chainContractId into the escrow's bytes32 key, and relaying a decision
 * (milestone release / refund / dispute split) exactly once.
 *
 * The freelancer address and running funded/released/refunded totals for a
 * contractId live entirely on-chain (set once at fundEscrow time by the
 * client themselves) — releaseMilestone/refund/resolveDispute below take no
 * address of their own, matching the deployed contract's actual signatures.
 */
import { ethers } from "ethers";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { DELIVERA_ESCROW_ABI, ERC20_ABI } from "../lib/escrowAbi.js";

let provider: ethers.JsonRpcProvider | null = null;
let relayerWallet: ethers.Wallet | null = null;
let escrowContract: ethers.Contract | null = null;
let authorityWallet: ethers.Wallet | null = null;
let keyConfigurationVerified = false;

function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(config.BASE_SEPOLIA_RPC_URL);
  }
  return provider;
}

export function isEscrowConfigured(): boolean {
  return Boolean(config.DELIVERA_ESCROW_ADDRESS && config.BASE_SEPOLIA_RELAYER_PRIVATE_KEY && config.BASE_SEPOLIA_DECISION_AUTHORITY_PRIVATE_KEY);
}

function getAuthorityWallet(): ethers.Wallet {
  if (!config.BASE_SEPOLIA_DECISION_AUTHORITY_PRIVATE_KEY) throw new Error("BASE_SEPOLIA_DECISION_AUTHORITY_PRIVATE_KEY is not configured");
  authorityWallet ??= new ethers.Wallet(config.BASE_SEPOLIA_DECISION_AUTHORITY_PRIVATE_KEY);
  return authorityWallet;
}

function getRelayerContract(): ethers.Contract {
  if (!config.DELIVERA_ESCROW_ADDRESS) {
    throw new Error("DELIVERA_ESCROW_ADDRESS is not configured");
  }
  if (!config.BASE_SEPOLIA_RELAYER_PRIVATE_KEY) {
    throw new Error("BASE_SEPOLIA_RELAYER_PRIVATE_KEY is not configured");
  }
  if (!escrowContract) {
    relayerWallet = new ethers.Wallet(config.BASE_SEPOLIA_RELAYER_PRIVATE_KEY, getProvider());
    escrowContract = new ethers.Contract(config.DELIVERA_ESCROW_ADDRESS, DELIVERA_ESCROW_ABI, relayerWallet);
  }
  return escrowContract;
}

/** Read-only contract instance, no signer required. */
function getReadContract(): ethers.Contract {
  if (!config.DELIVERA_ESCROW_ADDRESS) {
    throw new Error("DELIVERA_ESCROW_ADDRESS is not configured");
  }
  return new ethers.Contract(config.DELIVERA_ESCROW_ADDRESS, DELIVERA_ESCROW_ABI, getProvider());
}

async function assertEscrowKeyConfiguration(): Promise<void> {
  if (keyConfigurationVerified) return;
  const read = getReadContract();
  const relayer = new ethers.Wallet(config.BASE_SEPOLIA_RELAYER_PRIVATE_KEY).address;
  const authority = getAuthorityWallet().address;
  const [configuredRelayer, configuredAuthority] = await Promise.all([read.relayer(), read.decisionAuthority()]);
  if ((configuredRelayer as string).toLowerCase() !== relayer.toLowerCase()) {
    throw new Error("configured relayer key does not match DeliveraEscrow.relayer()");
  }
  if ((configuredAuthority as string).toLowerCase() !== authority.toLowerCase()) {
    throw new Error("configured decision-authority key does not match DeliveraEscrow.decisionAuthority()");
  }
  if (relayer.toLowerCase() === authority.toLowerCase()) {
    throw new Error("relayer and decision authority must be distinct keys");
  }
  keyConfigurationVerified = true;
}

/** GenLayer chainContractId values are opaque strings; the escrow contract
 * keys balances by bytes32, so hash the id deterministically the same way
 * everywhere it's used (backend and frontend both call this — see
 * frontend/src/lib/escrow.ts). */
export function contractIdToBytes32(chainContractId: string): string {
  return ethers.id(chainContractId);
}

/**
 * Release `amount` (USDC base units) from a contract's escrow to whichever
 * freelancer address was locked in at fundEscrow time. Callers are
 * responsible for idempotency (only call once per milestone — see
 * jobs/relay.ts, which gates on a stored relayTxHash before ever calling
 * this).
 */
export function settlementId(chainContractId: string, kind: "release" | "dispute" | "refund", index: number): string {
  return ethers.id(`${chainContractId}:${kind}:${index}`);
}

async function signSettlement(chainContractId: string, id: string, action: number, index: bigint, amount: bigint, bps: bigint) {
  await assertEscrowKeyConfiguration();
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const digest = await getReadContract().settlementDigest(id, contractIdToBytes32(chainContractId), action, index, amount, bps, deadline);
  return { deadline, signature: await getAuthorityWallet().signMessage(ethers.getBytes(digest)) };
}

export async function createFundingAuthorization(
  chainContractId: string, client: string, freelancer: string, allocations: bigint[],
): Promise<{ deadline: string; signature: string }> {
  await assertEscrowKeyConfiguration();
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const digest = await getReadContract().fundingDigest(contractIdToBytes32(chainContractId), client, freelancer, allocations, deadline);
  return { deadline: deadline.toString(), signature: await getAuthorityWallet().signMessage(ethers.getBytes(digest)) };
}

export async function releaseMilestone(chainContractId: string, milestoneIndex: number, amountUsdc: bigint): Promise<{ txHash: string; settlementId: string }> {
  const contract = getRelayerContract();
  const key = contractIdToBytes32(chainContractId);
  const id = settlementId(chainContractId, "release", milestoneIndex);
  const auth = await signSettlement(chainContractId, id, 1, BigInt(milestoneIndex), amountUsdc, 10_000n);
  const tx = await contract.releaseMilestone(key, id, milestoneIndex, amountUsdc, auth.deadline, auth.signature);
  logger.info(
    { chainContractId, amount: amountUsdc.toString(), txHash: tx.hash },
    "relaying milestone release to Base Sepolia escrow",
  );
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`releaseMilestone transaction failed for contract ${chainContractId}`);
  }
  return { txHash: tx.hash as string, settlementId: id };
}

/**
 * Refund whatever remains in a contract's escrow back to the client address
 * that funded it (the contract itself tracks who that was). Same
 * idempotency contract as releaseMilestone.
 */
export async function refund(chainContractId: string, amount: bigint, reason: string): Promise<{ txHash: string; settlementId: string }> {
  const contract = getRelayerContract();
  const key = contractIdToBytes32(chainContractId);
  const id = settlementId(chainContractId, "refund", 0);
  const auth = await signSettlement(chainContractId, id, 3, ethers.MaxUint256, amount, 0n);
  const tx = await contract.refund(key, id, amount, reason, auth.deadline, auth.signature);
  logger.info({ chainContractId, reason, txHash: tx.hash }, "relaying refund to Base Sepolia escrow");
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`refund transaction failed for contract ${chainContractId}`);
  }
  return { txHash: tx.hash as string, settlementId: id };
}

/**
 * Settle a resolved dispute atomically: `disputedAmount` (USDC base units)
 * of the remaining escrow is split providerBps/10000 to the freelancer and
 * the rest back to the client, in a single on-chain call — matching
 * GenLayer's resolve_dispute bps split exactly.
 */
export async function resolveDispute(
  chainContractId: string,
  disputeIndex: number,
  milestoneIndex: number,
  disputedAmountUsdc: bigint,
  providerBps: bigint,
): Promise<{ txHash: string; settlementId: string }> {
  const contract = getRelayerContract();
  const key = contractIdToBytes32(chainContractId);
  const id = settlementId(chainContractId, "dispute", disputeIndex);
  const auth = await signSettlement(chainContractId, id, 2, BigInt(milestoneIndex), disputedAmountUsdc, providerBps);
  const tx = await contract.resolveDispute(key, id, milestoneIndex, disputedAmountUsdc, providerBps, auth.deadline, auth.signature);
  logger.info(
    { chainContractId, disputedAmount: disputedAmountUsdc.toString(), providerBps: providerBps.toString(), txHash: tx.hash },
    "relaying dispute resolution to Base Sepolia escrow",
  );
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`resolveDispute transaction failed for contract ${chainContractId}`);
  }
  return { txHash: tx.hash as string, settlementId: id };
}

export async function isSettlementProcessed(id: string): Promise<boolean> {
  return Boolean(await getReadContract().processedSettlements(id));
}

/**
 * Verify that a client-submitted transaction hash is a real, confirmed
 * `EscrowFunded` event on our escrow contract for this contractId, naming
 * the expected freelancer and depositing at least `minAmountUsdc`. Used by
 * the `/fund` route so flipping a contract to FUNDED requires proof of an
 * actual on-chain USDC deposit rather than trusting the caller's claim.
 */
export async function verifyEscrowFunded(
  chainContractId: string,
  txHash: string,
  clientAddress: string,
  freelancerAddress: string,
  expectedAmountUsdc: bigint,
  expectedAllocations: bigint[],
): Promise<{ ok: boolean; amount?: bigint; reason?: string }> {
  if (!config.DELIVERA_ESCROW_ADDRESS) return { ok: false, reason: "escrow not configured" };
  const receipt = await getProvider().getTransactionReceipt(txHash);
  if (!receipt || receipt.status !== 1) return { ok: false, reason: "transaction not found or failed" };
  // Deliberately NOT checking receipt.to === escrow address here: some
  // wallets (e.g. MetaMask's transaction relay/"Smart Transactions") submit
  // the outer transaction to their own relay/forwarder contract, which then
  // internally calls the real target — the outer `to` is the relay, not the
  // escrow, even though the escrow's own EscrowFunded event fires correctly.
  // The log check below (matching the actual event, emitted by the actual
  // escrow contract, with the actual contractId/freelancer/amount) is the
  // real proof of funding — checking the outer `to` on top of that only
  // produces false positives on legitimate relayed transactions.
  const key = contractIdToBytes32(chainContractId);
  const iface = new ethers.Interface(DELIVERA_ESCROW_ABI);
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== config.DELIVERA_ESCROW_ADDRESS.toLowerCase()) continue;
    let parsed;
    try {
      parsed = iface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed?.name !== "EscrowFunded") continue;
    if (parsed.args.contractId !== key) continue;
    if ((parsed.args.client as string).toLowerCase() !== clientAddress.toLowerCase()) {
      return { ok: false, reason: "funding wallet does not match the registered GenLayer client" };
    }
    if ((parsed.args.freelancer as string).toLowerCase() !== freelancerAddress.toLowerCase()) {
      return { ok: false, reason: "freelancer address on-chain does not match this contract's provider" };
    }
    const amount = parsed.args.amount as bigint;
    if (amount !== expectedAmountUsdc) {
      return { ok: false, reason: `deposited amount ${amount} does not equal expected ${expectedAmountUsdc}` };
    }
    const expectedAllocationHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256[]"], [expectedAllocations]));
    if ((parsed.args.allocationHash as string).toLowerCase() !== expectedAllocationHash.toLowerCase()) {
      return { ok: false, reason: "on-chain milestone allocation commitment does not match the agreement" };
    }
    return { ok: true, amount };
  }
  return { ok: false, reason: "no matching EscrowFunded event found in this transaction" };
}

export async function getRemainingEscrow(chainContractId: string): Promise<string> {
  const contract = getReadContract();
  const key = contractIdToBytes32(chainContractId);
  const remaining = await contract.remainingEscrow(key);
  return (remaining as bigint).toString();
}

/** A wallet's own USDC balance on Base Sepolia (base units, 6 decimals). */
export async function getWalletUsdcBalance(address: string): Promise<string> {
  const usdc = new ethers.Contract(config.BASE_SEPOLIA_USDC_ADDRESS, ERC20_ABI, getProvider());
  const balance = await usdc.balanceOf(address);
  return (balance as bigint).toString();
}

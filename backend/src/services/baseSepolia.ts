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

function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(config.BASE_SEPOLIA_RPC_URL);
  }
  return provider;
}

export function isEscrowConfigured(): boolean {
  return Boolean(config.DELIVERA_ESCROW_ADDRESS && config.BASE_SEPOLIA_RELAYER_PRIVATE_KEY);
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
export async function releaseMilestone(chainContractId: string, amountUsdc: bigint): Promise<string> {
  const contract = getRelayerContract();
  const key = contractIdToBytes32(chainContractId);
  const tx = await contract.releaseMilestone(key, amountUsdc);
  logger.info(
    { chainContractId, amount: amountUsdc.toString(), txHash: tx.hash },
    "relaying milestone release to Base Sepolia escrow",
  );
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`releaseMilestone transaction failed for contract ${chainContractId}`);
  }
  return tx.hash as string;
}

/**
 * Refund whatever remains in a contract's escrow back to the client address
 * that funded it (the contract itself tracks who that was). Same
 * idempotency contract as releaseMilestone.
 */
export async function refund(chainContractId: string, reason: string): Promise<string> {
  const contract = getRelayerContract();
  const key = contractIdToBytes32(chainContractId);
  const tx = await contract.refund(key, reason);
  logger.info({ chainContractId, reason, txHash: tx.hash }, "relaying refund to Base Sepolia escrow");
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`refund transaction failed for contract ${chainContractId}`);
  }
  return tx.hash as string;
}

/**
 * Settle a resolved dispute atomically: `disputedAmount` (USDC base units)
 * of the remaining escrow is split providerBps/10000 to the freelancer and
 * the rest back to the client, in a single on-chain call — matching
 * GenLayer's resolve_dispute bps split exactly.
 */
export async function resolveDispute(
  chainContractId: string,
  disputedAmountUsdc: bigint,
  providerBps: bigint,
): Promise<string> {
  const contract = getRelayerContract();
  const key = contractIdToBytes32(chainContractId);
  const tx = await contract.resolveDispute(key, disputedAmountUsdc, providerBps);
  logger.info(
    { chainContractId, disputedAmount: disputedAmountUsdc.toString(), providerBps: providerBps.toString(), txHash: tx.hash },
    "relaying dispute resolution to Base Sepolia escrow",
  );
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`resolveDispute transaction failed for contract ${chainContractId}`);
  }
  return tx.hash as string;
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
  freelancerAddress: string,
  minAmountUsdc: bigint,
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
    if ((parsed.args.freelancer as string).toLowerCase() !== freelancerAddress.toLowerCase()) {
      return { ok: false, reason: "freelancer address on-chain does not match this contract's provider" };
    }
    const amount = parsed.args.amount as bigint;
    if (amount < minAmountUsdc) {
      return { ok: false, reason: `deposited amount ${amount} is less than expected ${minAmountUsdc}` };
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

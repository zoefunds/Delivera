/**
 * GenLayer client — signs contract reads/writes with the user's custodial
 * wallet via genlayer-js against StudioNet.
 */
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import type { Address, CalldataEncodable, TransactionStatus } from "genlayer-js/types";
import { config } from "../config.js";
import { logger } from "./logger.js";

export function contractConfigured(): boolean {
  return config.GENLAYER_CONTRACT_ADDRESS.length > 0;
}

function clientFor(privateKey?: string) {
  const account = privateKey ? createAccount(privateKey as `0x${string}`) : undefined;
  return createClient({ chain: studionet, account });
}

export async function readContract(method: string, args: unknown[]): Promise<unknown> {
  const client = clientFor();
  return client.readContract({
    address: config.GENLAYER_CONTRACT_ADDRESS as Address,
    functionName: method,
    args: args as CalldataEncodable[],
  });
}

/** GenVM wraps a method's return value as { raw, status, payload: { raw, readable } }
 *  where `readable` is a JSON-encoded string of the actual return value. Decode it back
 *  to a plain JS value (string/number/etc). Falls back to the raw wrapper if the shape
 *  doesn't match what we expect. */
function decodeGenvmResult(raw: unknown): unknown {
  if (raw == null || typeof raw === "string" || typeof raw === "number") return raw;
  const obj = raw as Record<string, unknown>;
  const payload = obj.payload as Record<string, unknown> | undefined;
  if (obj.status === "return" && typeof payload?.readable === "string") {
    try {
      return JSON.parse(payload.readable);
    } catch {
      return payload.readable;
    }
  }
  return raw;
}

export async function writeContract(
  privateKey: string,
  method: string,
  args: unknown[],
): Promise<{ txHash: string; status: string; result?: unknown }> {
  const client = clientFor(privateKey);
  const txHash = await client.writeContract({
    address: config.GENLAYER_CONTRACT_ADDRESS as Address,
    functionName: method,
    args: args as CalldataEncodable[],
    value: 0n,
  });
  logger.info({ method, txHash }, "genlayer tx submitted");
  const receipt = (await client.waitForTransactionReceipt({
    hash: txHash,
    status: "ACCEPTED" as TransactionStatus,
    retries: 40,
    interval: 3000,
  })) as Record<string, unknown>;

  // Surface the contract method's return value; receipt shape varies by
  // genlayer-js version, so probe the known locations defensively.
  const consensusData = receipt?.consensus_data as Record<string, unknown> | undefined;
  const leaderReceiptRaw = consensusData?.leader_receipt;
  const leaderReceipt = (
    Array.isArray(leaderReceiptRaw) ? leaderReceiptRaw[0] : leaderReceiptRaw
  ) as Record<string, unknown> | undefined;
  // NB: top-level receipt.result is a consensus vote code (e.g. 6 = MAJORITY_AGREE),
  // not the contract's return value — the actual payload only lives on the leader receipt.
  const rawResult = leaderReceipt?.result as unknown;

  if (leaderReceipt?.execution_result === "ERROR") {
    const stderr = (leaderReceipt?.genvm_result as Record<string, unknown> | undefined)?.stderr;
    logger.error({ method, txHash, stderr }, "genlayer contract execution error");
    throw new Error(`Contract method ${method} failed on-chain: ${String(stderr ?? "unknown error").slice(-500)}`);
  }

  return {
    txHash: String(txHash),
    status: String(receipt?.status_name ?? receipt?.status ?? "UNKNOWN"),
    result: decodeGenvmResult(rawResult),
  };
}

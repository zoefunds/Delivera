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

/**
 * Polls `readContract(method, args)` until `predicate(value)` is true.
 *
 * Used to confirm a write the FRONTEND already submitted (signed with the
 * user's own wallet) actually landed — reads can lag a few seconds behind a
 * transaction reaching ACCEPTED consensus on GenLayer StudioNet, so a single
 * read right after the frontend's write can still see stale state.
 */
export async function readUntilFound<T>(
  method: string,
  args: unknown[],
  predicate: (value: T) => boolean,
  opts: { retries?: number; interval?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 20;
  const interval = opts.interval ?? 3000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const value = (await readContract(method, args)) as T;
      if (predicate(value)) return value;
    } catch (err) {
      lastErr = err;
      logger.warn({ method, attempt, err }, "readUntilFound: read failed, will retry");
    }
    if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, interval));
  }
  const seconds = Math.round((retries * interval) / 1000);
  const detail = lastErr instanceof Error ? `; last error: ${lastErr.message}` : "";
  throw new Error(
    `Timed out after ${seconds}s waiting for ${method} to reflect the expected on-chain state${detail}`,
  );
}

export async function writeContract(
  privateKey: string,
  method: string,
  args: unknown[],
  opts: { valueAtto?: bigint; waitFor?: "ACCEPTED" | "FINALIZED" } = {},
): Promise<{ txHash: string; status: string; result?: unknown }> {
  const client = clientFor(privateKey);
  const txHash = await client.writeContract({
    address: config.GENLAYER_CONTRACT_ADDRESS as Address,
    functionName: method,
    args: args as CalldataEncodable[],
    value: opts.valueAtto ?? 0n,
  });
  logger.info({ method, txHash, value: opts.valueAtto?.toString() }, "genlayer tx submitted");
  // Real GEN transfers (emit_transfer, e.g. in `withdraw`) only land once the
  // transaction reaches FINALIZED — ACCEPTED just means consensus was reached
  // on the state change, not that the appeal window has closed. FINALIZED
  // takes noticeably longer; only wait for it where the caller needs the
  // payout to have actually arrived.
  const waitFor = (opts.waitFor ?? "ACCEPTED") as TransactionStatus;
  const receipt = (await client.waitForTransactionReceipt({
    hash: txHash,
    status: waitFor,
    retries: waitFor === "FINALIZED" ? 200 : 40,
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

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
  const leaderReceipt = (consensusData?.leader_receipt ?? {}) as Record<string, unknown>;
  const rawResult =
    (receipt?.result as unknown) ??
    (leaderReceipt?.result as unknown) ??
    (Array.isArray(leaderReceipt) ? (leaderReceipt[0] as Record<string, unknown>)?.result : undefined);

  return {
    txHash: String(txHash),
    status: String(receipt?.status_name ?? receipt?.status ?? "UNKNOWN"),
    result: rawResult,
  };
}

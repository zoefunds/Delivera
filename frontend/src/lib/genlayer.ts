"use client";

/**
 * GenLayer StudioNet writes, signed by the connected wallet — no custodial
 * key anywhere in this file. The wallet the user already connected via
 * SIWE (and uses to fund escrow in USDC on Base Sepolia, see ./escrow.ts)
 * is the same wallet that signs these GenLayer transactions: `createClient`
 * is given the wallet's address plus its raw EIP-1193 provider, so
 * genlayer-js delegates signing to the wallet extension instead of using a
 * local private key.
 */
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

/** Must match backend/.env's GENLAYER_CONTRACT_ADDRESS — see
 * frontend/.env.example. TODO: confirm this stays in sync with whatever
 * the backend team deploys; there is no server-side source of truth the
 * frontend can read this from at build time. */
export const GENLAYER_CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS ||
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

const STUDIONET_CHAIN_ID_HEX = `0x${studionet.id.toString(16)}`;

/** Minimal shape of an EIP-1193 provider — what AppKit's `walletProvider`
 * (from useAppKitProvider("eip155")) actually is. Same shape used by
 * ensureBaseSepolia in ./escrow.ts. */
interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

async function currentChainId(eth: Eip1193Provider): Promise<string> {
  return ((await eth.request({ method: "eth_chainId" })) as string).toLowerCase();
}

async function addStudioNetwork(eth: Eip1193Provider): Promise<void> {
  await eth.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: STUDIONET_CHAIN_ID_HEX,
        chainName: studionet.name,
        nativeCurrency: studionet.nativeCurrency,
        rpcUrls: studionet.rpcUrls.default.http,
        blockExplorerUrls: studionet.blockExplorers?.default
          ? [studionet.blockExplorers.default.url]
          : undefined,
      },
    ],
  });
}

/**
 * Force the connected wallet onto GenLayer StudioNet before signing any
 * contract write — mirrors ensureBaseSepolia in ./escrow.ts exactly: try
 * wallet_switchEthereumChain, re-check the wallet's actual active chain
 * (some wallets silently no-op the switch instead of throwing), and only
 * if it's still wrong, add the network and retry the switch.
 */
export async function ensureStudioNetwork(eip1193: Eip1193Provider): Promise<void> {
  if ((await currentChainId(eip1193)) === STUDIONET_CHAIN_ID_HEX) return;

  try {
    await eip1193.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: STUDIONET_CHAIN_ID_HEX }],
    });
  } catch {
    // Handled uniformly below: try adding it regardless of error shape.
  }

  if ((await currentChainId(eip1193)) === STUDIONET_CHAIN_ID_HEX) return;

  await addStudioNetwork(eip1193);
  await eip1193.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: STUDIONET_CHAIN_ID_HEX }],
  });

  if ((await currentChainId(eip1193)) !== STUDIONET_CHAIN_ID_HEX) {
    throw new Error("Please switch your wallet to the GenLayer Studio network to continue.");
  }
}

/**
 * Sign and submit a GenLayer intelligent-contract write with the connected
 * wallet. Returns just the tx hash — deliberately does NOT wait for or
 * parse a transaction receipt in the browser: `client.waitForTransactionReceipt`
 * reliably fails from the browser due to CORS on GenLayer Studio's API
 * (studio.genlayer.com/api sends no browser-facing CORS headers), so the
 * write is fire-and-forget from the frontend's perspective. The caller
 * follows up with a backend confirm endpoint that re-reads chain state
 * server-side (no CORS involved there) as the real source of truth.
 */
export async function genlayerWrite(
  eip1193: Eip1193Provider,
  address: string,
  functionName: string,
  args: unknown[],
): Promise<string> {
  await ensureStudioNetwork(eip1193);
  const client = createClient({
    chain: studionet,
    account: address as `0x${string}`,
    provider: eip1193 as never,
  });
  const hash = await client.writeContract({
    address: GENLAYER_CONTRACT_ADDRESS,
    functionName,
    args: args as never[],
    value: 0n,
  });
  return String(hash);
}

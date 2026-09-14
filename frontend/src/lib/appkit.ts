"use client";

import { createAppKit } from "@reown/appkit/react";
import { EthersAdapter } from "@reown/appkit-adapter-ethers";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { studionet } from "genlayer-js/chains";

export const baseSepolia: AppKitNetwork = {
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://sepolia.base.org"] },
  },
  blockExplorers: {
    default: { name: "Basescan", url: "https://sepolia.basescan.org" },
  },
  testnet: true,
};

// AppKit intercepts every network switch itself and only offers whatever's
// in its own `networks` list — a raw wallet_switchEthereumChain/
// wallet_addEthereumChain call from ensureStudioNetwork() (lib/genlayer.ts)
// gets overridden by AppKit's own "Switch Network" dialog if StudioNet isn't
// registered here too, which is why that dialog was only ever offering Base
// Sepolia. Both chains a Delivera wallet ever needs to sign on must be
// declared up front.
export const genlayerStudioNet: AppKitNetwork = {
  id: studionet.id,
  name: studionet.name,
  nativeCurrency: studionet.nativeCurrency,
  rpcUrls: studionet.rpcUrls,
  blockExplorers: studionet.blockExplorers,
  testnet: true,
};

export const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";

export const usdcAddress =
  process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const metadata = {
  name: "Delivera",
  description: "Escrow that releases itself.",
  url: typeof window !== "undefined" ? window.location.origin : "https://delivera.app",
  icons: ["/icon.svg"],
};

let initialized = false;

export function initAppKit() {
  if (initialized || typeof window === "undefined") return;
  if (!projectId) {
    console.warn("NEXT_PUBLIC_REOWN_PROJECT_ID is not set — wallet connect will not work.");
    return;
  }
  createAppKit({
    adapters: [new EthersAdapter()],
    networks: [baseSepolia, genlayerStudioNet],
    defaultNetwork: baseSepolia,
    metadata,
    projectId,
    // Coinbase Wallet and "Base Account" (Coinbase's passkey-based ERC-4337
    // smart wallet) are both on by default in this adapter. A smart wallet
    // routes every transaction through its own on-chain proxy/EntryPoint
    // contract, so the mined transaction's `to` is that proxy, not whatever
    // address the app actually asked to call — this broke escrow funding
    // (an approve/fundEscrow call landing on an unrelated real contract
    // instead of USDC/DeliveraEscrow). Delivera needs a plain EOA signing
    // directly, so only real injected wallets (MetaMask etc., via EIP-6963)
    // and WalletConnect are offered.
    enableCoinbase: false,
    enableBaseAccount: false,
    features: {
      analytics: false,
      email: false,
      socials: [],
    },
  });
  initialized = true;
}

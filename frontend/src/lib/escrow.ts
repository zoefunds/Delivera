"use client";

import { AbiCoder, BrowserProvider, Contract, getAddress, isAddress, keccak256, ZeroAddress } from "ethers";

const BASE_SEPOLIA_CHAIN_ID_HEX = "0x14a34"; // 84532

/** Minimal shape of an EIP-1193 provider — what AppKit's `walletProvider`
 * (from useAppKitProvider("eip155")) actually is. Talking to it directly via
 * `.request()`, rather than through an ethers BrowserProvider wrapper, for
 * the network switch avoids ethers' own network-caching behavior getting in
 * the way (a BrowserProvider detects and caches the chain on first use, and
 * reusing the same instance across a chain switch can leave it working off
 * stale network state) — same as Meme-olympics'/Event-Weaver's
 * ensureBaseSepolia(), which this mirrors. */
interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

/**
 * Force the connected wallet onto Base Sepolia before sending any escrow
 * transaction. AppKit only declares Base Sepolia as a network, but that
 * doesn't stop a wallet that's manually set to a different chain (e.g. still
 * on GenLayer Studio from a prior session) from happily signing and
 * submitting a transaction there instead — try wallet_switchEthereumChain,
 * and if the wallet still isn't on the right chain afterwards (some wallets
 * silently no-op instead of throwing when the chain isn't added yet), fall
 * back to wallet_addEthereumChain and retry the switch.
 */
export async function ensureBaseSepolia(eip1193: Eip1193Provider): Promise<void> {
  const currentChainId = async () => ((await eip1193.request({ method: "eth_chainId" })) as string).toLowerCase();
  if ((await currentChainId()) === BASE_SEPOLIA_CHAIN_ID_HEX) return;

  try {
    await eip1193.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_SEPOLIA_CHAIN_ID_HEX }] });
  } catch {
    // Handled uniformly below: try adding it regardless of error shape.
  }
  if ((await currentChainId()) === BASE_SEPOLIA_CHAIN_ID_HEX) return;

  await eip1193.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: BASE_SEPOLIA_CHAIN_ID_HEX,
        chainName: "Base Sepolia",
        nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: ["https://sepolia.base.org"],
        blockExplorerUrls: ["https://sepolia.basescan.org"],
      },
    ],
  });
  await eip1193.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_SEPOLIA_CHAIN_ID_HEX }] });

  if ((await currentChainId()) !== BASE_SEPOLIA_CHAIN_ID_HEX) {
    throw new Error("Please switch your wallet to the Base Sepolia network to continue.");
  }
}

/** Must match backend/src/lib/escrowAbi.ts and contracts/base/contracts/DeliveraEscrow.sol exactly. */
export const DELIVERA_ESCROW_ABI = [
  "function fundEscrow(bytes32 contractId, address freelancer, uint256[] allocations, uint256 deadline, bytes authoritySignature) external",
  "function recoverUnconfirmedFunding(bytes32 contractId) external",
  "function remainingEscrow(bytes32 contractId) external view returns (uint256)",
] as const;

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
] as const;

/** Deployment-aware key shared with the backend. Raw agreement counters are
 * only unique inside one Intelligent Contract deployment. */
export function contractIdToBytes32(chainContractId: string, genLayerContractAddress: string, genLayerChainId = 61999): string {
  if (!isAddress(genLayerContractAddress) || genLayerContractAddress === ZeroAddress) {
    throw new Error("The GenLayer contract address is not configured");
  }
  return keccak256(AbiCoder.defaultAbiCoder().encode(
    ["string", "uint256", "address", "string"],
    ["DELIVERA_AGREEMENT_V1", genLayerChainId, getAddress(genLayerContractAddress), chainContractId],
  ));
}

/**
 * Confirms a transaction actually succeeded. Deliberately does NOT check
 * `receipt.to` against the address we asked the wallet to call: some
 * wallets (e.g. MetaMask's transaction relay / "Smart Transactions")
 * legitimately submit the outer transaction to their own relay/forwarder
 * contract, which then executes the real call internally via a signed
 * meta-transaction — the outer `to` is the relay, not our contract, even
 * though the intended effect (approve/fundEscrow) happens correctly. The
 * backend's /contracts/:id/fund confirms the real effect by matching the
 * escrow's own EscrowFunded event in the logs, which is unaffected by
 * whichever relay path the wallet chose to route through.
 */
function assertConfirmed(receipt: { status: number | null; hash: string } | null, label: string): void {
  if (!receipt || receipt.status !== 1) {
    throw new Error(`${label} transaction did not confirm on-chain`);
  }
}

/**
 * Fund a contract's escrow for real: approve the escrow contract to pull
 * `amountUsdc` (6-decimal USDC base units) from the connected wallet if the
 * current allowance is insufficient, then call fundEscrow. Returns the
 * fundEscrow transaction hash — the caller (contract detail page) sends
 * this to the backend's /contracts/:id/fund, which verifies the matching
 * on-chain EscrowFunded event before mirroring the contract as FUNDED.
 *
 * Takes the raw EIP-1193 provider (not a pre-built ethers BrowserProvider):
 * ensureBaseSepolia needs to talk to it directly, and a fresh
 * BrowserProvider is constructed only after the network switch so ethers
 * never works off network state cached before the switch happened.
 */
export async function fundEscrowOnChain(
  eip1193: Eip1193Provider,
  escrowAddress: string,
  usdcAddress: string,
  escrowKey: string,
  freelancerAddress: string,
  allocations: bigint[],
  deadline: bigint,
  authoritySignature: string,
): Promise<string> {
  const amountUsdc = allocations.reduce((sum, amount) => sum + amount, 0n);
  await ensureBaseSepolia(eip1193);
  const browserProvider = new BrowserProvider(eip1193 as ConstructorParameters<typeof BrowserProvider>[0]);
  const signer = await browserProvider.getSigner();
  const owner = await signer.getAddress();

  const usdc = new Contract(usdcAddress, ERC20_ABI, signer);
  const allowance: bigint = await usdc.allowance(owner, escrowAddress);
  if (allowance < amountUsdc) {
    const approveTx = await usdc.approve(escrowAddress, amountUsdc);
    const approveReceipt = await approveTx.wait();
    assertConfirmed(approveReceipt, "USDC approve");
  }

  const escrow = new Contract(escrowAddress, DELIVERA_ESCROW_ABI, signer);
  const tx = await escrow.fundEscrow(escrowKey, freelancerAddress, allocations, deadline, authoritySignature);
  const receipt = await tx.wait();
  assertConfirmed(receipt, "fundEscrow");
  return tx.hash as string;
}

/** Recover a deposit only when the escrow itself proves it was never
 * activated and the seven-day confirmation deadline has elapsed. */
export async function recoverUnconfirmedFundingOnChain(
  eip1193: Eip1193Provider,
  escrowAddress: string,
  escrowKey: string,
): Promise<string> {
  await ensureBaseSepolia(eip1193);
  const browserProvider = new BrowserProvider(eip1193 as ConstructorParameters<typeof BrowserProvider>[0]);
  const signer = await browserProvider.getSigner();
  const escrow = new Contract(escrowAddress, DELIVERA_ESCROW_ABI, signer);
  const tx = await escrow.recoverUnconfirmedFunding(escrowKey);
  const receipt = await tx.wait();
  assertConfirmed(receipt, "recoverUnconfirmedFunding");
  return tx.hash as string;
}

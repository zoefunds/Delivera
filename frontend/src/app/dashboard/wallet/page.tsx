"use client";

import { useEffect, useState } from "react";
import { Contract, JsonRpcProvider } from "ethers";
import { useAppKitAccount } from "@reown/appkit/react";
import { formatUsdc, usdcAddress } from "@/lib/api";
import { Icon } from "@/components/Icon";

const ERC20_ABI = ["function balanceOf(address owner) view returns (uint256)"];
const BASE_SEPOLIA_RPC = "https://sepolia.base.org";

export default function WalletPage() {
  const { address, isConnected } = useAppKitAccount();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isConnected || !address) return;
    let cancelled = false;

    async function loadBalance() {
      setError("");
      try {
        // Always read Base Sepolia directly via its own RPC, never through
        // the connected wallet — the wallet's *active* chain may not be
        // Base Sepolia (e.g. still on GenLayer Studio from another tab),
        // and a plain balanceOf read needs no wallet interaction anyway.
        const provider = new JsonRpcProvider(BASE_SEPOLIA_RPC);
        const usdc = new Contract(usdcAddress, ERC20_ABI, provider);
        const raw: bigint = await usdc.balanceOf(address);
        if (!cancelled) setBalance(raw);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load balance");
      }
    }

    loadBalance();
    return () => {
      cancelled = true;
    };
  }, [isConnected, address]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-headline text-headline-lg text-on-surface">Your wallet</h1>
        <p className="mt-1 text-on-surface-variant">
          Connected directly through your browser wallet on Base Sepolia. Delivera never sees or stores
          your private key.
        </p>
      </div>

      {error && <p className="text-sm font-medium text-error">{error}</p>}

      {!isConnected && (
        <div className="card">
          <p className="text-on-surface-variant">
            No wallet connected.{" "}
            <appkit-button size="md" label="Connect Wallet" />
          </p>
        </div>
      )}

      {isConnected && address && (
        <section className="relative overflow-hidden rounded-2xl bg-primary p-8 text-on-primary shadow-glow">
          <div
            className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-white/10 blur-3xl"
          />
          <div className="relative z-10">
            <div className="mb-8 flex items-center gap-2">
              <Icon name="account_balance_wallet" />
              <span className="font-mono text-label-mono uppercase tracking-widest opacity-80">
                Base Sepolia · USDC
              </span>
            </div>
            <p className="mb-1 text-white/70">Wallet balance</p>
            <h2 className="text-4xl font-bold tracking-tight">
              {balance === null ? "…" : formatUsdc(balance)}
            </h2>
            <div className="mt-8">
              <p className="mb-1 text-xs uppercase tracking-wide text-white/60">Address</p>
              <code className="block break-all rounded-lg bg-white/10 p-3 text-sm">{address}</code>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

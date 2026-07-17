"use client";

import { useEffect, useState } from "react";
import { api, formatGen, ApiError } from "@/lib/api";
import { Icon } from "@/components/Icon";

interface WalletInfo { address: string; onchainBalanceAtto: string | null; exportedAt: string | null }

export default function WalletPage() {
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [exported, setExported] = useState<{ address: string; privateKey: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<WalletInfo>("/wallet").then(setWallet).catch((e) => setError(String(e.message ?? e)));
  }, []);

  async function exportKey(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      setExported(await api.post("/wallet/export", { password: form.get("password") }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-headline text-headline-lg text-on-surface">Your GenLayer wallet</h1>
        <p className="mt-1 text-on-surface-variant">
          Created automatically with your account. It survives device changes, cache clears and reinstalls
          — the encrypted key lives with your account, never in this browser.
        </p>
      </div>

      {error && <p className="text-sm font-medium text-error">{error}</p>}

      {wallet && (
        <section className="relative overflow-hidden rounded-2xl bg-primary p-8 text-on-primary shadow-glow">
          <div
            className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-white/10 blur-3xl"
          />
          <div className="relative z-10">
            <div className="mb-8 flex items-center gap-2">
              <Icon name="account_balance_wallet" />
              <span className="font-mono text-label-mono uppercase tracking-widest opacity-80">
                GenLayer Wallet
              </span>
            </div>
            <p className="mb-1 text-white/70">On-chain spendable balance</p>
            <h2 className="text-4xl font-bold tracking-tight">{formatGen(wallet.onchainBalanceAtto)}</h2>
            <div className="mt-8">
              <p className="mb-1 text-xs uppercase tracking-wide text-white/60">Address</p>
              <code className="block break-all rounded-lg bg-white/10 p-3 text-sm">{wallet.address}</code>
            </div>
          </div>
        </section>
      )}

      <div className="card">
        <h2 className="font-headline text-headline-sm text-on-surface">Export private key</h2>
        <p className="mt-1 text-sm text-on-surface-variant">
          Re-enter your password to reveal your key once. Anyone with this key controls your wallet — never
          share it, and store it in a password manager.
        </p>
        {exported ? (
          <div className="mt-4">
            <p className="label">Private key (shown once — copy it now)</p>
            <code className="block break-all rounded-lg bg-surface-container-low p-3 text-sm dark:bg-white/5">
              {exported.privateKey}
            </code>
          </div>
        ) : (
          <form onSubmit={exportKey} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input className="input" name="password" type="password" required placeholder="Account password" />
            <button className="btn-secondary whitespace-nowrap" disabled={busy}>
              <Icon name="key" />
              {busy ? "Verifying…" : "Reveal key"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

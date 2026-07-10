"use client";

import { useEffect, useState } from "react";
import { api, formatGen, ApiError } from "@/lib/api";

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
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">Your GenLayer wallet</h1>
      <p className="mt-1 text-sm text-slate-500">
        Created automatically with your account. It survives device changes, cache clears and reinstalls —
        the encrypted key lives with your account, never in this browser.
      </p>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {wallet && (
        <div className="card mt-6 space-y-3">
          <div>
            <p className="label">Address</p>
            <code className="block break-all rounded bg-slate-100 p-2 text-sm dark:bg-slate-800">{wallet.address}</code>
          </div>
          <div>
            <p className="label">On-chain spendable balance</p>
            <p className="text-lg font-semibold">{formatGen(wallet.onchainBalanceAtto)}</p>
          </div>
        </div>
      )}

      <div className="card mt-6">
        <h2 className="font-semibold">Export private key</h2>
        <p className="mt-1 text-sm text-slate-500">
          Re-enter your password to reveal your key once. Anyone with this key controls your wallet —
          never share it, and store it in a password manager.
        </p>
        {exported ? (
          <div className="mt-4">
            <p className="label">Private key (shown once — copy it now)</p>
            <code className="block break-all rounded bg-slate-100 p-2 text-sm dark:bg-slate-800">{exported.privateKey}</code>
          </div>
        ) : (
          <form onSubmit={exportKey} className="mt-4 flex gap-3">
            <input className="input" name="password" type="password" required placeholder="Account password" />
            <button className="btn-secondary whitespace-nowrap" disabled={busy}>{busy ? "Verifying…" : "Reveal key"}</button>
          </form>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BrowserProvider } from "ethers";
import { useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import { api, setAccessToken, ApiError } from "@/lib/api";
import { AuthShell } from "@/components/AuthShell";
import { Icon } from "@/components/Icon";

export default function LoginPage() {
  const router = useRouter();
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider<any>("eip155");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    if (!isConnected || !address || !walletProvider) return;
    if (attempted.current === address) return;
    attempted.current = address;
    authenticate(address);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address, walletProvider]);

  async function authenticate(addr: string) {
    setBusy(true);
    setError("");
    try {
      const { message } = await api.get<{ nonce: string; message: string }>(
        `/auth/nonce?address=${encodeURIComponent(addr)}`
      );
      const provider = new BrowserProvider(walletProvider);
      const signer = await provider.getSigner();
      const signature = await signer.signMessage(message);
      const res = await api.post<{ accessToken: string }>("/auth/verify", {
        address: addr,
        signature,
      });
      setAccessToken(res.accessToken);
      router.push("/dashboard");
    } catch (err) {
      attempted.current = null;
      setError(err instanceof ApiError ? err.message : "Sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h2 className="mb-2 font-headline text-headline-lg text-on-surface">Welcome to Delivera</h2>
      <p className="mb-8 text-on-surface-variant">
        Connect your wallet to sign in. No password, no email — your wallet is your account.
      </p>

      <div className="flex flex-col items-center gap-6 rounded-2xl border border-border-subtle p-8 dark:border-white/10">
        <appkit-button size="md" label="Connect Wallet" loadingLabel="Connecting…" />

        {isConnected && address && (
          <p className="text-sm text-on-surface-variant">
            Connected as <code className="font-mono">{address.slice(0, 6)}…{address.slice(-4)}</code>
          </p>
        )}

        {busy && (
          <p className="flex items-center gap-2 text-sm text-on-surface-variant">
            <Icon name="hourglass_top" />
            Waiting for signature…
          </p>
        )}

        {error && <p className="text-sm font-medium text-error">{error}</p>}
      </div>

      <div className="mt-8 flex items-start gap-3 rounded-lg border border-primary/10 bg-surface-container p-4 dark:border-white/10 dark:bg-white/5">
        <Icon name="account_balance_wallet" className="mt-0.5 text-primary" filled />
        <p className="text-sm text-on-surface-variant">
          <strong className="text-on-surface">Your wallet, your funds.</strong> Delivera never holds your
          keys — escrow contracts run on Base Sepolia and settle directly to your connected address.
        </p>
      </div>
    </AuthShell>
  );
}

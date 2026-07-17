"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, setAccessToken, ApiError } from "@/lib/api";
import { AuthShell } from "@/components/AuthShell";
import { Icon } from "@/components/Icon";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const res = await api.post<{ accessToken: string }>("/auth/register", {
        name: form.get("name"),
        email: form.get("email"),
        password: form.get("password"),
        role: form.get("role"),
      });
      setAccessToken(res.accessToken);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h2 className="mb-2 font-headline text-headline-lg text-on-surface">Create your account</h2>
      <p className="mb-8 text-on-surface-variant">
        Join Delivera and start transacting with architectural trust.
      </p>
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="label" htmlFor="name">
            Full name
          </label>
          <input className="input" id="name" name="name" required maxLength={120} placeholder="e.g. Satoshi Nakamoto" />
        </div>
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            className="input"
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="name@company.com"
          />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password (min 10 characters)
          </label>
          <input
            className="input"
            id="password"
            name="password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            placeholder="••••••••••••"
          />
        </div>
        <div>
          <label className="label" htmlFor="role">
            I mainly want to
          </label>
          <select className="input" id="role" name="role" defaultValue="BOTH">
            <option value="CLIENT">Hire (client)</option>
            <option value="PROVIDER">Work (provider)</option>
            <option value="BOTH">Both</option>
          </select>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-primary/10 bg-surface-container p-4 dark:border-white/10 dark:bg-white/5">
          <Icon name="account_balance_wallet" className="mt-0.5 text-primary" filled />
          <p className="text-sm text-on-surface-variant">
            <strong className="text-on-surface">Automatic wallet creation.</strong> By signing up, a custodial
            GenLayer wallet is provisioned to secure your escrowed funds.
          </p>
        </div>

        {error && <p className="text-sm font-medium text-error">{error}</p>}
        <button className="btn-primary w-full py-3.5 text-base" disabled={busy}>
          {busy ? "Creating…" : "Get started"}
          {!busy && <Icon name="arrow_forward" />}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-on-surface-variant">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, setAccessToken, ApiError } from "@/lib/api";
import { AuthShell } from "@/components/AuthShell";
import { Icon } from "@/components/Icon";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const res = await api.post<{ accessToken: string }>("/auth/login", {
        email: form.get("email"),
        password: form.get("password"),
      });
      setAccessToken(res.accessToken);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h2 className="mb-2 font-headline text-headline-lg text-on-surface">Welcome back</h2>
      <p className="mb-8 text-on-surface-variant">Sign in to manage your escrow contracts.</p>
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input className="input" id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            className="input"
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </div>
        {error && <p className="text-sm font-medium text-error">{error}</p>}
        <button className="btn-primary w-full py-3.5 text-base" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
          {!busy && <Icon name="arrow_forward" />}
        </button>
      </form>
      <div className="mt-6 flex justify-between text-sm">
        <Link href="/forgot-password" className="font-semibold text-primary hover:underline">
          Forgot password?
        </Link>
        <Link href="/register" className="font-semibold text-primary hover:underline">
          Create account
        </Link>
      </div>
    </AuthShell>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      await api.post("/auth/forgot-password", { email: form.get("email") });
    } finally {
      setSent(true);
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="card w-full max-w-md">
        <Link href="/" className="text-lg font-bold text-brand-600">Delivera</Link>
        <h1 className="mt-4 text-2xl font-bold">Reset your password</h1>
        {sent ? (
          <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
            If that email is registered, a reset link is on its way. Check your inbox (and spam folder).
          </p>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input className="input" id="email" name="email" type="email" required />
            </div>
            <button className="btn-primary w-full" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
          </form>
        )}
        <p className="mt-4 text-sm">
          <Link href="/login" className="text-brand-600 hover:underline">Back to sign in</Link>
        </p>
      </div>
    </main>
  );
}

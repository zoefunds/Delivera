"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { AuthShell } from "@/components/AuthShell";

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
    <AuthShell>
      <h2 className="mb-2 font-headline text-headline-lg text-on-surface">Reset your password</h2>
      {sent ? (
        <p className="mt-4 text-sm leading-relaxed text-on-surface-variant">
          If that email is registered, a reset link is on its way. Check your inbox (and spam folder).
        </p>
      ) : (
        <>
          <p className="mb-8 text-on-surface-variant">We&apos;ll email you a link to set a new password.</p>
          <form onSubmit={submit} className="space-y-5">
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input className="input" id="email" name="email" type="email" required />
            </div>
            <button className="btn-primary w-full py-3.5 text-base" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </form>
        </>
      )}
      <p className="mt-6 text-center text-sm">
        <Link href="/login" className="font-semibold text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}

"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      await api.post("/auth/reset-password", { token, newPassword: form.get("password") });
      router.push("/login");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      <div>
        <label className="label" htmlFor="password">New password (min 10 characters)</label>
        <input className="input" id="password" name="password" type="password" required minLength={10} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="btn-primary w-full" disabled={busy || !token}>
        {busy ? "Saving…" : "Set new password"}
      </button>
      {!token && <p className="text-sm text-red-600">Missing reset token — use the link from your email.</p>}
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="card w-full max-w-md">
        <Link href="/" className="text-lg font-bold text-brand-600">Delivera</Link>
        <h1 className="mt-4 text-2xl font-bold">Choose a new password</h1>
        <Suspense><ResetForm /></Suspense>
      </div>
    </main>
  );
}

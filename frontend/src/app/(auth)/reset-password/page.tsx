"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { AuthShell } from "@/components/AuthShell";

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
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label className="label" htmlFor="password">
          New password (min 10 characters)
        </label>
        <input className="input" id="password" name="password" type="password" required minLength={10} />
      </div>
      {error && <p className="text-sm font-medium text-error">{error}</p>}
      <button className="btn-primary w-full py-3.5 text-base" disabled={busy || !token}>
        {busy ? "Saving…" : "Set new password"}
      </button>
      {!token && (
        <p className="text-sm font-medium text-error">Missing reset token — use the link from your email.</p>
      )}
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <h2 className="mb-8 font-headline text-headline-lg text-on-surface">Choose a new password</h2>
      <Suspense>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, setAccessToken, ApiError } from "@/lib/api";

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
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="card w-full max-w-md">
        <Link href="/" className="text-lg font-bold text-brand-600">Delivera</Link>
        <h1 className="mt-4 text-2xl font-bold">Welcome back</h1>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input className="input" id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input className="input" id="password" name="password" type="password" required autoComplete="current-password" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
        <div className="mt-4 flex justify-between text-sm">
          <Link href="/forgot-password" className="text-brand-600 hover:underline">Forgot password?</Link>
          <Link href="/register" className="text-brand-600 hover:underline">Create account</Link>
        </div>
      </div>
    </main>
  );
}

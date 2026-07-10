"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, setAccessToken, ApiError } from "@/lib/api";

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
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="card w-full max-w-md">
        <Link href="/" className="text-lg font-bold text-brand-600">Delivera</Link>
        <h1 className="mt-4 text-2xl font-bold">Create your account</h1>
        <p className="mt-1 text-sm text-slate-500">A GenLayer wallet is created for you automatically.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className="label" htmlFor="name">Full name</label>
            <input className="input" id="name" name="name" required maxLength={120} />
          </div>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input className="input" id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div>
            <label className="label" htmlFor="password">Password (min 10 characters)</label>
            <input className="input" id="password" name="password" type="password" required minLength={10} autoComplete="new-password" />
          </div>
          <div>
            <label className="label" htmlFor="role">I mainly want to</label>
            <select className="input" id="role" name="role" defaultValue="BOTH">
              <option value="CLIENT">Hire (client)</option>
              <option value="PROVIDER">Work (provider)</option>
              <option value="BOTH">Both</option>
            </select>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
        </form>
        <p className="mt-4 text-sm">
          Already have an account? <Link href="/login" className="text-brand-600 hover:underline">Sign in</Link>
        </p>
      </div>
    </main>
  );
}

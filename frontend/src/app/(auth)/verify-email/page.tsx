"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

function Verifier() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<"working" | "ok" | "failed">("working");

  useEffect(() => {
    if (!token) return setState("failed");
    api.post("/auth/verify-email", { token }).then(() => setState("ok")).catch(() => setState("failed"));
  }, [token]);

  if (state === "working") return <p className="mt-4 text-sm">Verifying…</p>;
  if (state === "ok")
    return (
      <p className="mt-4 text-sm text-emerald-600">
        Email verified! <Link href="/dashboard" className="underline">Go to your dashboard</Link>.
      </p>
    );
  return <p className="mt-4 text-sm text-red-600">Verification failed — the link may have expired.</p>;
}

export default function VerifyEmailPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="card w-full max-w-md">
        <Link href="/" className="text-lg font-bold text-brand-600">Delivera</Link>
        <h1 className="mt-4 text-2xl font-bold">Email verification</h1>
        <Suspense><Verifier /></Suspense>
      </div>
    </main>
  );
}

"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { AuthShell } from "@/components/AuthShell";
import { Icon } from "@/components/Icon";

function Verifier() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<"working" | "ok" | "failed">("working");

  useEffect(() => {
    if (!token) return setState("failed");
    api
      .post("/auth/verify-email", { token })
      .then(() => setState("ok"))
      .catch(() => setState("failed"));
  }, [token]);

  if (state === "working")
    return <p className="text-on-surface-variant">Verifying…</p>;
  if (state === "ok")
    return (
      <p className="flex items-center gap-2 font-medium text-success-emerald">
        <Icon name="check_circle" filled />
        Email verified!{" "}
        <Link href="/dashboard" className="underline">
          Go to your dashboard
        </Link>
        .
      </p>
    );
  return (
    <p className="flex items-center gap-2 font-medium text-error">
      <Icon name="error" filled />
      Verification failed — the link may have expired.
    </p>
  );
}

export default function VerifyEmailPage() {
  return (
    <AuthShell>
      <h2 className="mb-8 font-headline text-headline-lg text-on-surface">Email verification</h2>
      <Suspense>
        <Verifier />
      </Suspense>
    </AuthShell>
  );
}

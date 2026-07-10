"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, formatGen } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";

interface Milestone { id: string; title: string; status: string }
interface Contract {
  id: string;
  title: string;
  status: string;
  totalAtto: string;
  clientId: string;
  providerId: string | null;
  milestones: Milestone[];
  createdAt: string;
}

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<Contract[]>("/contracts").then(setContracts).catch((e) => setError(String(e.message ?? e)));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Your contracts</h1>
        <Link href="/dashboard/new" className="btn-primary">New contract</Link>
      </div>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {contracts === null ? (
        <p className="mt-8 text-sm text-slate-500">Loading…</p>
      ) : contracts.length === 0 ? (
        <div className="card mt-8 text-center">
          <p className="text-slate-600 dark:text-slate-400">
            No contracts yet. Create one and lock escrow — payment releases automatically when
            GenLayer validators verify delivery.
          </p>
          <Link href="/dashboard/new" className="btn-primary mt-4 inline-flex">Create your first contract</Link>
        </div>
      ) : (
        <div className="mt-6 grid gap-4">
          {contracts.map((c) => (
            <Link key={c.id} href={`/dashboard/contracts/${c.id}`} className="card block transition hover:border-brand-400">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{c.title}</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {c.milestones.filter((m) => m.status === "APPROVED").length}/{c.milestones.length} milestones approved
                    · {formatGen(c.totalAtto)}
                  </p>
                </div>
                <StatusBadge status={c.status} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

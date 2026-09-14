"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, formatContractAmount } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { Icon } from "@/components/Icon";

interface Milestone {
  id: string;
  title: string;
  status: string;
}
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

const LOCKED_STATUSES = new Set(["FUNDED", "ACTIVE", "DISPUTED"]);

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<Contract[]>("/contracts").then(setContracts).catch((e) => setError(String(e.message ?? e)));
  }, []);

  const stats = useMemo(() => {
    if (!contracts) return null;
    const totalLocked = contracts
      .filter((c) => LOCKED_STATUSES.has(c.status))
      .reduce((sum, c) => sum + BigInt(c.totalAtto || "0"), 0n);
    const active = contracts.filter((c) => c.status === "ACTIVE").length;
    const completed = contracts.filter((c) => c.status === "COMPLETED").length;
    return { totalLocked: totalLocked.toString(), active, completed };
  }, [contracts]);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-headline text-headline-lg text-on-surface">Your contracts</h1>
          <p className="mt-1 text-on-surface-variant">Escrow status, milestones, and verification at a glance.</p>
        </div>
        <Link href="/dashboard/new" className="btn-primary">
          <Icon name="add" />
          New contract
        </Link>
      </header>

      {error && <p className="text-sm font-medium text-error">{error}</p>}

      {contracts !== null && stats && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <div className="card">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon name="lock" />
            </div>
            <p className="text-sm text-on-surface-variant">Escrow Locked</p>
            <h3 className="mt-1 font-headline text-headline-md text-on-surface">{formatContractAmount(stats.totalLocked)}</h3>
          </div>
          <div className="card">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-action-violet/10 text-action-violet">
              <Icon name="bolt" />
            </div>
            <p className="text-sm text-on-surface-variant">Active Contracts</p>
            <h3 className="mt-1 font-headline text-headline-md text-on-surface">{stats.active}</h3>
          </div>
          <div className="card">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-success-emerald/10 text-success-emerald">
              <Icon name="verified" />
            </div>
            <p className="text-sm text-on-surface-variant">Completed</p>
            <h3 className="mt-1 font-headline text-headline-md text-on-surface">{stats.completed}</h3>
          </div>
        </div>
      )}

      {contracts === null ? (
        <p className="text-sm text-on-surface-variant">Loading…</p>
      ) : contracts.length === 0 ? (
        <div className="card text-center">
          <p className="text-on-surface-variant">
            No contracts yet. Create one and lock escrow — payment releases automatically when GenLayer
            validators verify delivery.
          </p>
          <Link href="/dashboard/new" className="btn-primary mt-4 inline-flex">
            Create your first contract
          </Link>
        </div>
      ) : (
        <section className="overflow-hidden rounded-xl border border-border-subtle bg-surface-container-lowest dark:border-white/10 dark:bg-white/5">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border-subtle bg-surface-container-low dark:border-white/10 dark:bg-white/5">
                  <th className="px-6 py-4 font-mono text-label-mono uppercase tracking-wider text-on-surface-variant">
                    Contract
                  </th>
                  <th className="px-6 py-4 font-mono text-label-mono uppercase tracking-wider text-on-surface-variant">
                    Amount
                  </th>
                  <th className="px-6 py-4 font-mono text-label-mono uppercase tracking-wider text-on-surface-variant">
                    Milestones
                  </th>
                  <th className="px-6 py-4 font-mono text-label-mono uppercase tracking-wider text-on-surface-variant">
                    Status
                  </th>
                  <th className="px-6 py-4" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle dark:divide-white/10">
                {contracts.map((c) => (
                  <tr key={c.id} className="transition-colors hover:bg-surface-container-low dark:hover:bg-white/5">
                    <td className="px-6 py-4 font-semibold text-on-surface">{c.title}</td>
                    <td className="px-6 py-4 font-bold text-on-surface">{formatContractAmount(c.totalAtto)}</td>
                    <td className="px-6 py-4 text-on-surface-variant">
                      {c.milestones.filter((m) => m.status === "APPROVED").length}/{c.milestones.length} approved
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link href={`/dashboard/contracts/${c.id}`} className="font-semibold text-primary hover:underline">
                        Details
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

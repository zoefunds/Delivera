"use client";

import { use, useCallback, useEffect, useState } from "react";
import { api, formatGen, ApiError } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";

interface Milestone {
  id: string; index: number; title: string; description: string;
  acceptanceCriteria: string; evidenceType: string; amountAtto: string;
  status: string; attempts: number; maxAttempts: number;
}
interface Dispute {
  id: string; chainDisputeIndex: number | null; milestoneIndex: number; reason: string;
  status: string; providerBps: number | null; resolutionSummary: string | null;
}
interface ChainMilestone {
  status?: string;
  last_evaluation?: { verdict: string; score: number; reasoning: string; attempt: number } | null;
}
interface ContractDetail {
  id: string; title: string; description: string; status: string;
  clientId: string; providerId: string | null;
  totalAtto: string; milestones: Milestone[]; disputes: Dispute[];
  chain: { status?: string; milestones?: ChainMilestone[] } | null;
}
interface Me { id: string }

export default function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [me, setMe] = useState<Me | null>(null);
  const [contract, setContract] = useState<ContractDetail | null>(null);
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState("");

  const reload = useCallback(() => {
    api.get<ContractDetail>(`/contracts/${id}`).then(setContract).catch((e) => setError(String(e.message ?? e)));
  }, [id]);

  useEffect(() => {
    api.get<Me>("/auth/me").then(setMe).catch(() => {});
    reload();
  }, [reload]);

  async function run(action: string, path: string, body?: unknown) {
    setBusyAction(action);
    setError("");
    try {
      await api.post(path, body);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setBusyAction("");
    }
  }

  if (!contract) return <p className="text-sm text-slate-500">{error || "Loading…"}</p>;
  const isClient = me?.id === contract.clientId;
  const isProvider = me?.id === contract.providerId;
  const chainStatus = contract.chain?.status ?? contract.status;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{contract.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {formatGen(contract.totalAtto)} total · you are the {isClient ? "client" : isProvider ? "provider" : "viewer"}
          </p>
        </div>
        <StatusBadge status={chainStatus} />
      </div>
      {contract.description && <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">{contract.description}</p>}
      {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</p>}

      {/* Lifecycle actions */}
      <div className="mt-6 flex flex-wrap gap-3">
        {isClient && chainStatus === "DRAFT" && (
          <button className="btn-primary" disabled={!!busyAction} onClick={() => run("fund", `/contracts/${id}/fund`)}>
            {busyAction === "fund" ? "Funding…" : "Fund escrow"}
          </button>
        )}
        {isProvider && chainStatus === "FUNDED" && (
          <button className="btn-primary" disabled={!!busyAction} onClick={() => run("accept", `/contracts/${id}/accept`)}>
            {busyAction === "accept" ? "Accepting…" : "Accept contract"}
          </button>
        )}
        {(isClient || isProvider) && ["DRAFT", "FUNDED", "ACTIVE"].includes(chainStatus) && (
          <button className="btn-secondary" disabled={!!busyAction}
            onClick={() => confirm("Cancel this contract? Remaining escrow returns to the client.") && run("cancel", `/contracts/${id}/cancel`)}>
            Cancel contract
          </button>
        )}
      </div>

      {/* Milestones */}
      <h2 className="mt-10 text-lg font-semibold">Milestones</h2>
      <div className="mt-4 space-y-4">
        {contract.milestones.sort((a, b) => a.index - b.index).map((m) => {
          const chainM = contract.chain?.milestones?.[m.index];
          const status = chainM?.status ?? m.status;
          const evaluation = chainM?.last_evaluation;
          return (
            <div key={m.id} className="card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">{m.index + 1}. {m.title}</h3>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-500">{formatGen(m.amountAtto)}</span>
                  <StatusBadge status={status} />
                </div>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-400">{m.acceptanceCriteria}</p>
              <p className="mt-2 text-xs text-slate-400">Evidence: {m.evidenceType} · attempt {m.attempts}/{m.maxAttempts}</p>

              {evaluation && (
                <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
                  <p className="font-medium">AI verdict: {evaluation.verdict} (score {evaluation.score})</p>
                  <p className="mt-1 text-slate-600 dark:text-slate-400">{evaluation.reasoning}</p>
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                {isProvider && chainStatus === "ACTIVE" && ["PENDING", "NEEDS_REVISION", "REJECTED"].includes(status) && m.attempts < m.maxAttempts && (
                  <SubmitForm onSubmit={(urls, notes) => run(`submit-${m.index}`, `/contracts/${id}/milestones/${m.index}/submit`, { evidenceUrls: urls, notes })} busy={busyAction === `submit-${m.index}`} />
                )}
                {(isClient || isProvider) && status === "SUBMITTED" && (
                  <button className="btn-primary" disabled={!!busyAction}
                    onClick={() => run(`verify-${m.index}`, `/contracts/${id}/milestones/${m.index}/verify`)}>
                    {busyAction === `verify-${m.index}` ? "Validators evaluating… (may take a minute)" : "Run AI verification"}
                  </button>
                )}
                {isClient && ["SUBMITTED", "NEEDS_REVISION", "REJECTED", "EXHAUSTED"].includes(status) && (
                  <button className="btn-secondary" disabled={!!busyAction}
                    onClick={() => run(`approve-${m.index}`, `/contracts/${id}/milestones/${m.index}/approve`)}>
                    Approve manually
                  </button>
                )}
                {(isClient || isProvider) && chainStatus === "ACTIVE" && status !== "PENDING" && (
                  <button className="btn-secondary" disabled={!!busyAction}
                    onClick={() => {
                      const reason = prompt("Why are you disputing this milestone?");
                      if (reason && reason.length >= 10) run(`dispute-${m.index}`, `/contracts/${id}/disputes`, { milestoneIndex: m.index, reason });
                    }}>
                    Raise dispute
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Disputes */}
      {contract.disputes.length > 0 && (
        <>
          <h2 className="mt-10 text-lg font-semibold">Disputes</h2>
          <div className="mt-4 space-y-4">
            {contract.disputes.map((d) => (
              <div key={d.id} className="card">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Milestone {d.milestoneIndex + 1}</h3>
                  <StatusBadge status={d.status === "OPEN" ? "DISPUTED" : "COMPLETED"} />
                </div>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{d.reason}</p>
                {d.status === "OPEN" && d.chainDisputeIndex !== null && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button className="btn-secondary" disabled={!!busyAction}
                      onClick={() => {
                        const statement = prompt("Add your statement for the arbitrator:");
                        if (statement) run("statement", `/contracts/${id}/disputes/${d.chainDisputeIndex}/statement`, { statement });
                      }}>
                      Add statement
                    </button>
                    <button className="btn-primary" disabled={!!busyAction}
                      onClick={() => run("resolve", `/contracts/${id}/disputes/${d.chainDisputeIndex}/resolve`)}>
                      {busyAction === "resolve" ? "Arbitrating… (may take a minute)" : "Resolve by AI arbitration"}
                    </button>
                  </div>
                )}
                {d.resolutionSummary && (
                  <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
                    <p className="font-medium">
                      Resolution: {d.providerBps !== null ? `${(d.providerBps / 100).toFixed(1)}% to provider` : "resolved"}
                    </p>
                    <p className="mt-1 text-slate-600 dark:text-slate-400">{d.resolutionSummary}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SubmitForm({ onSubmit, busy }: { onSubmit: (urls: string[], notes: string) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [urls, setUrls] = useState("");
  const [notes, setNotes] = useState("");

  if (!open) return <button className="btn-primary" onClick={() => setOpen(true)}>Submit deliverable</button>;
  return (
    <div className="w-full space-y-3 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <div>
        <label className="label">Evidence URLs (one per line, max 5) — validators fetch these directly</label>
        <textarea className="input" rows={3} value={urls} onChange={(e) => setUrls(e.target.value)}
          placeholder={"https://myproject.vercel.app\nhttps://github.com/me/project"} />
      </div>
      <div>
        <label className="label">Notes (context only — not treated as evidence)</label>
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}
          onClick={() => {
            const list = urls.split("\n").map((u) => u.trim()).filter(Boolean);
            if (list.length) onSubmit(list, notes);
          }}>
          {busy ? "Submitting on-chain…" : "Submit"}
        </button>
        <button className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

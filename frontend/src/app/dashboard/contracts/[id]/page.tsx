"use client";

import { use, useCallback, useEffect, useState } from "react";
import { api, formatGen, ApiError } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { Icon } from "@/components/Icon";

interface Deliverable {
  id: string; evidenceUrls: string[]; notes: string; attempt: number; createdAt: string;
}
interface Milestone {
  id: string; index: number; title: string; description: string;
  acceptanceCriteria: string; evidenceType: string; amountAtto: string;
  status: string; attempts: number; maxAttempts: number; deliverables: Deliverable[];
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

  if (!contract) return <p className="text-sm text-on-surface-variant">{error || "Loading…"}</p>;
  const isClient = me?.id === contract.clientId;
  const isProvider = me?.id === contract.providerId;
  const chainStatus = contract.chain?.status ?? contract.status;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-headline text-headline-lg text-on-surface">{contract.title}</h1>
          <p className="mt-1 text-on-surface-variant">
            {formatGen(contract.totalAtto)} total · you are the{" "}
            {isClient ? "client" : isProvider ? "provider" : "viewer"}
          </p>
        </div>
        <StatusBadge status={chainStatus} />
      </div>
      {contract.description && <p className="mt-4 text-on-surface-variant">{contract.description}</p>}
      {error && (
        <p className="mt-4 rounded-lg bg-error-container p-3 text-sm font-medium text-on-error-container">
          {error}
        </p>
      )}

      {/* Lifecycle actions */}
      <div className="mt-6 flex flex-wrap gap-3">
        {isClient && chainStatus === "DRAFT" && (
          <button className="btn-primary" disabled={!!busyAction} onClick={() => run("fund", `/contracts/${id}/fund`)}>
            <Icon name="lock" />
            {busyAction === "fund" ? "Funding…" : "Fund escrow"}
          </button>
        )}
        {isProvider && chainStatus === "FUNDED" && (
          <button className="btn-primary" disabled={!!busyAction} onClick={() => run("accept", `/contracts/${id}/accept`)}>
            <Icon name="check_circle" />
            {busyAction === "accept" ? "Accepting…" : "Accept contract"}
          </button>
        )}
        {(isClient || isProvider) && ["DRAFT", "FUNDED", "ACTIVE"].includes(chainStatus) && (
          <button
            className="btn-secondary"
            disabled={!!busyAction}
            onClick={() =>
              confirm("Cancel this contract? Remaining escrow returns to the client.") &&
              run("cancel", `/contracts/${id}/cancel`)
            }
          >
            <Icon name="cancel" />
            Cancel contract
          </button>
        )}
      </div>

      {/* Milestones */}
      <h2 className="mt-10 font-headline text-headline-md text-on-surface">Milestones</h2>
      <div className="mt-4 space-y-4">
        {contract.milestones.sort((a, b) => a.index - b.index).map((m) => {
          const chainM = contract.chain?.milestones?.[m.index];
          const status = chainM?.status ?? m.status;
          const evaluation = chainM?.last_evaluation;
          return (
            <div key={m.id} className="card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-on-surface">
                  {m.index + 1}. {m.title}
                </h3>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-on-surface-variant">{formatGen(m.amountAtto)}</span>
                  <StatusBadge status={status} />
                </div>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-on-surface-variant">{m.acceptanceCriteria}</p>
              <p className="mt-2 font-mono text-xs text-outline">
                Evidence: {m.evidenceType} · attempt {m.attempts}/{m.maxAttempts}
              </p>

              {m.deliverables.length > 0 && (
                <div className="mt-3 space-y-3">
                  {[...m.deliverables]
                    .sort((a, b) => b.attempt - a.attempt)
                    .map((d) => (
                      <div key={d.id} className="rounded-lg border border-border-subtle p-4">
                        <div className="flex items-center justify-between">
                          <p className="flex items-center gap-2 text-sm font-semibold text-on-surface">
                            <Icon name="upload_file" className="!text-base text-primary" />
                            Submitted deliverable · attempt {d.attempt}
                          </p>
                          <span className="font-mono text-xs text-outline">
                            {new Date(d.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <ul className="mt-2 space-y-1">
                          {d.evidenceUrls.map((url) => (
                            <li key={url}>
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="break-all text-sm text-primary hover:underline"
                              >
                                {url}
                              </a>
                            </li>
                          ))}
                        </ul>
                        {d.notes && <p className="mt-2 text-sm text-on-surface-variant">{d.notes}</p>}
                      </div>
                    ))}
                </div>
              )}

              {evaluation && (
                <div className="mt-3 rounded-lg bg-surface-container-low p-4 text-sm dark:bg-white/5">
                  <p className="flex items-center gap-2 font-semibold text-on-surface">
                    <Icon name="psychology" className="!text-base text-primary" />
                    AI verdict: {evaluation.verdict} (score {evaluation.score})
                  </p>
                  <p className="mt-1 text-on-surface-variant">{evaluation.reasoning}</p>
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                {isProvider && chainStatus === "ACTIVE" && ["PENDING", "NEEDS_REVISION", "REJECTED"].includes(status) && m.attempts < m.maxAttempts && (
                  <SubmitForm onSubmit={(urls, notes) => run(`submit-${m.index}`, `/contracts/${id}/milestones/${m.index}/submit`, { evidenceUrls: urls, notes })} busy={busyAction === `submit-${m.index}`} />
                )}
                {(isClient || isProvider) && status === "SUBMITTED" && (
                  <button className="btn-primary" disabled={!!busyAction}
                    onClick={() => run(`verify-${m.index}`, `/contracts/${id}/milestones/${m.index}/verify`)}>
                    <Icon name="psychology" />
                    {busyAction === `verify-${m.index}` ? "Validators evaluating… (may take a minute)" : "Run AI verification"}
                  </button>
                )}
                {isClient && ["SUBMITTED", "NEEDS_REVISION", "REJECTED", "EXHAUSTED"].includes(status) && (
                  <button className="btn-secondary" disabled={!!busyAction}
                    onClick={() => run(`approve-${m.index}`, `/contracts/${id}/milestones/${m.index}/approve`)}>
                    <Icon name="task_alt" />
                    Approve manually
                  </button>
                )}
                {(isClient || isProvider) && chainStatus === "ACTIVE" && status !== "PENDING" && (
                  <button className="btn-secondary" disabled={!!busyAction}
                    onClick={() => {
                      const reason = prompt("Why are you disputing this milestone?");
                      if (reason && reason.length >= 10) run(`dispute-${m.index}`, `/contracts/${id}/disputes`, { milestoneIndex: m.index, reason });
                    }}>
                    <Icon name="gavel" />
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
          <h2 className="mt-10 font-headline text-headline-md text-on-surface">Disputes</h2>
          <div className="mt-4 space-y-4">
            {contract.disputes.map((d) => (
              <div key={d.id} className="card">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-on-surface">Milestone {d.milestoneIndex + 1}</h3>
                  <StatusBadge status={d.status === "OPEN" ? "DISPUTED" : "COMPLETED"} />
                </div>
                <p className="mt-2 text-sm text-on-surface-variant">{d.reason}</p>
                {d.status === "OPEN" && d.chainDisputeIndex !== null && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button className="btn-secondary" disabled={!!busyAction}
                      onClick={() => {
                        const statement = prompt("Add your statement for the arbitrator:");
                        if (statement) run("statement", `/contracts/${id}/disputes/${d.chainDisputeIndex}/statement`, { statement });
                      }}>
                      <Icon name="chat" />
                      Add statement
                    </button>
                    <button className="btn-primary" disabled={!!busyAction}
                      onClick={() => run("resolve", `/contracts/${id}/disputes/${d.chainDisputeIndex}/resolve`)}>
                      <Icon name="balance" />
                      {busyAction === "resolve" ? "Arbitrating… (may take a minute)" : "Resolve by AI arbitration"}
                    </button>
                  </div>
                )}
                {d.resolutionSummary && (
                  <div className="mt-3 rounded-lg bg-surface-container-low p-4 text-sm dark:bg-white/5">
                    <p className="font-semibold text-on-surface">
                      Resolution: {d.providerBps !== null ? `${(d.providerBps / 100).toFixed(1)}% to provider` : "resolved"}
                    </p>
                    <p className="mt-1 text-on-surface-variant">{d.resolutionSummary}</p>
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

  if (!open)
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        <Icon name="upload_file" />
        Submit deliverable
      </button>
    );
  return (
    <div className="w-full space-y-3 rounded-lg border border-border-subtle p-4 dark:border-white/10">
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

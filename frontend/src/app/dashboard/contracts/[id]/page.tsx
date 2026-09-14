"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import { api, formatContractAmount, ApiError } from "@/lib/api";
import { fundEscrowOnChain } from "@/lib/escrow";
import { genlayerWrite } from "@/lib/genlayer";
import { StatusBadge } from "@/components/StatusBadge";
import { Icon } from "@/components/Icon";

interface Deliverable {
  id: string; evidenceUrls: string[]; notes: string; attempt: number; createdAt: string;
}
interface Milestone {
  id: string; index: number; title: string; description: string;
  acceptanceCriteria: string; evidenceType: string; amountAtto: string;
  status: string; attempts: number; maxAttempts: number; deliverables: Deliverable[];
  relayTxHash: string | null;
}
interface Dispute {
  id: string; chainDisputeIndex: number | null; milestoneIndex: number; reason: string;
  status: string; providerBps: number | null; resolutionSummary: string | null;
  relayTxHash: string | null;
}
interface ChainMilestone {
  status?: string;
  last_evaluation?: { verdict: string; score: number; reasoning: string; attempt: number } | null;
}
interface ContractDetail {
  id: string; title: string; description: string; status: string;
  clientId: string; providerId: string | null; chainContractId: string | null;
  totalAtto: string; fundedAtto: string; milestones: Milestone[]; disputes: Dispute[];
  refundRelayTxHash: string | null;
  chain: { status?: string; milestones?: ChainMilestone[] } | null;
  provider: { walletAddress: string | null } | null;
  escrow: { address: string | null; usdcAddress: string };
}

const BASESCAN_TX = "https://sepolia.basescan.org/tx/";

/** Every real payout (milestone release, cancellation refund, dispute
 * settlement) is paid out automatically by a backend relay job once GenLayer
 * records the decision — there is no "claim" step for either party to take.
 * This just surfaces that background process's status so it doesn't look
 * like nothing happened while the relay's ~30s sweep catches up. */
function PayoutStatus({ relayTxHash, pendingLabel, paidLabel, noopLabel }: {
  relayTxHash: string | null; pendingLabel: string; paidLabel: string; noopLabel: string;
}) {
  if (relayTxHash === "NOOP") {
    return <p className="mt-2 text-xs text-on-surface-variant">{noopLabel}</p>;
  }
  if (relayTxHash) {
    return (
      <p className="mt-2 flex items-center gap-1 text-xs text-on-surface-variant">
        <Icon name="check_circle" className="!text-sm text-primary" />
        {paidLabel}{" "}
        <a href={`${BASESCAN_TX}${relayTxHash}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
          view transaction
        </a>
      </p>
    );
  }
  return (
    <p className="mt-2 flex items-center gap-1 text-xs text-on-surface-variant">
      <Icon name="hourglass_top" className="!text-sm" />
      {pendingLabel}
    </p>
  );
}
interface Me { id: string }

export default function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { walletProvider } = useAppKitProvider<any>("eip155");
  const { address } = useAppKitAccount();
  const [me, setMe] = useState<Me | null>(null);
  const [contract, setContract] = useState<ContractDetail | null>(null);
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [busyStage, setBusyStage] = useState<"" | "chain" | "confirm">("");

  const reload = useCallback(() => {
    api.get<ContractDetail>(`/contracts/${id}`).then(setContract).catch((e) => setError(String(e.message ?? e)));
  }, [id]);

  useEffect(() => {
    api.get<Me>("/auth/me").then(setMe).catch(() => {});
    reload();
  }, [reload]);

  /** Signs the GenLayer write with the connected wallet first, then hits
   * the backend confirm route (same paths/bodies as before the frontend
   * took over signing) to mirror the result into Postgres. */
  async function run(
    action: string,
    chainMethod: string,
    chainArgs: unknown[],
    path: string,
    body?: unknown,
  ) {
    setBusyAction(action);
    setError("");
    try {
      if (!contract?.chainContractId) throw new Error("Contract has no on-chain id yet");
      if (!walletProvider || !address) throw new Error("Connect your wallet first");
      setBusyStage("chain");
      await genlayerWrite(walletProvider, address, chainMethod, chainArgs);
      setBusyStage("confirm");
      await api.post(path, body);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyAction("");
      setBusyStage("");
    }
  }

  async function fundOnChain() {
    if (!contract) return;
    setBusyAction("fund");
    setError("");
    try {
      if (!contract.chainContractId) throw new Error("Contract has no on-chain id yet");
      if (!contract.escrow.address) throw new Error("Escrow contract is not configured yet");
      if (!contract.provider?.walletAddress) throw new Error("Provider has no wallet address on file");
      if (!walletProvider || !address) throw new Error("Connect your wallet first");
      // Ledger amounts are 18-decimal dollar-equivalent values; the real
      // escrow holds 6-decimal USDC — see formatContractAmount in lib/api.ts.
      const amountUsdc = BigInt(contract.totalAtto) / 10n ** 12n;
      setBusyStage("chain");
      const fundTxHash = await fundEscrowOnChain(
        walletProvider,
        contract.escrow.address,
        contract.escrow.usdcAddress,
        contract.chainContractId,
        contract.provider.walletAddress,
        amountUsdc,
      );
      // The backend's /fund confirm route requires GenLayer's own
      // fund_escrow (a status-mirror only — no funds move here) to have
      // already landed too, so it has something to poll for; nobody signs
      // this on the user's behalf anymore, so it has to happen here.
      await genlayerWrite(walletProvider, address, "fund_escrow", [contract.chainContractId]);
      setBusyStage("confirm");
      await api.post(`/contracts/${id}/fund`, { fundTxHash });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Funding failed");
    } finally {
      setBusyAction("");
      setBusyStage("");
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
            {formatContractAmount(contract.totalAtto)} total · you are the{" "}
            {isClient ? "client" : isProvider ? "provider" : "viewer"}
          </p>
        </div>
        <StatusBadge status={chainStatus} />
      </div>
      {chainStatus === "CANCELLED" && contract.fundedAtto !== "0" && (
        <PayoutStatus
          relayTxHash={contract.refundRelayTxHash}
          pendingLabel="Refund to client processing on Base Sepolia — usually under a minute…"
          paidLabel="Remaining escrow refunded to the client —"
          noopLabel="Nothing was left in escrow to refund."
        />
      )}
      {contract.description && <p className="mt-4 text-on-surface-variant">{contract.description}</p>}
      {error && (
        <p className="mt-4 rounded-lg bg-error-container p-3 text-sm font-medium text-on-error-container">
          {error}
        </p>
      )}

      {/* Lifecycle actions */}
      <div className="mt-6 flex flex-wrap gap-3">
        {isClient && chainStatus === "DRAFT" && (
          <button className="btn-primary" disabled={!!busyAction} onClick={fundOnChain}>
            <Icon name="lock" />
            {busyAction === "fund"
              ? busyStage === "confirm"
                ? "Confirming with Delivera…"
                : "Depositing USDC & confirming on GenLayer…"
              : "Fund escrow"}
          </button>
        )}
        {isProvider && chainStatus === "FUNDED" && (
          <button
            className="btn-primary"
            disabled={!!busyAction}
            onClick={() => run("accept", "accept_contract", [contract.chainContractId], `/contracts/${id}/accept`)}
          >
            <Icon name="check_circle" />
            {busyAction === "accept" ? (busyStage === "chain" ? "Confirming on GenLayer…" : "Accepting…") : "Accept contract"}
          </button>
        )}
        {(isClient || isProvider) && ["DRAFT", "FUNDED", "ACTIVE"].includes(chainStatus) && (
          <button
            className="btn-secondary"
            disabled={!!busyAction}
            onClick={() =>
              confirm("Cancel this contract? Remaining escrow returns to the client.") &&
              run("cancel", "cancel_contract", [contract.chainContractId], `/contracts/${id}/cancel`)
            }
          >
            <Icon name="cancel" />
            {busyAction === "cancel" ? (busyStage === "chain" ? "Confirming on GenLayer…" : "Cancelling…") : "Cancel contract"}
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
                  <span className="text-sm text-on-surface-variant">{formatContractAmount(m.amountAtto)}</span>
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

              {status === "APPROVED" && (
                <PayoutStatus
                  relayTxHash={m.relayTxHash}
                  pendingLabel="Payout to provider processing on Base Sepolia — usually under a minute…"
                  paidLabel={`${formatContractAmount(m.amountAtto)} paid to the provider's wallet —`}
                  noopLabel="Nothing to pay out."
                />
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                {isProvider && chainStatus === "ACTIVE" && ["PENDING", "NEEDS_REVISION", "REJECTED"].includes(status) && m.attempts < m.maxAttempts && (
                  <SubmitForm
                    onSubmit={(urls, notes) =>
                      run(
                        `submit-${m.index}`,
                        "submit_deliverable",
                        [contract.chainContractId, m.index, JSON.stringify(urls), notes],
                        `/contracts/${id}/milestones/${m.index}/submit`,
                        { evidenceUrls: urls, notes },
                      )
                    }
                    busy={busyAction === `submit-${m.index}`}
                    stage={busyStage}
                  />
                )}
                {(isClient || isProvider) && status === "SUBMITTED" && (
                  <button className="btn-primary" disabled={!!busyAction}
                    onClick={() => run(`verify-${m.index}`, "verify_deliverable", [contract.chainContractId, m.index], `/contracts/${id}/milestones/${m.index}/verify`)}>
                    <Icon name="psychology" />
                    {busyAction === `verify-${m.index}`
                      ? busyStage === "chain" ? "Confirming on GenLayer…" : "Validators evaluating… (may take a minute)"
                      : "Run AI verification"}
                  </button>
                )}
                {isClient && ["SUBMITTED", "NEEDS_REVISION", "REJECTED", "EXHAUSTED"].includes(status) && (
                  <button className="btn-secondary" disabled={!!busyAction}
                    onClick={() => run(`approve-${m.index}`, "approve_milestone", [contract.chainContractId, m.index], `/contracts/${id}/milestones/${m.index}/approve`)}>
                    <Icon name="task_alt" />
                    {busyAction === `approve-${m.index}` ? (busyStage === "chain" ? "Confirming on GenLayer…" : "Approving…") : "Approve manually"}
                  </button>
                )}
                {(isClient || isProvider) && chainStatus === "ACTIVE" && status !== "PENDING" && (
                  <button className="btn-secondary" disabled={!!busyAction}
                    onClick={() => {
                      const reason = prompt("Why are you disputing this milestone?");
                      if (reason && reason.length >= 10)
                        run(`dispute-${m.index}`, "raise_dispute", [contract.chainContractId, m.index, reason], `/contracts/${id}/disputes`, { milestoneIndex: m.index, reason });
                    }}>
                    <Icon name="gavel" />
                    {busyAction === `dispute-${m.index}` ? (busyStage === "chain" ? "Confirming on GenLayer…" : "Raising dispute…") : "Raise dispute"}
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
                        if (statement)
                          run(
                            "statement",
                            "add_dispute_statement",
                            [contract.chainContractId, d.chainDisputeIndex, statement],
                            `/contracts/${id}/disputes/${d.chainDisputeIndex}/statement`,
                            { statement },
                          );
                      }}>
                      <Icon name="chat" />
                      {busyAction === "statement" ? (busyStage === "chain" ? "Confirming on GenLayer…" : "Adding statement…") : "Add statement"}
                    </button>
                    <button className="btn-primary" disabled={!!busyAction}
                      onClick={() => run("resolve", "resolve_dispute", [contract.chainContractId, d.chainDisputeIndex], `/contracts/${id}/disputes/${d.chainDisputeIndex}/resolve`)}>
                      <Icon name="balance" />
                      {busyAction === "resolve"
                        ? busyStage === "chain" ? "Confirming on GenLayer…" : "Arbitrating… (may take a minute)"
                        : "Resolve by AI arbitration"}
                    </button>
                  </div>
                )}
                {d.resolutionSummary && (
                  <div className="mt-3 rounded-lg bg-surface-container-low p-4 text-sm dark:bg-white/5">
                    <p className="font-semibold text-on-surface">
                      Resolution: {d.providerBps !== null ? `${(d.providerBps / 100).toFixed(1)}% to provider` : "resolved"}
                    </p>
                    <p className="mt-1 text-on-surface-variant">{d.resolutionSummary}</p>
                    <PayoutStatus
                      relayTxHash={d.relayTxHash}
                      pendingLabel="Settling the split on Base Sepolia — usually under a minute…"
                      paidLabel="Split paid out to both parties —"
                      noopLabel="Nothing was left in escrow to distribute."
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {(isClient || isProvider) && ["COMPLETED", "CANCELLED"].includes(chainStatus) && (
        <>
          <h2 className="mt-10 font-headline text-headline-md text-on-surface">Review</h2>
          <div className="mt-4">
            <ReviewForm contractId={id} />
          </div>
        </>
      )}
    </div>
  );
}

function ReviewForm({ contractId }: { contractId: string }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  if (done) {
    return (
      <div className="card flex items-center gap-2 text-sm text-on-surface-variant">
        <Icon name="check_circle" className="text-primary" />
        Thanks — your review was submitted.
      </div>
    );
  }

  return (
    <div className="card space-y-4">
      <div>
        <label className="label">Rating</label>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              aria-label={`${n} star${n > 1 ? "s" : ""}`}
              className="text-2xl leading-none"
            >
              <Icon name="star" filled={n <= rating} className={n <= rating ? "text-primary" : "text-outline"} />
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="label">Comment (optional)</label>
        <textarea
          className="input"
          rows={3}
          maxLength={2000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="How was working with this counterparty?"
        />
      </div>
      {error && <p className="text-sm font-medium text-error">{error}</p>}
      <button
        className="btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await api.post("/reviews", { contractId, rating, comment });
            setDone(true);
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to submit review");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Submitting…" : "Submit review"}
      </button>
    </div>
  );
}

function SubmitForm({
  onSubmit,
  busy,
  stage,
}: {
  onSubmit: (urls: string[], notes: string) => void;
  busy: boolean;
  stage: "" | "chain" | "confirm";
}) {
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
          {busy ? (stage === "chain" ? "Confirming on GenLayer…" : "Submitting…") : "Submit"}
        </button>
        <button className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

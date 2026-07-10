"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";

interface MilestoneDraft {
  title: string;
  description: string;
  acceptanceCriteria: string;
  evidenceType: string;
  amountGen: string;
}

const EVIDENCE_TYPES = [
  ["website", "Live website"],
  ["github_repo", "GitHub repository"],
  ["api_endpoint", "API endpoint"],
  ["document", "Document / spec"],
  ["article", "Article / content"],
  ["design", "Design preview"],
  ["media", "Media page"],
  ["other", "Other URL"],
];

const empty: MilestoneDraft = { title: "", description: "", acceptanceCriteria: "", evidenceType: "website", amountGen: "" };

function genToAtto(gen: string): string {
  const [whole = "0", frac = ""] = gen.trim().split(".");
  return (BigInt(whole || "0") * 10n ** 18n + BigInt((frac + "0".repeat(18)).slice(0, 18))).toString();
}

export default function NewContractPage() {
  const router = useRouter();
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([{ ...empty }]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function update(i: number, patch: Partial<MilestoneDraft>) {
    setMilestones((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const res = await api.post<{ contract: { id: string } }>("/contracts", {
        providerEmail: form.get("providerEmail"),
        title: form.get("title"),
        description: form.get("description") ?? "",
        milestones: milestones.map((m) => ({
          title: m.title,
          description: m.description,
          acceptanceCriteria: m.acceptanceCriteria,
          evidenceType: m.evidenceType,
          amountAtto: genToAtto(m.amountGen),
        })),
      });
      router.push(`/dashboard/contracts/${res.contract.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create contract");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold">New performance-based contract</h1>
      <p className="mt-1 text-sm text-slate-500">
        Define milestones with concrete, verifiable acceptance criteria — GenLayer validators will
        judge deliverables against exactly what you write here.
      </p>
      <form onSubmit={submit} className="mt-6 space-y-6">
        <div className="card space-y-4">
          <div>
            <label className="label" htmlFor="title">Contract title</label>
            <input className="input" id="title" name="title" required maxLength={200} placeholder="Marketing site redesign" />
          </div>
          <div>
            <label className="label" htmlFor="description">Description</label>
            <textarea className="input" id="description" name="description" rows={3} maxLength={8000} />
          </div>
          <div>
            <label className="label" htmlFor="providerEmail">Provider&apos;s Delivera email</label>
            <input className="input" id="providerEmail" name="providerEmail" type="email" required placeholder="freelancer@example.com" />
          </div>
        </div>

        {milestones.map((m, i) => (
          <div key={i} className="card space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Milestone {i + 1}</h2>
              {milestones.length > 1 && (
                <button type="button" className="text-sm text-red-600 hover:underline"
                  onClick={() => setMilestones((ms) => ms.filter((_, j) => j !== i))}>
                  Remove
                </button>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Title</label>
                <input className="input" required maxLength={200} value={m.title}
                  onChange={(e) => update(i, { title: e.target.value })} placeholder="Homepage live on production" />
              </div>
              <div>
                <label className="label">Amount (GEN)</label>
                <input className="input" required pattern="\d+(\.\d+)?" value={m.amountGen}
                  onChange={(e) => update(i, { amountGen: e.target.value })} placeholder="100" />
              </div>
            </div>
            <div>
              <label className="label">Description</label>
              <input className="input" maxLength={4000} value={m.description}
                onChange={(e) => update(i, { description: e.target.value })} />
            </div>
            <div>
              <label className="label">Evidence type</label>
              <select className="input" value={m.evidenceType} onChange={(e) => update(i, { evidenceType: e.target.value })}>
                {EVIDENCE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Acceptance criteria (what validators will verify)</label>
              <textarea className="input" required minLength={10} maxLength={6000} rows={4} value={m.acceptanceCriteria}
                onChange={(e) => update(i, { acceptanceCriteria: e.target.value })}
                placeholder={"- The site at the submitted URL loads and shows the new design\n- Pricing page lists all three tiers\n- Contact form is present on /contact"} />
            </div>
          </div>
        ))}

        <div className="flex items-center justify-between">
          <button type="button" className="btn-secondary"
            onClick={() => setMilestones((ms) => [...ms, { ...empty }])} disabled={milestones.length >= 20}>
            + Add milestone
          </button>
          <button className="btn-primary" disabled={busy}>{busy ? "Creating on-chain…" : "Create contract"}</button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </div>
  );
}

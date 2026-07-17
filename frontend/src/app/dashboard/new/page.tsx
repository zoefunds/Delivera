"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Icon } from "@/components/Icon";

interface MilestoneDraft {
  title: string;
  description: string;
  acceptanceCriteria: string;
  evidenceType: string;
  amountGen: string;
}

const EVIDENCE_TYPES: [string, string, string][] = [
  ["website", "Live website", "public"],
  ["github_repo", "GitHub repository", "terminal"],
  ["api_endpoint", "API endpoint", "api"],
  ["document", "Document / spec", "description"],
  ["article", "Article / content", "article"],
  ["design", "Design preview", "palette"],
  ["media", "Media page", "movie"],
  ["other", "Other URL", "link"],
];

const empty: MilestoneDraft = {
  title: "",
  description: "",
  acceptanceCriteria: "",
  evidenceType: "website",
  amountGen: "",
};

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

  const totalGen = useMemo(
    () => milestones.reduce((sum, m) => sum + (Number(m.amountGen) || 0), 0),
    [milestones],
  );

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
    <div className="mx-auto max-w-[1000px]">
      <div className="mb-10">
        <span className="mb-2 block font-mono text-label-mono uppercase tracking-wider text-primary">
          Protocol / New Contract
        </span>
        <h1 className="font-headline text-headline-lg text-on-surface">Initialize escrow contract</h1>
        <p className="mt-3 max-w-2xl text-on-surface-variant">
          Define concrete, verifiable milestones — GenLayer validators judge deliverables against exactly
          what you write here, not vibes.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-8">
        {/* Project identity */}
        <section className="card">
          <div className="mb-6 flex items-center gap-3">
            <Icon name="description" className="text-primary" />
            <h2 className="font-headline text-headline-md text-on-surface">Project identity</h2>
          </div>
          <div className="space-y-5">
            <div>
              <label className="label" htmlFor="title">
                Contract title
              </label>
              <input
                className="input"
                id="title"
                name="title"
                required
                maxLength={200}
                placeholder="Marketing site redesign"
              />
            </div>
            <div>
              <label className="label" htmlFor="description">
                Description
              </label>
              <textarea className="input" id="description" name="description" rows={3} maxLength={8000} />
            </div>
            <div>
              <label className="label" htmlFor="providerEmail">
                Provider&apos;s Delivera email
              </label>
              <input
                className="input"
                id="providerEmail"
                name="providerEmail"
                type="email"
                required
                placeholder="freelancer@example.com"
              />
            </div>
          </div>
        </section>

        {/* Milestones */}
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <Icon name="account_tree" className="text-primary" />
            <h2 className="font-headline text-headline-md text-on-surface">Milestone architecture</h2>
          </div>
          <div className="space-y-6">
            {milestones.map((m, i) => (
              <div key={i} className="card space-y-5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-label-mono text-primary">{String(i + 1).padStart(2, "0")}</span>
                  {milestones.length > 1 && (
                    <button
                      type="button"
                      className="text-on-surface-variant transition-colors hover:text-error"
                      onClick={() => setMilestones((ms) => ms.filter((_, j) => j !== i))}
                      aria-label="Remove milestone"
                    >
                      <Icon name="delete" />
                    </button>
                  )}
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label className="label">Title</label>
                    <input
                      className="input"
                      required
                      maxLength={200}
                      value={m.title}
                      onChange={(e) => update(i, { title: e.target.value })}
                      placeholder="Homepage live on production"
                    />
                  </div>
                  <div>
                    <label className="label">Amount (GEN)</label>
                    <input
                      className="input"
                      required
                      pattern="\d+(\.\d+)?"
                      value={m.amountGen}
                      onChange={(e) => update(i, { amountGen: e.target.value })}
                      placeholder="100"
                    />
                  </div>
                </div>
                <div>
                  <label className="label">Description</label>
                  <input
                    className="input"
                    maxLength={4000}
                    value={m.description}
                    onChange={(e) => update(i, { description: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Evidence type</label>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {EVIDENCE_TYPES.map(([value, labelText, icon]) => (
                      <label
                        key={value}
                        className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 p-4 text-center transition-all ${
                          m.evidenceType === value
                            ? "border-primary bg-primary/5"
                            : "border-border-subtle hover:border-primary/40 dark:border-white/10"
                        }`}
                      >
                        <input
                          type="radio"
                          className="sr-only"
                          checked={m.evidenceType === value}
                          onChange={() => update(i, { evidenceType: value })}
                        />
                        <Icon
                          name={icon}
                          className={m.evidenceType === value ? "text-primary" : "text-on-surface-variant"}
                        />
                        <span className="text-xs font-semibold leading-tight text-on-surface">{labelText}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="label">Acceptance criteria (what validators will verify)</label>
                  <textarea
                    className="input"
                    required
                    minLength={10}
                    maxLength={6000}
                    rows={4}
                    value={m.acceptanceCriteria}
                    onChange={(e) => update(i, { acceptanceCriteria: e.target.value })}
                    placeholder={
                      "- The site at the submitted URL loads and shows the new design\n- Pricing page lists all three tiers\n- Contact form is present on /contact"
                    }
                  />
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="flex items-center gap-2 rounded-lg border border-primary px-4 py-2 font-semibold text-primary transition-all hover:bg-primary/5"
            onClick={() => setMilestones((ms) => [...ms, { ...empty }])}
            disabled={milestones.length >= 20}
          >
            <Icon name="add" />
            Add milestone
          </button>
        </section>

        {/* Summary & submit */}
        <section className="rounded-xl border border-primary/20 bg-primary/5 p-8">
          <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
            <div>
              <h3 className="font-headline text-headline-md text-on-surface">Escrow summary</h3>
              <div className="mt-2 flex gap-8">
                <div>
                  <span className="block text-xs font-bold uppercase text-on-surface-variant">
                    Total escrow
                  </span>
                  <span className="text-2xl font-bold text-primary">
                    {totalGen.toLocaleString(undefined, { maximumFractionDigits: 4 })} GEN
                  </span>
                </div>
                <div>
                  <span className="block text-xs font-bold uppercase text-on-surface-variant">
                    Milestones
                  </span>
                  <span className="text-2xl font-bold text-on-surface-variant">{milestones.length}</span>
                </div>
              </div>
            </div>
            <div className="w-full md:w-auto">
              <button
                className="btn-primary w-full py-4 text-base md:w-64"
                disabled={busy}
              >
                <Icon name="lock" />
                {busy ? "Creating on-chain…" : "Lock escrow & create"}
              </button>
              <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-tighter text-on-surface-variant">
                Powered by GenLayer consensus
              </p>
            </div>
          </div>
          {error && <p className="mt-4 text-sm font-medium text-error">{error}</p>}
        </section>
      </form>
    </div>
  );
}

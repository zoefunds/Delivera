import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

const steps = [
  { n: "01", title: "Agree & lock escrow", body: "Client defines milestones with concrete acceptance criteria and locks payment in the on-chain escrow. The provider sees exactly what 'done' means before starting." },
  { n: "02", title: "Deliver with evidence", body: "The provider ships and submits URL-addressable evidence — the live site, the repo, the API, the published article." },
  { n: "03", title: "Validators verify independently", body: "Multiple GenLayer validators each fetch the evidence themselves and run their own AI evaluation against the criteria. No single party — not even our servers — decides." },
  { n: "04", title: "Funds release on consensus", body: "When validator consensus approves, funds move instantly to the provider. Rejections allow resubmission; disagreements go to AI arbitration with split settlements." },
];

const features = [
  { icon: "🔒", title: "Trustless escrow", body: "Funds sit in a GenLayer Intelligent Contract, not our bank account. Neither party can pull them out unilaterally." },
  { icon: "🧠", title: "AI verification with real evidence", body: "Validators fetch your live URLs during consensus — websites, GitHub repos, APIs, documents — and judge substance against criteria, never claims." },
  { icon: "🗳️", title: "Optimistic democracy", body: "One leader proposes, independent validators verify with tolerance-banded comparison, appeals escalate to more validators." },
  { icon: "⚖️", title: "AI dispute arbitration", body: "Deadlocked? Both parties state their case; validator consensus adjudicates a fair split in basis points, settled on-chain." },
  { icon: "🔁", title: "Resubmission-friendly", body: "Needs-revision verdicts include reasoning from the AI review, and providers get bounded retries before escrow unwinds." },
  { icon: "👛", title: "Zero-friction wallets", body: "Sign up with email and password. Your GenLayer wallet is created automatically, survives any device change, and stays exportable." },
];

export default function Landing() {
  return (
    <main>
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="text-xl font-bold text-brand-600">Delivera</div>
        <nav className="flex items-center gap-3">
          <Link href="#how" className="hidden text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white sm:block">How it works</Link>
          <Link href="#features" className="hidden text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white sm:block">Features</Link>
          <ThemeToggle />
          <Link href="/login" className="btn-secondary">Sign in</Link>
          <Link href="/register" className="btn-primary">Get started</Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-20 pt-16 text-center">
        <p className="mx-auto mb-4 w-fit rounded-full border border-brand-200 bg-brand-50 px-4 py-1 text-xs font-semibold text-brand-700 dark:border-brand-800 dark:bg-brand-900/30 dark:text-brand-300">
          Powered by GenLayer Intelligent Contracts on StudioNet
        </p>
        <h1 className="mx-auto max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl">
          Get paid when the work is <span className="text-brand-600">provably done</span>.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600 dark:text-slate-400">
          Delivera locks payment in on-chain escrow and releases it only when independent AI validators
          verify — against your live deliverables — that the agreed work was completed. No chasing invoices.
          No he-said-she-said. No trusted middleman.
        </p>
        <div className="mt-8 flex justify-center gap-4">
          <Link href="/register" className="btn-primary px-6 py-3 text-base">Create a contract</Link>
          <Link href="#how" className="btn-secondary px-6 py-3 text-base">See how it works</Link>
        </div>
      </section>

      <section id="how" className="border-y border-slate-200 bg-slate-50 py-20 dark:border-slate-800 dark:bg-slate-900/40">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-bold">How it works</h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s) => (
              <div key={s.n} className="card">
                <div className="text-sm font-bold text-brand-600">{s.n}</div>
                <h3 className="mt-2 font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-bold">Built for freelancers, agencies, DAOs and enterprises</h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="card">
                <div className="text-2xl">{f.icon}</div>
                <h3 className="mt-3 font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-slate-200 bg-brand-600 py-16 text-center text-white dark:border-slate-800">
        <h2 className="text-3xl font-bold">Stop trusting. Start verifying.</h2>
        <p className="mx-auto mt-3 max-w-xl text-brand-100">
          Create your first performance-based contract in minutes.
        </p>
        <Link href="/register" className="mt-6 inline-block rounded-lg bg-white px-6 py-3 font-semibold text-brand-700">
          Get started free
        </Link>
      </section>

      <footer className="mx-auto flex max-w-6xl items-center justify-between px-6 py-8 text-sm text-slate-500">
        <span>© {new Date().getFullYear()} Delivera</span>
        <span>Escrow · AI verification · Validator consensus</span>
      </footer>
    </main>
  );
}

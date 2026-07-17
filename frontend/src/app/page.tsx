import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Icon } from "@/components/Icon";
import { Logo } from "@/components/Logo";

const steps = [
  {
    n: "01",
    icon: "edit_note",
    title: "Agree & lock escrow",
    body: "Client defines milestones with concrete acceptance criteria and locks payment in the on-chain escrow. The provider sees exactly what 'done' means before starting.",
  },
  {
    n: "02",
    icon: "upload_file",
    title: "Deliver with evidence",
    body: "The provider ships and submits URL-addressable evidence — the live site, the repo, the API, the published article.",
  },
  {
    n: "03",
    icon: "psychology",
    title: "Validators verify independently",
    body: "Multiple GenLayer validators each fetch the evidence themselves and run their own AI evaluation against the criteria. No single party — not even our servers — decides.",
  },
  {
    n: "04",
    icon: "payments",
    title: "Funds release on consensus",
    body: "When validator consensus approves, funds move instantly to the provider. Rejections allow resubmission; disagreements go to AI arbitration with split settlements.",
  },
];

const features = [
  {
    icon: "lock",
    title: "Trustless escrow",
    body: "Funds sit in a GenLayer Intelligent Contract, not our bank account. Neither party can pull them out unilaterally.",
  },
  {
    icon: "neurology",
    title: "AI verification with real evidence",
    body: "Validators fetch your live URLs during consensus — websites, GitHub repos, APIs, documents — and judge substance against criteria, never claims.",
  },
  {
    icon: "how_to_vote",
    title: "Optimistic democracy",
    body: "One leader proposes, independent validators verify with tolerance-banded comparison, appeals escalate to more validators.",
  },
  {
    icon: "balance",
    title: "AI dispute arbitration",
    body: "Deadlocked? Both parties state their case; validator consensus adjudicates a fair split in basis points, settled on-chain.",
  },
  {
    icon: "sync_alt",
    title: "Resubmission-friendly",
    body: "Needs-revision verdicts include reasoning from the AI review, and providers get bounded retries before escrow unwinds.",
  },
  {
    icon: "account_balance_wallet",
    title: "Zero-friction wallets",
    body: "Sign up with email and password. Your GenLayer wallet is created automatically, survives any device change, and stays exportable.",
  },
];

export default function Landing() {
  return (
    <main className="bg-surface font-sans text-on-surface">
      {/* Top nav */}
      <header className="sticky top-0 z-50 border-b border-border-subtle bg-surface/80 backdrop-blur-md">
        <nav className="mx-auto flex h-20 max-w-[1440px] items-center justify-between px-safe-margin">
          <div className="flex items-center gap-10">
            <Link href="/">
              <Logo />
            </Link>
            <div className="hidden items-center gap-6 sm:flex">
              <Link href="#how" className="text-sm text-on-surface-variant transition-colors hover:text-primary">
                How it works
              </Link>
              <Link href="#features" className="text-sm text-on-surface-variant transition-colors hover:text-primary">
                Features
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link href="/login" className="btn-ghost">
              Sign in
            </Link>
            <Link href="/register" className="btn-primary">
              Get started
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden px-safe-margin pb-24 pt-20 text-center md:pb-32 md:pt-28">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ background: "radial-gradient(circle at 50% 0%, rgba(53,37,205,0.07) 0%, transparent 60%)" }}
        />
        <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/5 px-4 py-1.5 text-primary">
          <span className="font-mono text-label-mono uppercase tracking-wider">Powered by GenLayer</span>
          <span className="h-1 w-1 rounded-full bg-primary" />
          <span className="font-mono text-label-mono">Intelligent Contracts on StudioNet</span>
        </div>
        <h1 className="mx-auto mt-8 max-w-3xl font-headline text-display-hero-mobile text-on-background md:text-display-hero">
          Get paid when the work is <span className="italic text-primary">provably</span> done.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-on-surface-variant">
          Delivera locks payment in on-chain escrow and releases it only when independent AI validators
          verify — against your live deliverables — that the agreed work was completed. No chasing
          invoices. No he-said-she-said. No trusted middleman.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link href="/register" className="btn-primary px-8 py-4 text-base shadow-glow">
            Create a contract
            <Icon name="arrow_forward" />
          </Link>
          <Link href="#how" className="btn-secondary px-8 py-4 text-base">
            See how it works
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="bg-surface-container-lowest py-section-gap-mobile md:py-section-gap dark:bg-white/[0.02]">
        <div className="mx-auto max-w-[1440px] px-safe-margin">
          <div className="mb-16 flex flex-col items-end justify-between gap-8 md:flex-row">
            <div className="max-w-xl">
              <span className="mb-3 block font-mono text-label-mono uppercase tracking-wide text-primary">
                The Protocol
              </span>
              <h2 className="font-headline text-headline-lg text-on-surface">
                Built for precision. Verified by consensus.
              </h2>
            </div>
            <p className="max-w-md text-on-surface-variant">
              Delivera transforms service agreements into executable logic that acts as a neutral third
              party for every transaction.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-grid-gutter sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s) => (
              <div
                key={s.n}
                className="group rounded-xl border border-border-subtle bg-surface-container-lowest p-8 transition-all hover:border-primary dark:border-white/10 dark:bg-white/5"
              >
                <span className="mb-8 block font-mono text-4xl text-primary/20 transition-colors group-hover:text-primary">
                  {s.n}
                </span>
                <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/5 text-primary">
                  <Icon name={s.icon} />
                </div>
                <h3 className="mb-3 font-headline text-headline-sm text-on-surface">{s.title}</h3>
                <p className="leading-relaxed text-on-surface-variant">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="bg-surface-alt py-section-gap-mobile md:py-section-gap dark:bg-transparent">
        <div className="mx-auto max-w-[1440px] px-safe-margin">
          <div className="mb-16 text-center">
            <span className="mb-3 block font-mono text-label-mono uppercase tracking-wide text-primary">
              Architectural Trust
            </span>
            <h2 className="mx-auto max-w-2xl font-headline text-headline-lg text-on-surface">
              Built for freelancers, agencies, DAOs and enterprises.
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="group rounded-xl border border-border-subtle bg-surface-container-lowest p-8 transition-all hover:shadow-glow dark:border-white/10 dark:bg-white/5"
              >
                <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-lg bg-surface-container text-primary transition-transform group-hover:scale-110 dark:bg-white/10">
                  <Icon name={f.icon} filled />
                </div>
                <h4 className="mb-3 font-headline text-headline-sm text-on-surface">{f.title}</h4>
                <p className="leading-relaxed text-on-surface-variant">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative overflow-hidden py-24 text-center">
        <div className="pointer-events-none absolute inset-0 bg-primary opacity-[0.04]" />
        <div className="relative mx-auto max-w-[1440px] px-safe-margin">
          <h2 className="mb-6 font-headline text-headline-lg text-on-surface md:text-display-hero-mobile">
            Stop trusting. Start verifying.
          </h2>
          <p className="mx-auto mb-10 max-w-xl text-lg text-on-surface-variant">
            Create your first performance-based contract in minutes.
          </p>
          <Link
            href="/register"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-8 py-4 text-lg font-bold text-on-primary shadow-glow transition-all hover:-translate-y-0.5"
          >
            Get started free
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border-subtle bg-surface-container-lowest px-safe-margin py-stack-md dark:border-white/10 dark:bg-transparent">
        <div className="mx-auto flex max-w-[1440px] flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-4">
            <Logo wordmarkClassName="text-headline-sm" />
            <span className="hidden text-on-surface-variant/50 sm:inline">|</span>
            <span className="text-sm text-on-surface-variant/70">© {new Date().getFullYear()} Delivera</span>
          </div>
          <div className="flex gap-6 font-mono text-label-mono text-on-surface-variant/70">
            <span>Escrow</span>
            <span>AI verification</span>
            <span>Validator consensus</span>
          </div>
        </div>
      </footer>
    </main>
  );
}

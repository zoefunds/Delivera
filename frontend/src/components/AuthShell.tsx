import Link from "next/link";
import { Icon } from "./Icon";
import { Logo, LogoMark } from "./Logo";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col bg-surface font-sans md:flex-row">
      {/* Branding side */}
      <section className="relative hidden items-center justify-center overflow-hidden bg-primary p-12 md:flex md:w-1/2">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(circle at 70% 20%, rgba(255,255,255,0.12) 0%, transparent 55%)" }}
        />
        <div className="relative z-10 w-full max-w-lg space-y-10">
          <LogoMark className="h-10 w-10" />
          <h1 className="font-headline text-headline-lg leading-tight text-on-primary">
            Securing the future of performance-based commerce.
          </h1>
          <p className="max-w-md text-lg leading-relaxed text-on-primary/80">
            Escrow infrastructure verified by AI-driven validator consensus, not a middleman.
          </p>
          <div className="grid grid-cols-2 gap-grid-gutter">
            <div className="rounded-xl border border-white/10 bg-white/10 p-6 backdrop-blur-sm">
              <span className="mb-2 block font-mono text-label-mono text-white/60">01. PROTOCOL</span>
              <p className="font-headline text-headline-sm text-white">Immutable Safety</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/10 p-6 backdrop-blur-sm">
              <span className="mb-2 block font-mono text-label-mono text-white/60">02. CONSENSUS</span>
              <p className="font-headline text-headline-sm text-white">AI Verified</p>
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur-md">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-success-emerald">
                  <Icon name="check_circle" className="!text-base text-white" filled />
                </div>
                <span className="font-mono text-label-mono text-white">Contract Active</span>
              </div>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-3/4 rounded-full bg-primary-fixed" />
            </div>
          </div>
        </div>
      </section>

      {/* Form side */}
      <section className="flex flex-1 flex-col items-center justify-center px-safe-margin py-16">
        <div className="mb-10 md:hidden">
          <Link href="/">
            <Logo />
          </Link>
        </div>
        <div className="w-full max-w-md">
          <div className="hidden md:block">
            <Link href="/" className="mb-8 inline-block">
              <Logo wordmarkClassName="text-headline-sm" />
            </Link>
          </div>
          {children}
          <footer className="mt-12 border-t border-border-subtle pt-8 dark:border-white/10">
            <p className="text-center font-mono text-[11px] uppercase tracking-widest text-outline">
              Architectural Trust © {new Date().getFullYear()} Delivera
            </p>
          </footer>
        </div>
      </section>
    </main>
  );
}

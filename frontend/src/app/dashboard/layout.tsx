"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, setAccessToken } from "@/lib/api";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Icon } from "@/components/Icon";
import { Logo } from "@/components/Logo";

interface Me {
  id: string;
  email: string | null;
  name: string;
  walletAddress: string | null;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    api.get<Me>("/auth/me").then(setMe).catch(() => router.push("/login"));
  }, [router]);

  const nav = [
    { href: "/dashboard", label: "Contracts", icon: "description" },
    { href: "/dashboard/new", label: "New contract", icon: "add_circle" },
    { href: "/dashboard/wallet", label: "Wallet", icon: "account_balance_wallet" },
    { href: "/dashboard/notifications", label: "Notifications", icon: "notifications" },
  ];

  const initials =
    me?.name
      .trim()
      .split(/\s+/)
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "";

  return (
    <div className="flex min-h-screen flex-col bg-surface font-sans text-on-surface">
      <header className="sticky top-0 z-50 border-b border-border-subtle bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex h-20 max-w-[1440px] items-center justify-between px-safe-margin">
          <div className="flex items-center gap-10">
            <Link href="/">
              <Logo wordmarkClassName="text-headline-sm hidden sm:inline" />
            </Link>
            <nav className="hidden items-center gap-1 md:flex">
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                    pathname === n.href
                      ? "bg-primary-fixed text-on-primary-fixed-variant"
                      : "text-on-surface-variant hover:bg-surface-container-low dark:hover:bg-white/5"
                  }`}
                >
                  <Icon name={n.icon} className="!text-lg" />
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              href="/dashboard/notifications"
              className="rounded-full p-2 text-on-surface-variant transition-all hover:bg-surface-container-low active:scale-95 md:hidden dark:hover:bg-white/10"
              aria-label="Notifications"
            >
              <Icon name="notifications" />
            </Link>
            <div className="mx-1 hidden h-8 w-px bg-border-subtle sm:block dark:bg-white/10" />
            {me && (
              <div className="hidden h-10 w-10 items-center justify-center rounded-full bg-primary-container font-headline font-bold text-on-primary sm:flex">
                {initials}
              </div>
            )}
            <button
              className="btn-secondary"
              onClick={async () => {
                await api.post("/auth/logout").catch(() => {});
                setAccessToken(null);
                router.push("/");
              }}
            >
              Sign out
            </button>
          </div>
        </div>
        {/* Mobile nav */}
        <nav className="flex items-center gap-1 overflow-x-auto border-t border-border-subtle px-safe-margin py-2 md:hidden dark:border-white/10">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                pathname === n.href
                  ? "bg-primary-fixed text-on-primary-fixed-variant"
                  : "text-on-surface-variant"
              }`}
            >
              <Icon name={n.icon} className="!text-base" />
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-[1440px] flex-grow px-safe-margin py-stack-md">{children}</main>
      <footer className="border-t border-border-subtle bg-surface-container-lowest px-safe-margin py-stack-md dark:border-white/10 dark:bg-transparent">
        <div className="mx-auto flex max-w-[1440px] flex-col items-center justify-between gap-4 text-sm text-on-surface-variant/70 sm:flex-row">
          <span>© {new Date().getFullYear()} Delivera Protocol</span>
          <span className="font-mono text-label-mono">Escrow · AI verification · Validator consensus</span>
        </div>
      </footer>
    </div>
  );
}

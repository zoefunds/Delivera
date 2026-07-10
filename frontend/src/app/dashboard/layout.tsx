"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, setAccessToken } from "@/lib/api";
import { ThemeToggle } from "@/components/ThemeToggle";

interface Me {
  id: string;
  email: string;
  name: string;
  walletAddress: string | null;
  emailVerified: boolean;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    api.get<Me>("/auth/me").then(setMe).catch(() => router.push("/login"));
  }, [router]);

  const nav = [
    { href: "/dashboard", label: "Contracts" },
    { href: "/dashboard/new", label: "New contract" },
    { href: "/dashboard/wallet", label: "Wallet" },
    { href: "/dashboard/notifications", label: "Notifications" },
  ];

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 dark:border-slate-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-8">
            <Link href="/" className="text-lg font-bold text-brand-600">Delivera</Link>
            <nav className="hidden gap-1 sm:flex">
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                    pathname === n.href
                      ? "bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-900"
                  }`}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            {me && <span className="hidden text-sm text-slate-500 sm:block">{me.email}</span>}
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
      </header>
      {me && !me.emailVerified && (
        <div className="bg-amber-50 px-6 py-2 text-center text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          Please verify your email — check your inbox for the verification link.
        </div>
      )}
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}

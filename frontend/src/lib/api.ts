"use client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

let accessToken: string | null = null;
export function setAccessToken(token: string | null) {
  accessToken = token;
  if (typeof window !== "undefined") {
    if (token) sessionStorage.setItem("delivera_at", token);
    else sessionStorage.removeItem("delivera_at");
  }
}
export function getAccessToken(): string | null {
  if (accessToken) return accessToken;
  if (typeof window !== "undefined") accessToken = sessionStorage.getItem("delivera_at");
  return accessToken;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    credentials: "include",
    headers: {
      // Only claim a JSON body when one is actually being sent — Fastify's
      // JSON parser rejects an application/json request with no body at all
      // (e.g. POST /contracts/:id/cancel, which takes no payload), so a
      // fixed Content-Type header here broke every no-body POST.
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
      ...init.headers,
    },
  });
  if (res.status === 401 && retry && path !== "/auth/refresh" && path !== "/auth/login") {
    // try one silent refresh
    try {
      const r = await fetch(`${API_URL}/api/v1/auth/refresh`, { method: "POST", credentials: "include" });
      if (r.ok) {
        const { accessToken: at } = await r.json();
        setAccessToken(at);
        return request<T>(path, init, false);
      }
    } catch { /* fall through */ }
    setAccessToken(null);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body?.error ?? {};
    throw new ApiError(res.status, err.code ?? "UNKNOWN", err.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export const usdcAddress =
  process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

/** Formats a raw on-chain USDC amount (6-decimal base units) — use this only
 * for values read directly from an ERC20 balanceOf/transfer, e.g. the
 * connected wallet's live Base Sepolia balance. */
export function formatUsdc(amount: string | number | bigint | null | undefined): string {
  return formatScaled(amount, 6n);
}

/** Formats a Delivera contract/milestone ledger amount — these are stored
 * 18-decimal-scaled dollar-equivalent values (the "*Atto" columns, inherited
 * from GenLayer's native-GEN accounting convention; see dollarsToAtto() in
 * dashboard/new/page.tsx), NOT raw on-chain USDC units. Mixing this up with
 * `formatUsdc` displays amounts ~1e12x too large. */
export function formatContractAmount(amount: string | number | bigint | null | undefined): string {
  return formatScaled(amount, 18n);
}

function formatScaled(amount: string | number | bigint | null | undefined, decimals: bigint): string {
  if (amount === null || amount === undefined) return "—";
  try {
    const base = 10n ** decimals;
    const value = BigInt(String(amount));
    const whole = value / base;
    const frac = ((value % base) * 100n) / base;
    return `${whole}.${frac.toString().padStart(2, "0")} USDC`;
  } catch {
    return String(amount);
  }
}

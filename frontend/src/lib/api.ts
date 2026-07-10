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
      "Content-Type": "application/json",
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

export function formatGen(atto: string | number | null | undefined): string {
  if (atto === null || atto === undefined) return "—";
  try {
    const value = BigInt(String(atto));
    const whole = value / 10n ** 18n;
    const frac = ((value % 10n ** 18n) * 100n) / 10n ** 18n;
    return `${whole}.${frac.toString().padStart(2, "0")} GEN`;
  } catch {
    return String(atto);
  }
}

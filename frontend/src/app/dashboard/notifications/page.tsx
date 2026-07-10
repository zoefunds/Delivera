"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Notification { id: string; title: string; body: string; readAt: string | null; createdAt: string }

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[] | null>(null);

  const load = () => api.get<Notification[]>("/notifications").then(setItems).catch(() => setItems([]));
  useEffect(() => { void load(); }, []);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">Notifications</h1>
      {items === null ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">Nothing yet — contract events will appear here and in your inbox.</p>
      ) : (
        <div className="mt-6 space-y-3">
          {items.map((n) => (
            <button key={n.id}
              className={`card block w-full text-left ${n.readAt ? "opacity-60" : ""}`}
              onClick={() => api.post(`/notifications/${n.id}/read`).then(load)}>
              <p className="font-medium">{n.title}</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{n.body}</p>
              <p className="mt-1 text-xs text-slate-400">{new Date(n.createdAt).toLocaleString()}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

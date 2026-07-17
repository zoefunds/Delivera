"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Icon } from "@/components/Icon";

interface Notification { id: string; title: string; body: string; readAt: string | null; createdAt: string }

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[] | null>(null);

  const load = () => api.get<Notification[]>("/notifications").then(setItems).catch(() => setItems([]));
  useEffect(() => { void load(); }, []);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-headline text-headline-lg text-on-surface">Notifications</h1>
      {items === null ? (
        <p className="mt-6 text-on-surface-variant">Loading…</p>
      ) : items.length === 0 ? (
        <p className="mt-6 text-on-surface-variant">
          Nothing yet — contract events will appear here and in your inbox.
        </p>
      ) : (
        <div className="mt-6 space-y-3">
          {items.map((n) => (
            <button
              key={n.id}
              className={`card flex w-full items-start gap-4 text-left transition-opacity ${n.readAt ? "opacity-60" : ""}`}
              onClick={() => api.post(`/notifications/${n.id}/read`).then(load)}
            >
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon name={n.readAt ? "mark_email_read" : "mark_email_unread"} className="!text-base" />
              </div>
              <div>
                <p className="font-semibold text-on-surface">{n.title}</p>
                <p className="mt-1 text-sm text-on-surface-variant">{n.body}</p>
                <p className="mt-1 font-mono text-xs text-outline">{new Date(n.createdAt).toLocaleString()}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

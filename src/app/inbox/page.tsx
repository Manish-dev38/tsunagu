"use client";

import { useState } from "react";
import { isUnread } from "@/server/adapters/corsair";
import { api } from "@/trpc/provider";

export default function InboxPage() {
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const list = api.inbox.list.useQuery({ filter, query: query || undefined });
  const message = api.inbox.message.useQuery(
    { id: openId ?? "" },
    { enabled: openId !== null },
  );
  const utils = api.useUtils();

  const refresh = api.inbox.refresh.useMutation({
    onSuccess: () => {
      setRefreshError(null);
      void utils.inbox.list.invalidate();
      // an open message may have been deleted in Gmail
      void utils.inbox.message.invalidate();
    },
    onError: (e) => setRefreshError(e.message),
  });

  // The SDK's auth-missing error embeds a connect link that expires in minutes; mint a fresh one on click.
  const connect = api.connectors.connectUrl.useMutation({
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (e) => setRefreshError(e.message),
  });

  if (list.isPending) return <p className="text-sm text-neutral-500">Loading…</p>;

  if (list.error) {
    return (
      <div>
        <h1 className="mb-4 text-xl font-semibold">Inbox</h1>
        <p className="text-sm text-red-600">{list.error.message}</p>
      </div>
    );
  }

  return (
    <div className="flex gap-8">
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Inbox</h1>
          <button
            className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 disabled:opacity-50"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            {refresh.isPending ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div className="mb-4 flex gap-2">
          <input
            className="w-full rounded border border-neutral-300 px-3 py-1 text-sm"
            placeholder="Search mail…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="flex shrink-0 rounded border border-neutral-300 text-sm">
            {(["all", "unread"] as const).map((f) => (
              <button
                key={f}
                className={
                  filter === f
                    ? "rounded bg-neutral-900 px-3 py-1 text-white"
                    : "px-3 py-1 hover:bg-neutral-100"
                }
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "All" : "Unread"}
              </button>
            ))}
          </div>
        </div>

        {refreshError &&
          (refreshError.includes("[auth-missing:") ? (
            <p className="mb-2 text-sm text-amber-700">
              Gmail isn&apos;t connected yet.{" "}
              <button
                className="underline disabled:opacity-50"
                disabled={connect.isPending}
                onClick={() => connect.mutate({ connector: "gmail" })}
              >
                {connect.isPending ? "Opening…" : "Connect Gmail"}
              </button>
            </p>
          ) : (
            <p className="mb-2 text-sm text-red-600">{refreshError}</p>
          ))}

        <p className="mb-2 text-xs text-neutral-400">
          {list.data.unreadCount} unread · last synced{" "}
          {list.data.lastSyncedAt ? new Date(list.data.lastSyncedAt).toLocaleString() : "never"}
        </p>

        {list.data.messages.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No mail yet. Connect Gmail and hit Refresh to sync.
          </p>
        ) : (
          <ul>
            {list.data.messages.map((m) => (
              <li key={m.id}>
                <button
                  className={`block w-full border-b border-neutral-200 px-2 py-3 text-left hover:bg-neutral-50 ${
                    openId === m.id ? "bg-neutral-50" : ""
                  }`}
                  onClick={() => setOpenId(m.id)}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={`truncate text-sm ${
                        isUnread(m) ? "font-semibold" : "font-normal"
                      }`}
                    >
                      {m.from}
                    </span>
                    <span className="shrink-0 text-xs text-neutral-400">
                      {m.internalDate ? new Date(m.internalDate).toLocaleDateString() : ""}
                    </span>
                  </div>
                  <div
                    className={`truncate text-sm ${
                      isUnread(m) ? "font-medium text-neutral-900" : "text-neutral-700"
                    }`}
                  >
                    {m.subject}
                  </div>
                  <div className="truncate text-xs text-neutral-500">{m.snippet}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {openId && (
        <div className="w-96 shrink-0 border-l border-neutral-200 pl-6">
          {message.isPending ? (
            <p className="text-sm text-neutral-500">Loading…</p>
          ) : message.data ? (
            <div>
              <button
                className="mb-3 text-xs text-neutral-500 hover:text-neutral-800"
                onClick={() => setOpenId(null)}
              >
                ← Back to list
              </button>
              <h2 className="mb-1 font-medium">{message.data.subject}</h2>
              <p className="mb-1 text-xs text-neutral-500">
                From {message.data.from} · to {message.data.to}
              </p>
              <p className="mb-3 text-xs text-neutral-400">
                {message.data.internalDate
                  ? new Date(message.data.internalDate).toLocaleString()
                  : ""}
              </p>
              <div className="whitespace-pre-wrap text-sm text-neutral-800">{message.data.body}</div>
            </div>
          ) : (
            <p className="text-sm text-neutral-500">Message not found in cache.</p>
          )}
        </div>
      )}
    </div>
  );
}

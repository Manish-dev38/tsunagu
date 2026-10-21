"use client";

import { useState } from "react";
import { isUnread, type CachedMessage } from "@/server/adapters/corsair";
import { api } from "@/trpc/provider";

export default function InboxPage() {
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const list = api.inbox.list.useQuery({ filter, query: query || undefined });
  const message = api.inbox.message.useQuery(
    { id: openId ?? "" },
    { enabled: openId !== null },
  );
  const utils = api.useUtils();

  const invalidateMail = () => {
    void utils.inbox.list.invalidate();
    // an open message may have been archived or relabeled
    void utils.inbox.message.invalidate();
  };

  const refresh = api.inbox.refresh.useMutation({
    onSuccess: () => {
      setError(null);
      invalidateMail();
    },
    onError: (e) => setError(e.message),
  });

  const send = api.inbox.send.useMutation({
    onSuccess: () => {
      setError(null);
      setComposing(false);
      setTo("");
      setSubject("");
      setBody("");
      invalidateMail();
    },
    onError: (e) => setError(e.message),
  });

  const archive = api.inbox.archive.useMutation({
    onSuccess: () => {
      setError(null);
      setOpenId(null);
      invalidateMail();
    },
    onError: (e) => setError(e.message),
  });

  const star = api.inbox.setStarred.useMutation({
    onSuccess: () => {
      setError(null);
      invalidateMail();
    },
    onError: (e) => setError(e.message),
  });

  const markRead = api.inbox.setRead.useMutation({
    onSuccess: () => {
      setError(null);
      invalidateMail();
    },
    onError: (e) => setError(e.message),
  });

  // The SDK's auth-missing error embeds a connect link that expires in minutes; mint a fresh one on click.
  const connect = api.connectors.connectUrl.useMutation({
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (e) => setError(e.message),
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

  const detail = message.data;

  return (
    <div className="flex gap-8">
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Inbox</h1>
          <div className="flex gap-2">
            <button
              className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 disabled:opacity-50"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate()}
            >
              {refresh.isPending ? "Refreshing…" : "Refresh"}
            </button>
            <button
              className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50"
              disabled={composing}
              onClick={() => setComposing(true)}
            >
              Compose
            </button>
          </div>
        </div>

        {composing && (
          <form
            className="mb-4 space-y-2 rounded border border-neutral-200 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send.mutate({ to, subject, body });
            }}
          >
            <input
              className="w-full rounded border border-neutral-300 px-3 py-1 text-sm"
              placeholder="To"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <input
              className="w-full rounded border border-neutral-300 px-3 py-1 text-sm"
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
            <textarea
              className="w-full rounded border border-neutral-300 px-3 py-1 text-sm"
              placeholder="Message"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                type="submit"
                className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50"
                disabled={send.isPending || !to.trim()}
              >
                {send.isPending ? "Sending…" : "Send"}
              </button>
              <button
                type="button"
                className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 disabled:opacity-50"
                disabled={send.isPending}
                onClick={() => setComposing(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

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

        {error &&
          (error.includes("[auth-missing:") ? (
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
            <p className="mb-2 text-sm text-red-600">{error}</p>
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
                      {m.labelIds.includes("STARRED") ? "★ " : ""}
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
          ) : detail ? (
            <MessageDetail
              detail={detail}
              pending={archive.isPending || star.isPending || markRead.isPending}
              onBack={() => setOpenId(null)}
              onArchive={() => archive.mutate({ id: detail.id })}
              onToggleStar={() =>
                star.mutate({
                  id: detail.id,
                  starred: !detail.labelIds.includes("STARRED"),
                })
              }
              onToggleRead={() => markRead.mutate({ id: detail.id, read: isUnread(detail) })}
            />
          ) : (
            <p className="text-sm text-neutral-500">Message not found in cache.</p>
          )}
        </div>
      )}
    </div>
  );
}

function MessageDetail({
  detail,
  pending,
  onBack,
  onArchive,
  onToggleStar,
  onToggleRead,
}: {
  detail: CachedMessage;
  pending: boolean;
  onBack: () => void;
  onArchive: () => void;
  onToggleStar: () => void;
  onToggleRead: () => void;
}) {
  const starred = detail.labelIds.includes("STARRED");
  return (
    <div>
      <button className="mb-3 text-xs text-neutral-500 hover:text-neutral-800" onClick={onBack}>
        ← Back to list
      </button>
      <div className="mb-3 flex flex-wrap gap-2">
        <button
          className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50"
          disabled={pending}
          onClick={onArchive}
        >
          Archive
        </button>
        <button
          className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50"
          disabled={pending}
          onClick={onToggleStar}
        >
          {starred ? "Unstar" : "Star"}
        </button>
        <button
          className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50"
          disabled={pending}
          onClick={onToggleRead}
        >
          {isUnread(detail) ? "Mark read" : "Mark unread"}
        </button>
      </div>
      <h2 className="mb-1 font-medium">{detail.subject}</h2>
      <p className="mb-1 text-xs text-neutral-500">
        From {detail.from} · to {detail.to}
      </p>
      <p className="mb-3 text-xs text-neutral-400">
        {detail.internalDate ? new Date(detail.internalDate).toLocaleString() : ""}
      </p>
      <div className="whitespace-pre-wrap text-sm text-neutral-800">{detail.body}</div>
    </div>
  );
}

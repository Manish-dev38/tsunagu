"use client";

import { useState } from "react";
import { api } from "@/trpc/provider";

const KIND_LABELS: Record<string, string> = {
  "email.send": "Send email",
  "mail.archive": "Archive email",
  "mail.unarchive": "Unarchive email",
  "mail.star": "Star email",
  "mail.unstar": "Unstar email",
  "mail.mark_read": "Mark read",
  "mail.mark_unread": "Mark unread",
  "calendar.create": "Create event",
  "calendar.reschedule": "Reschedule event",
  "calendar.cancel": "Cancel event",
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  approved: "bg-blue-50 text-blue-700",
  edited: "bg-blue-50 text-blue-700",
  discarded: "bg-neutral-100 text-neutral-500",
  executed: "bg-green-50 text-green-700",
  failed: "bg-red-50 text-red-700",
};

function titleOf(payload: Record<string, unknown> | null): string | null {
  if (payload && typeof payload.subject === "string") return payload.subject;
  if (payload && typeof payload.summary === "string") return payload.summary;
  return null;
}

export default function ActionPage() {
  const [error, setError] = useState<string | null>(null);
  const list = api.action.list.useQuery();
  const utils = api.useUtils();

  const undo = api.action.undo.useMutation({
    onSuccess: () => {
      setError(null);
      void utils.action.list.invalidate();
    },
    onError: (e) => setError(e.message),
  });

  if (list.isPending) return <p className="text-sm text-neutral-500">Loading…</p>;
  if (list.error)
    return <p className="text-sm text-red-600">Couldn&apos;t load actions: {list.error.message}</p>;

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Action log</h1>
      <p className="text-sm text-neutral-500">
        Everything the assistant and you have done, newest first.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {list.data.length === 0 && <p className="text-sm text-neutral-500">No actions yet.</p>}
      <ul className="space-y-2">
        {list.data.map((row) => {
          const title = titleOf(row.payload);
          return (
            <li key={row.id} className="flex items-start justify-between gap-3 rounded border border-neutral-200 p-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{KIND_LABELS[row.kind] ?? row.kind}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${STATUS_STYLES[row.status] ?? "bg-neutral-100 text-neutral-600"}`}
                  >
                    {row.status}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {row.initiator === "human" ? "You" : "Agent"}
                  </span>
                </div>
                {title && <p className="truncate text-sm text-neutral-600">{title}</p>}
                <time className="text-xs text-neutral-400" dateTime={new Date(row.createdAt).toISOString()}>
                  {new Date(row.createdAt).toLocaleString()}
                </time>
              </div>
              {row.undoable && (
                <button
                  onClick={() => undo.mutate({ actionId: row.id })}
                  disabled={undo.isPending}
                  aria-label={`Undo ${KIND_LABELS[row.kind] ?? row.kind}`}
                  className="shrink-0 rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50"
                >
                  Undo
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

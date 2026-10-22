"use client";

import { useState } from "react";
import { api } from "@/trpc/provider";

export default function MemoryPage() {
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const list = api.memory.list.useQuery();
  const utils = api.useUtils();

  const update = api.memory.update.useMutation({
    onSuccess: () => {
      setError(null);
      setEditingId(null);
      void utils.memory.list.invalidate();
    },
    onError: (e) => setError(e.message),
  });

  const remove = api.memory.delete.useMutation({
    onSuccess: () => {
      setError(null);
      void utils.memory.list.invalidate();
    },
    onError: (e) => setError(e.message),
  });

  if (list.isPending) return <p className="text-sm text-neutral-500">Loading…</p>;
  if (list.error)
    return <p className="text-sm text-red-600">Couldn&apos;t load memory: {list.error.message}</p>;

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Memory</h1>
      <p className="text-sm text-neutral-500">
        Facts the assistant knows about you. Say &quot;remember …&quot; in Chat to add one.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {list.data && list.data.length === 0 && (
        <p className="text-sm text-neutral-500">No memories yet.</p>
      )}
      <ul className="space-y-3">
        {list.data?.map((item) => (
          <li key={item.id} className="rounded border border-neutral-200 p-3">
            <span
              className={`mb-2 inline-block rounded px-1.5 py-0.5 text-xs ${
                item.source === "manual" ? "bg-neutral-100 text-neutral-600" : "bg-blue-50 text-blue-700"
              }`}
            >
              {item.source === "manual" ? "Manual" : "Extracted"}
            </span>
            {editingId === item.id ? (
              <div className="space-y-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={3}
                  aria-label="Memory content"
                  className="w-full rounded border border-neutral-300 p-2 text-sm"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => update.mutate({ id: item.id, content: draft })}
                    disabled={!draft.trim() || update.isPending}
                    className="rounded bg-neutral-900 px-2 py-1 text-xs text-white disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="rounded border border-neutral-300 px-2 py-1 text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm">{item.content}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditingId(item.id);
                      setDraft(item.content);
                    }}
                    className="rounded border border-neutral-300 px-2 py-1 text-xs"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => remove.mutate({ id: item.id })}
                    disabled={remove.isPending}
                    className="rounded border border-neutral-300 px-2 py-1 text-xs text-red-600 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

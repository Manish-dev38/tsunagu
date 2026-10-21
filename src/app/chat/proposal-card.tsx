"use client";

import { useState } from "react";

export type EmailDraft = { to: string; subject: string; body: string };

function asDraft(payload: unknown): EmailDraft | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.to !== "string" || typeof p.subject !== "string" || typeof p.body !== "string") {
    return null;
  }
  return { to: p.to, subject: p.subject, body: p.body };
}

export function ProposalCard({
  proposal,
  onApprove,
  onEdit,
  onDiscard,
  busy = false,
}: {
  proposal: { id: string; payload: unknown };
  onApprove: () => void;
  onEdit: (draft: EmailDraft) => void;
  onDiscard: () => void;
  busy?: boolean;
}) {
  const draft = asDraft(proposal.payload);
  const [editing, setEditing] = useState(false);
  const [to, setTo] = useState(draft?.to ?? "");
  const [subject, setSubject] = useState(draft?.subject ?? "");
  const [body, setBody] = useState(draft?.body ?? "");

  if (!draft) return null;

  if (editing) {
    return (
      <div className="rounded border border-neutral-300 p-3 text-sm">
        <div className="text-xs font-medium uppercase text-neutral-400">Edit email draft</div>
        <input
          aria-label="To"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          className="mt-2 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
        />
        <input
          aria-label="Subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          className="mt-2 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
        />
        <textarea
          aria-label="Body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          className="mt-2 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
        />
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => {
              onEdit({ to, subject, body });
              setEditing(false);
            }}
            disabled={!to.trim()}
            className="rounded bg-neutral-900 px-3 py-1 text-xs text-white disabled:opacity-40"
          >
            Save
          </button>
          <button
            onClick={() => setEditing(false)}
            className="rounded border border-neutral-300 px-3 py-1 text-xs"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded border border-neutral-300 p-3 text-sm">
      <div className="text-xs font-medium uppercase text-neutral-400">Email draft</div>
      <p className="mt-1 text-xs text-neutral-500">To: {draft.to}</p>
      <p className="font-medium text-neutral-900">{draft.subject}</p>
      <p className="mt-1 whitespace-pre-wrap text-neutral-700">{draft.body}</p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={onApprove}
          disabled={busy}
          className="rounded bg-neutral-900 px-3 py-1 text-xs text-white disabled:opacity-40"
        >
          Approve
        </button>
        <button
          onClick={() => {
            setTo(draft.to);
            setSubject(draft.subject);
            setBody(draft.body);
            setEditing(true);
          }}
          disabled={busy}
          className="rounded border border-neutral-300 px-3 py-1 text-xs disabled:opacity-40"
        >
          Edit
        </button>
        <button
          onClick={onDiscard}
          disabled={busy}
          className="rounded border border-neutral-300 px-3 py-1 text-xs text-neutral-600 disabled:opacity-40"
        >
          Discard
        </button>
      </div>
    </div>
  );
}

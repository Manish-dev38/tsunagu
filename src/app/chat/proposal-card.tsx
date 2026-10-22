"use client";

import { useState } from "react";

type EmailPayload = { to: string; subject: string; body: string };
type CreatePayload = { summary: string; start: string; end: string; attendees: string[]; notify: boolean };
type ReschedulePayload = { eventId: string; summary: string; start: string; end: string; notify: boolean };
type CancelPayload = { eventId: string; summary: string; notify: boolean };

type Card =
  | { kind: "email.send"; payload: EmailPayload }
  | { kind: "calendar.create"; payload: CreatePayload }
  | { kind: "calendar.reschedule"; payload: ReschedulePayload }
  | { kind: "calendar.cancel"; payload: CancelPayload };

function asCard(kind: string, payload: unknown): Card | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (kind === "email.send") {
    if (typeof p.to !== "string" || typeof p.subject !== "string" || typeof p.body !== "string") {
      return null;
    }
    return { kind, payload: { to: p.to, subject: p.subject, body: p.body } };
  }
  if (kind === "calendar.create") {
    if (typeof p.summary !== "string" || typeof p.start !== "string") return null;
    const start = new Date(p.start);
    const end =
      typeof p.end === "string"
        ? p.end
        : Number.isNaN(start.getTime())
          ? p.start
          : new Date(start.getTime() + 3_600_000).toISOString();
    return {
      kind,
      payload: {
        summary: p.summary,
        start: p.start,
        end,
        attendees: Array.isArray(p.attendees)
          ? p.attendees.filter((a): a is string => typeof a === "string")
          : [],
        notify: p.notify === true,
      },
    };
  }
  if (kind === "calendar.reschedule") {
    if (typeof p.eventId !== "string" || typeof p.start !== "string" || typeof p.end !== "string") {
      return null;
    }
    return {
      kind,
      payload: {
        eventId: p.eventId,
        summary: typeof p.summary === "string" ? p.summary : "",
        start: p.start,
        end: p.end,
        notify: p.notify === true,
      },
    };
  }
  if (kind === "calendar.cancel") {
    if (typeof p.eventId !== "string") return null;
    return {
      kind,
      payload: {
        eventId: p.eventId,
        summary: typeof p.summary === "string" ? p.summary : "",
        notify: p.notify === true,
      },
    };
  }
  return null;
}

// <input type="datetime-local"> speaks local wall time without a zone
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function fmtRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return `${startIso} – ${endIso}`;
  const time = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateTime = (d: Date) => d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const sameDay = s.toDateString() === e.toDateString();
  return sameDay ? `${dateTime(s)} – ${time(e)}` : `${dateTime(s)} – ${dateTime(e)}`;
}

function NotifyLine({ notify }: { notify: boolean }) {
  return <p className="text-xs text-neutral-500">Attendees notified: {notify ? "yes" : "no"}</p>;
}

export function ProposalCard({
  proposal,
  onApprove,
  onEdit,
  onDiscard,
  busy = false,
}: {
  proposal: { id: string; kind: string; payload: unknown };
  onApprove: () => void;
  onEdit: (patch: Record<string, unknown>) => void;
  onDiscard: () => void;
  busy?: boolean;
}) {
  const card = asCard(proposal.kind, proposal.payload);
  const [editing, setEditing] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [summary, setSummary] = useState("");
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [attendees, setAttendees] = useState("");
  const [notify, setNotify] = useState(false);

  if (!card) return null;

  const startEdit = () => {
    if (card.kind === "email.send") {
      setTo(card.payload.to);
      setSubject(card.payload.subject);
      setBody(card.payload.body);
    } else if (card.kind === "calendar.create") {
      setSummary(card.payload.summary);
      setStartLocal(toLocalInput(card.payload.start));
      setEndLocal(toLocalInput(card.payload.end));
      setAttendees(card.payload.attendees.join(", "));
      setNotify(card.payload.notify);
    } else if (card.kind === "calendar.reschedule") {
      setStartLocal(toLocalInput(card.payload.start));
      setEndLocal(toLocalInput(card.payload.end));
      setNotify(card.payload.notify);
    } else {
      setNotify(card.payload.notify);
    }
    setEditing(true);
  };

  const startIso = fromLocalInput(startLocal);
  const endIso = fromLocalInput(endLocal);

  const save = () => {
    if (card.kind === "email.send") {
      onEdit({ to, subject, body });
    } else if (card.kind === "calendar.create") {
      if (!startIso || !endIso) return;
      onEdit({
        summary,
        start: startIso,
        end: endIso,
        attendees: attendees
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean),
        notify,
      });
    } else if (card.kind === "calendar.reschedule") {
      if (!startIso || !endIso) return;
      onEdit({ eventId: card.payload.eventId, start: startIso, end: endIso, notify });
    } else {
      onEdit({ eventId: card.payload.eventId, notify });
    }
    setEditing(false);
  };

  // mirrors the server schemas so Save never gets rejected after the fact
  const canSave =
    card.kind === "email.send"
      ? to.trim().length > 0
      : card.kind === "calendar.create"
        ? summary.trim().length > 0 &&
          startIso !== null &&
          endIso !== null &&
          attendees
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean)
            .every((a) => a.includes("@"))
        : card.kind === "calendar.reschedule"
          ? startIso !== null && endIso !== null
          : true;

  if (editing) {
    return (
      <div className="rounded border border-neutral-300 p-3 text-sm">
        <div className="text-xs font-medium uppercase text-neutral-400">Edit proposal</div>
        {card.kind === "email.send" && (
          <>
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
          </>
        )}
        {card.kind === "calendar.create" && (
          <>
            <input
              aria-label="Summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              className="mt-2 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-xs text-neutral-500">
                Start
                <input
                  type="datetime-local"
                  value={startLocal}
                  onChange={(event) => setStartLocal(event.target.value)}
                  className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="text-xs text-neutral-500">
                End
                <input
                  type="datetime-local"
                  value={endLocal}
                  onChange={(event) => setEndLocal(event.target.value)}
                  className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                />
              </label>
            </div>
            <input
              aria-label="Attendees"
              value={attendees}
              onChange={(event) => setAttendees(event.target.value)}
              placeholder="Comma-separated attendee emails"
              className="mt-2 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
            />
            <label className="mt-2 flex items-center gap-2 text-xs text-neutral-600">
              <input
                type="checkbox"
                checked={notify}
                onChange={(event) => setNotify(event.target.checked)}
              />
              Email attendees on approval
            </label>
          </>
        )}
        {card.kind === "calendar.reschedule" && (
          <>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-xs text-neutral-500">
                New start
                <input
                  type="datetime-local"
                  value={startLocal}
                  onChange={(event) => setStartLocal(event.target.value)}
                  className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="text-xs text-neutral-500">
                New end
                <input
                  type="datetime-local"
                  value={endLocal}
                  onChange={(event) => setEndLocal(event.target.value)}
                  className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                />
              </label>
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-neutral-600">
              <input
                type="checkbox"
                checked={notify}
                onChange={(event) => setNotify(event.target.checked)}
              />
              Email attendees about the change
            </label>
          </>
        )}
        {card.kind === "calendar.cancel" && (
          <label className="mt-2 flex items-center gap-2 text-xs text-neutral-600">
            <input
              type="checkbox"
              checked={notify}
              onChange={(event) => setNotify(event.target.checked)}
            />
            Email attendees the cancellation
          </label>
        )}
        <div className="mt-2 flex gap-2">
          <button
            onClick={save}
            disabled={!canSave}
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
      <div className="text-xs font-medium uppercase text-neutral-400">
        {card.kind === "email.send"
          ? "Email draft"
          : card.kind === "calendar.create"
            ? "Schedule event"
            : card.kind === "calendar.reschedule"
              ? "Reschedule event"
              : "Cancel event"}
      </div>
      {card.kind === "email.send" && (
        <>
          <p className="mt-1 text-xs text-neutral-500">To: {card.payload.to}</p>
          <p className="font-medium text-neutral-900">{card.payload.subject}</p>
          <p className="mt-1 whitespace-pre-wrap text-neutral-700">{card.payload.body}</p>
        </>
      )}
      {card.kind === "calendar.create" && (
        <>
          <p className="font-medium text-neutral-900">{card.payload.summary}</p>
          <p className="mt-1 text-xs text-neutral-500">{fmtRange(card.payload.start, card.payload.end)}</p>
          <p className="text-xs text-neutral-500">
            {card.payload.attendees.length ? `Attendees: ${card.payload.attendees.join(", ")}` : "Attendees: none"}
          </p>
          <NotifyLine notify={card.payload.notify} />
        </>
      )}
      {card.kind === "calendar.reschedule" && (
        <>
          <p className="font-medium text-neutral-900">{card.payload.summary || "Move to a new time"}</p>
          <p className="mt-1 text-xs text-neutral-500">{fmtRange(card.payload.start, card.payload.end)}</p>
          <NotifyLine notify={card.payload.notify} />
        </>
      )}
      {card.kind === "calendar.cancel" && (
        <>
          <p className="font-medium text-neutral-900">{card.payload.summary || "Remove this event"}</p>
          <p className="text-xs text-neutral-500">Cancels the event and removes it from the calendar</p>
          <NotifyLine notify={card.payload.notify} />
        </>
      )}
      <div className="mt-3 flex gap-2">
        <button
          onClick={onApprove}
          disabled={busy}
          className="rounded bg-neutral-900 px-3 py-1 text-xs text-white disabled:opacity-40"
        >
          Approve
        </button>
        <button
          onClick={startEdit}
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

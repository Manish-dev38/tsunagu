"use client";

import { Calendar, Check, Mail, type LucideIcon } from "lucide-react";
import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, inputClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type EmailPayload = { to: string; subject: string; body: string };
type CreatePayload = { summary: string; start: string; end: string; attendees: string[]; notify: boolean };
type ReschedulePayload = { eventId: string; summary: string; start: string; end: string; notify: boolean };
type CancelPayload = { eventId: string; summary: string; notify: boolean };

type Card =
  | { kind: "email.send"; payload: EmailPayload }
  | { kind: "calendar.create"; payload: CreatePayload }
  | { kind: "calendar.reschedule"; payload: ReschedulePayload }
  | { kind: "calendar.cancel"; payload: CancelPayload };

const KIND: Record<Card["kind"], { label: string; icon: LucideIcon; approve: string }> = {
  "email.send": { label: "Send email", icon: Mail, approve: "Approve and send" },
  "calendar.create": { label: "Create event", icon: Calendar, approve: "Approve event" },
  "calendar.reschedule": { label: "Reschedule event", icon: Calendar, approve: "Approve event" },
  "calendar.cancel": { label: "Cancel event", icon: Calendar, approve: "Approve event" },
};

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

function splitAttendees(value: string): string[] {
  return value.split(",").map((a) => a.trim()).filter(Boolean);
}

export function ProposalCard({
  proposal,
  onApprove,
  onApproveEdit,
  onDiscard,
  busy = false,
}: {
  proposal: { id: string; kind: string; payload: unknown };
  onApprove: () => void;
  /** edit mode's approve: persists the draft (editProposal) then approves */
  onApproveEdit: (patch: Record<string, unknown>) => void;
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

  const kind = KIND[card.kind];
  const Icon = kind.icon;
  const uid = proposal.id;

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

  // the patch edit mode's approve persists before approving; summary travels
  // with reschedule/cancel because the server schemas require it
  const buildPatch = (): Record<string, unknown> | null => {
    if (card.kind === "email.send") return { to, subject, body };
    if (card.kind === "calendar.create") {
      if (!startIso || !endIso) return null;
      return { summary, start: startIso, end: endIso, attendees: splitAttendees(attendees), notify };
    }
    if (card.kind === "calendar.reschedule") {
      if (!startIso || !endIso) return null;
      return { eventId: card.payload.eventId, summary: card.payload.summary, start: startIso, end: endIso, notify };
    }
    return { eventId: card.payload.eventId, summary: card.payload.summary, notify };
  };

  const approveWithEdits = () => {
    const patch = buildPatch();
    if (patch) onApproveEdit(patch);
  };

  // mirrors the server schemas so Approve never gets rejected after the fact
  const canSave =
    card.kind === "email.send"
      ? to.trim().length > 0
      : card.kind === "calendar.create"
        ? summary.trim().length > 0 &&
          startIso !== null &&
          endIso !== null &&
          splitAttendees(attendees).every((a) => a.includes("@"))
        : card.kind === "calendar.reschedule"
          ? startIso !== null && endIso !== null
          : true;

  const kv: Array<[string, string]> =
    card.kind === "email.send"
      ? [
          ["To", card.payload.to],
          ["Subject", card.payload.subject],
          ["Body", card.payload.body],
        ]
      : card.kind === "calendar.create"
        ? [
            ["Title", card.payload.summary],
            ["When", fmtRange(card.payload.start, card.payload.end)],
            ["Attendees", card.payload.attendees.length ? card.payload.attendees.join(", ") : "none"],
            ["Notify", card.payload.notify ? "yes" : "no"],
          ]
        : card.kind === "calendar.reschedule"
          ? [
              ["Title", card.payload.summary || "Move to a new time"],
              ["When", fmtRange(card.payload.start, card.payload.end)],
              ["Notify", card.payload.notify ? "yes" : "no"],
            ]
          : [
              ["Title", card.payload.summary || "Remove this event"],
              ["Notify", card.payload.notify ? "yes" : "no"],
            ];

  return (
    <article className="card-chai proposal">
      <div className="proposal-head">
        <span className="chip">
          <Icon className="size-[13px]" /> {kind.label}
        </span>
        <span className="status-text status-pending">
          <span className="dot" aria-hidden="true" />
          {editing ? "Editing draft" : "Draft"}
        </span>
      </div>

      {editing ? (
        <div className="proposal-form">
          {card.kind === "email.send" && (
            <>
              <div>
                <label className="field-label" htmlFor={`${uid}-to`}>To</label>
                <Input id={`${uid}-to`} value={to} onChange={(event) => setTo(event.target.value)} />
              </div>
              <div>
                <label className="field-label" htmlFor={`${uid}-subject`}>Subject</label>
                <Input id={`${uid}-subject`} value={subject} onChange={(event) => setSubject(event.target.value)} />
              </div>
              <div>
                <label className="field-label" htmlFor={`${uid}-body`}>Body</label>
                <textarea
                  id={`${uid}-body`}
                  value={body}
                  rows={4}
                  onChange={(event) => setBody(event.target.value)}
                  className={cn(inputClass, "h-auto min-h-[84px] resize-y py-[9px] leading-normal")}
                />
              </div>
            </>
          )}
          {card.kind === "calendar.create" && (
            <>
              <div>
                <label className="field-label" htmlFor={`${uid}-summary`}>Event title</label>
                <Input id={`${uid}-summary`} value={summary} onChange={(event) => setSummary(event.target.value)} />
              </div>
              <div className="grid-2">
                <div>
                  <label className="field-label" htmlFor={`${uid}-start`}>Start</label>
                  <Input
                    id={`${uid}-start`}
                    type="datetime-local"
                    value={startLocal}
                    onChange={(event) => setStartLocal(event.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor={`${uid}-end`}>End</label>
                  <Input
                    id={`${uid}-end`}
                    type="datetime-local"
                    value={endLocal}
                    onChange={(event) => setEndLocal(event.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="field-label" htmlFor={`${uid}-attendees`}>Attendees</label>
                <Input
                  id={`${uid}-attendees`}
                  value={attendees}
                  onChange={(event) => setAttendees(event.target.value)}
                  placeholder="Comma-separated attendee emails"
                />
              </div>
              <label className="notify-row">
                <input
                  type="checkbox"
                  checked={notify}
                  onChange={(event) => setNotify(event.target.checked)}
                />
                Email the invitation to attendees
              </label>
            </>
          )}
          {card.kind === "calendar.reschedule" && (
            <>
              <div className="grid-2">
                <div>
                  <label className="field-label" htmlFor={`${uid}-start`}>New start</label>
                  <Input
                    id={`${uid}-start`}
                    type="datetime-local"
                    value={startLocal}
                    onChange={(event) => setStartLocal(event.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor={`${uid}-end`}>New end</label>
                  <Input
                    id={`${uid}-end`}
                    type="datetime-local"
                    value={endLocal}
                    onChange={(event) => setEndLocal(event.target.value)}
                  />
                </div>
              </div>
              <label className="notify-row">
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
            <label className="notify-row">
              <input
                type="checkbox"
                checked={notify}
                onChange={(event) => setNotify(event.target.checked)}
              />
              Email attendees the cancellation
            </label>
          )}
        </div>
      ) : (
        <dl className="kv">
          {kv.map(([term, description]) => (
            <Fragment key={term}>
              <dt>{term}</dt>
              <dd>{description}</dd>
            </Fragment>
          ))}
        </dl>
      )}

      <div className="proposal-actions">
        {editing ? (
          <>
            <Button variant="soft" size="sm" onClick={approveWithEdits} disabled={!canSave || busy}>
              <Check /> {kind.approve}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={busy}>
              Cancel edit
            </Button>
          </>
        ) : (
          <>
            <Button variant="soft" size="sm" onClick={onApprove} disabled={busy}>
              <Check /> {kind.approve}
            </Button>
            <Button variant="outline" size="sm" onClick={startEdit} disabled={busy}>
              Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={onDiscard} disabled={busy}>
              Discard
            </Button>
          </>
        )}
      </div>
    </article>
  );
}

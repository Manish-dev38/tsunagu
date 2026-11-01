"use client";

import { Archive, Mail, Plus, RefreshCw, Send, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { isUnread, type CachedMessage } from "@/server/adapters/corsair";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input, inputClass } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { api } from "@/trpc/provider";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// Gmail keeps the raw header ("Priya Nair <priya@acme.co>"); the prototype
// shows the name in rows and "Name (address)" in the reading pane
function senderOf(raw: string) {
  const match = raw.match(/^(.*?)\s*<([^>]+)>$/);
  return match
    ? { name: match[1].replace(/^"|"$/g, "").trim(), email: match[2] }
    : { name: raw, email: "" };
}

// the prototype's short form: "Today 09:41" inside the day, "26 Oct" after
function fmtDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `Today ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return `${d.getDate()} ${d.toLocaleDateString("en-GB", { month: "short" })}`;
}

// the sync line's copy: "today, 09:42" / "26 Oct, 17:02"
function fmtSynced(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  const now = new Date();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return `today, ${time}`;
  return `${d.getDate()} ${d.toLocaleDateString("en-GB", { month: "short" })}, ${time}`;
}

export default function InboxPage() {
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const toast = useToast();
  const list = api.inbox.list.useQuery({ filter, query: query || undefined });
  const message = api.inbox.message.useQuery(
    { id: openId ?? "" },
    { enabled: openId !== null },
  );
  const utils = api.useUtils();

  // failures surface as toasts (Q3=A); the list is the only query that can
  // fail on its own, so report it once per new error
  useEffect(() => {
    if (list.error) toast(list.error.message, { tone: "danger" });
  }, [list.error, toast]);

  const invalidateMail = () => {
    void utils.inbox.list.invalidate();
    // an open message may have been archived or relabeled
    void utils.inbox.message.invalidate();
    // archive/star/read are writes too: each inserts an action-log row
    void utils.action.list.invalidate();
  };

  const refresh = api.inbox.refresh.useMutation({
    onSuccess: () => {
      invalidateMail();
      toast("Mail synced");
    },
    onError: (e) => toast(e.message, { tone: "danger" }),
  });

  const send = api.inbox.send.useMutation({
    onSuccess: () => {
      setComposing(false);
      setTo("");
      setSubject("");
      setBody("");
      invalidateMail();
      toast("Message sent");
    },
    onError: (e) => toast(e.message, { tone: "danger" }),
  });

  const archive = api.inbox.archive.useMutation({
    onSuccess: () => {
      setOpenId(null);
      invalidateMail();
      toast("Message archived");
    },
    onError: (e) => toast(e.message, { tone: "danger" }),
  });

  const star = api.inbox.setStarred.useMutation({
    onSuccess: (_data, vars) => {
      invalidateMail();
      toast(vars.starred ? "Message starred" : "Message unstarred");
    },
    onError: (e) => toast(e.message, { tone: "danger" }),
  });

  const markRead = api.inbox.setRead.useMutation({
    onSuccess: (_data, vars) => {
      invalidateMail();
      toast(vars.read ? "Marked read" : "Marked unread");
    },
    onError: (e) => toast(e.message, { tone: "danger" }),
  });

  const detail = message.data;

  return (
    <div>
      <div className="spread" style={{ marginBottom: 16 }}>
        <h1 className="page-title">Inbox</h1>
        <div className="row">
          <IconButton
            variant="chrome"
            aria-label="Refresh mail"
            title="Refresh mail"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            <RefreshCw />
          </IconButton>
          <Button variant="solid" size="sm" iconRight={null} disabled={composing} onClick={() => setComposing(true)}>
            <Plus /> Compose
          </Button>
        </div>
      </div>

      {composing && (
        <div className="card-chai compose-card">
          <h2 className="section-title" style={{ marginBottom: 12 }}>
            New message
          </h2>
          <div className="stack">
            <Input placeholder="To" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
            <Input
              placeholder="Subject"
              aria-label="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
            <textarea
              className={inputClass + " textarea"}
              rows={4}
              placeholder="Message"
              aria-label="Message"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="row">
              <Button
                variant="soft"
                size="sm"
                iconRight={null}
                disabled={send.isPending || !to.trim()}
                onClick={() => send.mutate({ to, subject, body })}
              >
                <Send /> {send.isPending ? "Sending…" : "Send"}
              </Button>
              <Button variant="ghost" size="sm" disabled={send.isPending} onClick={() => setComposing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="row" style={{ marginBottom: 16 }}>
        <SearchInput
          wrapperClassName="flex-1 sm:w-auto"
          placeholder="Search mail..."
          aria-label="Search mail"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Segmented
          className="flex-none"
          label="Mail filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "unread", label: "Unread" },
          ]}
        />
      </div>

      {list.data && (
        <p className="tiny muted" style={{ marginBottom: 12 }}>
          {list.data.unreadCount} unread · last synced{" "}
          {list.data.lastSyncedAt ? fmtSynced(list.data.lastSyncedAt) : "never"}
        </p>
      )}

      <div className="inbox-layout">
        <div className="mail-list">
          {list.error ? (
            <p className="small muted" style={{ padding: "18px 4px" }}>
              Mailbox unavailable.
            </p>
          ) : !list.data ? (
            <div role="status">
              <span className="sr-only">Loading mail…</span>
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="mail-row" aria-hidden="true">
                  <div className="mb-2 h-3 w-1/3 animate-pulse rounded bg-[var(--hover-fill)]" />
                  <div className="mb-2 h-3 w-2/3 animate-pulse rounded bg-[var(--hover-fill)]" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-[var(--hover-fill)]" />
                </div>
              ))}
            </div>
          ) : list.data.messages.length === 0 ? (
            <p className="small muted" style={{ padding: "18px 4px" }}>
              No messages match this view.
            </p>
          ) : (
            list.data.messages.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`mail-row ${isUnread(m) ? "unread" : ""} ${openId === m.id ? "is-open" : ""}`}
                onClick={() => setOpenId(m.id)}
              >
                <div className="top">
                  <span className="from">{senderOf(m.from).name}</span>
                  <span className="row" style={{ gap: 8 }}>
                    <span className={`star-btn ${m.labelIds.includes("STARRED") ? "on" : ""}`}>
                      <Star fill={m.labelIds.includes("STARRED") ? "currentColor" : "none"} />
                    </span>
                    <span className="date">{fmtDate(m.internalDate)}</span>
                  </span>
                </div>
                <p className="subject">{m.subject}</p>
                <p className="snippet">{m.snippet}</p>
              </button>
            ))
          )}
        </div>

        <div className="mail-detail">
          {openId === null ? (
            <p className="small muted">Pick a message to read it here.</p>
          ) : message.isPending ? (
            <p className="small muted">Loading…</p>
          ) : detail ? (
            <MessageDetail
              detail={detail}
              pending={archive.isPending || star.isPending || markRead.isPending}
              onArchive={() => archive.mutate({ id: detail.id })}
              onToggleStar={() =>
                star.mutate({ id: detail.id, starred: !detail.labelIds.includes("STARRED") })
              }
              onToggleRead={() => markRead.mutate({ id: detail.id, read: isUnread(detail) })}
            />
          ) : (
            <p className="small muted">Message not found in cache.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageDetail({
  detail,
  pending,
  onArchive,
  onToggleStar,
  onToggleRead,
}: {
  detail: CachedMessage;
  pending: boolean;
  onArchive: () => void;
  onToggleStar: () => void;
  onToggleRead: () => void;
}) {
  const starred = detail.labelIds.includes("STARRED");
  const sender = senderOf(detail.from);
  return (
    <div>
      <div className="row" style={{ marginBottom: 14 }}>
        <Button variant="outline" size="sm" disabled={pending} onClick={onArchive}>
          <Archive /> Archive
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={onToggleStar}>
          <Star fill={starred ? "currentColor" : "none"} /> {starred ? "Unstar" : "Star"}
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={onToggleRead}>
          <Mail /> Mark {isUnread(detail) ? "read" : "unread"}
        </Button>
      </div>
      <article className="mail-frame">
        <h3>{detail.subject}</h3>
        <p className="mail-meta">
          From {sender.name}
          {sender.email ? ` (${sender.email})` : ""}
        </p>
        <p className="mail-meta">To me · {fmtDate(detail.internalDate)}</p>
        {detail.html ? (
          <div className="mail-canvas">
            <iframe
              title="Email body"
              // no scripts, no same-origin, and no remote fetches: an email must
              // not phone home through images or rebuild itself into another page
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              // base type matches the prototype's .mail-body; a sender's inline
              // styles still win, and the canvas stays white in both themes
              srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><base target="_blank"><style>html,body{background:#fff}body{margin:12px;font:13.5px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:#111}a{color:#7c2d12}</style></head><body>${detail.html}</body></html>`}
            />
          </div>
        ) : (
          <div className="mail-body">
            {detail.body.split(/\n{2,}/).map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
        )}
      </article>
    </div>
  );
}

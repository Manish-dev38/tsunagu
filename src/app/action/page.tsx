"use client";

import { Undo2 } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
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

// status is text + dot, never a coloured fill (ChaiUI)
const STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "Pending", tone: "status-pending" },
  approved: { label: "Approved", tone: "status-approved" },
  // edited proposals are still pre-approval, like the chat card's draft state
  edited: { label: "Edited", tone: "status-pending" },
  executed: { label: "Executed", tone: "status-executed" },
  failed: { label: "Failed", tone: "status-failed" },
  discarded: { label: "Discarded", tone: "status-discarded" },
};

const pad = (n: number) => String(n).padStart(2, "0");

// the prototype's short form: "Today, 09:44" / "26 Oct, 17:02"
function fmtWhen(d: Date) {
  if (Number.isNaN(d.getTime())) return "";
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === new Date().toDateString()) return `Today, ${time}`;
  return `${d.getDate()} ${d.toLocaleDateString("en-GB", { month: "short" })}, ${time}`;
}

function titleOf(payload: Record<string, unknown> | null): string | null {
  if (payload && typeof payload.subject === "string") return payload.subject;
  if (payload && typeof payload.summary === "string") return payload.summary;
  return null;
}

export default function ActionPage() {
  const utils = api.useUtils();
  const toast = useToast();
  const list = api.action.list.useQuery();

  // read failures surface as toasts too (Q3=A), once per new error
  useEffect(() => {
    if (list.error) toast(list.error.message, { tone: "danger" });
  }, [list.error, toast]);

  const undo = api.action.undo.useMutation({
    onSuccess: () => {
      toast("Action undone");
      void utils.action.list.invalidate();
      void utils.inbox.list.invalidate();
    },
    onError: (e) => {
      toast(e.message, { tone: "danger" });
      // a failed undo still writes a failed row into the log
      void utils.action.list.invalidate();
    },
  });

  return (
    <div className="main-narrow">
      <h1 className="page-title">Action log</h1>
      <p className="page-lead">
        Everything the assistant and you have done, newest first. Pending rows are writes still
        waiting on approval.
      </p>

      <div style={{ marginTop: 22 }}>
        {list.isPending && <p className="small muted">Loading…</p>}
        {list.data?.length === 0 && <p className="small muted">No actions yet.</p>}
        {list.data?.map((row) => {
          const title = titleOf(row.payload);
          const status = STATUS[row.status] ?? { label: row.status, tone: "" };
          const created = new Date(row.createdAt);
          return (
            <article key={row.id} className="card-chai action-row">
              <div className="min-w-0 flex-1">
                <div className="row-wrap">
                  <span className="action-kind">{KIND_LABELS[row.kind] ?? row.kind}</span>
                  <span className={`status-text ${status.tone}`}>
                    <span className="dot" aria-hidden="true" />
                    {status.label}
                  </span>
                  <span className="chip">{row.initiator === "human" ? "You" : "Agent"}</span>
                </div>
                {title && <p className="action-title">{title}</p>}
                <time
                  className="timestamp"
                  dateTime={Number.isNaN(created.getTime()) ? undefined : created.toISOString()}
                >
                  {fmtWhen(created)}
                </time>
              </div>
              {row.undoable && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-[26px] px-[10px] text-[12px]"
                  disabled={undo.isPending}
                  aria-label={`Undo ${KIND_LABELS[row.kind] ?? row.kind}`}
                  onClick={() => undo.mutate({ actionId: row.id })}
                >
                  <Undo2 /> Undo
                </Button>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

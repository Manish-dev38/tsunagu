import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { CalendarWrites, MailboxWrites } from "@/server/adapters/corsair";
import type { Db } from "@/server/db";
import { actions } from "@/server/db/schema";

export type ActionWrite =
  | { kind: "email.send"; to: string; subject: string; body: string }
  | { kind: "mail.archive"; messageId: string }
  | { kind: "mail.star"; messageId: string }
  | { kind: "mail.unstar"; messageId: string }
  | { kind: "mail.mark_read"; messageId: string }
  | { kind: "mail.mark_unread"; messageId: string }
  | { kind: "calendar.create"; summary: string; start: string; end: string };

export interface EmailSendPayload {
  to: string;
  subject: string;
  body: string;
}

export interface WrittenAction {
  id: string;
  kind: ActionWrite["kind"];
  status: "executed" | "failed";
}

// Agent writes never touch the provider here: they land as pending proposals
// until the user approves the card (ADR-0001).
export async function createProposal(
  db: Db,
  tenantId: string,
  payload: EmailSendPayload,
): Promise<{ id: string; status: "pending" }> {
  const id = randomUUID();
  await db.insert(actions).values({
    id,
    tenantId,
    kind: "email.send",
    initiator: "agent",
    status: "pending",
    payload: { ...payload },
  });
  return { id, status: "pending" };
}

// Human writes run ungated (the user is the approval); agent writes only
// arrive here after the approval card, updating the proposal row (ADR-0001).
export async function performWrite(
  db: Db,
  corsair: MailboxWrites & CalendarWrites,
  tenantId: string,
  write: ActionWrite,
  // actionId set = follow-up on an existing proposal row (agent path); the
  // row is already initiator=agent and status=approved from the claim step.
  opts?: { actionId: string },
): Promise<WrittenAction> {
  let error: unknown;
  try {
    switch (write.kind) {
      case "email.send":
        await corsair.sendEmail(tenantId, {
          to: write.to,
          subject: write.subject,
          body: write.body,
        });
        break;
      case "calendar.create":
        await corsair.createEvent(tenantId, {
          summary: write.summary,
          start: write.start,
          end: write.end,
        });
        break;
      case "mail.archive":
        await corsair.archiveMessage(tenantId, write.messageId);
        break;
      case "mail.star":
        await corsair.setStarred(tenantId, write.messageId, true);
        break;
      case "mail.unstar":
        await corsair.setStarred(tenantId, write.messageId, false);
        break;
      case "mail.mark_read":
        await corsair.setRead(tenantId, write.messageId, true);
        break;
      case "mail.mark_unread":
        await corsair.setRead(tenantId, write.messageId, false);
        break;
    }
  } catch (e) {
    error = e;
  }
  const id = opts?.actionId ?? randomUUID();
  const status = error ? "failed" : "executed";
  if (opts?.actionId) {
    await db
      .update(actions)
      .set({ status })
      .where(and(eq(actions.id, id), eq(actions.tenantId, tenantId)));
  } else {
    await db.insert(actions).values({ id, tenantId, kind: write.kind, initiator: "human", status });
  }
  if (error) throw error;
  return { id, kind: write.kind, status };
}

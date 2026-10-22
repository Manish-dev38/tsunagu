import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { CalendarWrites, MailboxWrites } from "@/server/adapters/corsair";
import type { Db } from "@/server/db";
import { actions } from "@/server/db/schema";

// shared by proposal schemas (root) and the agent's tool-boundary checks
export const isoDatetime = z.iso.datetime("must be an ISO datetime");

export type ActionWrite =
  | { kind: "email.send"; to: string; subject: string; body: string }
  | { kind: "mail.archive"; messageId: string }
  | { kind: "mail.unarchive"; messageId: string }
  | { kind: "mail.star"; messageId: string }
  | { kind: "mail.unstar"; messageId: string }
  | { kind: "mail.mark_read"; messageId: string }
  | { kind: "mail.mark_unread"; messageId: string }
  | { kind: "calendar.create"; summary: string; start: string; end: string; attendees: string[]; notify: boolean }
  | { kind: "calendar.reschedule"; eventId: string; summary: string; start: string; end: string; notify: boolean }
  | { kind: "calendar.cancel"; eventId: string; summary: string; notify: boolean };

// What the agent may propose: everything here lands as a pending approval
// card, never as a provider write (ADR-0001). summary travels with
// reschedule/cancel so the approval card can name the target event.
type ProposalInput =
  | { kind: "email.send"; to: string; subject: string; body: string }
  | { kind: "calendar.create"; summary: string; start: string; end?: string; attendees: string[]; notify: boolean }
  | { kind: "calendar.reschedule"; eventId: string; summary: string; start: string; end: string; notify: boolean }
  | { kind: "calendar.cancel"; eventId: string; summary: string; notify: boolean };

type ProposalKind = ProposalInput["kind"];

export const PROPOSAL_KINDS: ProposalKind[] = [
  "email.send",
  "calendar.create",
  "calendar.reschedule",
  "calendar.cancel",
];

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
  proposal: ProposalInput,
): Promise<{ id: string; status: "pending" }> {
  const { kind, ...payload } = proposal;
  const id = randomUUID();
  await db.insert(actions).values({
    id,
    tenantId,
    kind,
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
          attendees: write.attendees,
          notify: write.notify,
        });
        break;
      case "calendar.reschedule":
        await corsair.rescheduleEvent(tenantId, {
          eventId: write.eventId,
          start: write.start,
          end: write.end,
          notify: write.notify,
        });
        break;
      case "calendar.cancel":
        await corsair.cancelEvent(tenantId, { eventId: write.eventId, notify: write.notify });
        break;
      case "mail.archive":
        await corsair.archiveMessage(tenantId, write.messageId);
        break;
      case "mail.unarchive":
        await corsair.unarchiveMessage(tenantId, write.messageId);
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
    // payload records what was written (e.g. messageId) so undo can reverse it
    const { kind, ...payload } = write;
    await db.insert(actions).values({ id, tenantId, kind, initiator: "human", status, payload });
  }
  if (error) throw error;
  return { id, kind: write.kind, status };
}

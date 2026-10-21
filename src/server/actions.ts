import { randomUUID } from "node:crypto";
import type { MailboxWrites } from "@/server/adapters/corsair";
import type { Db } from "@/server/db";
import { actions } from "@/server/db/schema";

export type MailWrite =
  | { kind: "email.send"; to: string; subject: string; body: string }
  | { kind: "mail.archive"; messageId: string }
  | { kind: "mail.star"; messageId: string }
  | { kind: "mail.unstar"; messageId: string }
  | { kind: "mail.mark_read"; messageId: string }
  | { kind: "mail.mark_unread"; messageId: string };

export interface WrittenAction {
  id: string;
  kind: MailWrite["kind"];
  status: "executed" | "failed";
}

// Human-initiated writes run ungated (ADR-0001) and always land in the Action log.
export async function performWrite(
  db: Db,
  corsair: MailboxWrites,
  tenantId: string,
  write: MailWrite,
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
  const id = randomUUID();
  const status = error ? "failed" : "executed";
  await db.insert(actions).values({ id, tenantId, kind: write.kind, initiator: "human", status });
  if (error) throw error;
  return { id, kind: write.kind, status };
}

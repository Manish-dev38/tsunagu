import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "@/server/api/root";
import { CorsairFake, type CachedMessage } from "@/server/adapters/corsair";
import { LlmFake } from "@/server/adapters/llm";
import { type Db, createTestDb } from "@/server/db";
import { actions } from "@/server/db/schema";

type AskEvent =
  | { type: "session"; sessionId: string }
  | { type: "delta"; text: string }
  | { type: "done"; reply: string };

function makeCaller(tenantId: string | null, db: Db, corsair: CorsairFake, llm: LlmFake) {
  const session = tenantId
    ? { user: { id: tenantId, name: "Tester", email: "t@example.com", image: null }, expires: "2099-01-01T00:00:00.000Z" }
    : null;
  return appRouter.createCaller({ db, session, corsair, llm });
}

function msg(id: string, overrides: Partial<CachedMessage> = {}): CachedMessage {
  return {
    id,
    threadId: `thread_${id}`,
    labelIds: ["INBOX"],
    snippet: `snippet of ${id}`,
    subject: `Subject ${id}`,
    from: `${id}@example.com`,
    to: "me@example.com",
    body: `Body of ${id}`,
    internalDate: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function askAll(
  caller: ReturnType<typeof makeCaller>,
  input: { sessionId: string | null; content: string },
): Promise<AskEvent[]> {
  const stream = (await caller.chat.ask(input)) as unknown as AsyncIterable<AskEvent>;
  const events: AskEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("router seam: action log and undo", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  });

  it("lists proposals and direct writes chronologically with statuses and undoable flags", async () => {
    const corsair = new CorsairFake();
    corsair.seedLiveMailbox("tenant_al1", [msg("m1"), msg("m2")]);
    const llm = new LlmFake().script(
      { toolCalls: [{ name: "propose_send_email", arguments: { to: "x@example.com", subject: "S", body: "B" } }] },
      { text: "waiting for approval" },
    );
    const caller = makeCaller("tenant_al1", db, corsair, llm);
    await caller.inbox.refresh();

    await caller.inbox.archive({ id: "m1" });
    await caller.inbox.setStarred({ id: "m2", starred: true });
    await caller.inbox.send({ to: "y@example.com", subject: "Direct", body: "send" });
    await askAll(caller, { sessionId: null, content: "draft an email to x" });

    const list = await caller.action.list();
    // newest first; undoable only for executed reversible kinds
    const summary = list.map((r) => [r.kind, r.initiator, r.status, r.undoable]);
    expect(summary).toEqual([
      ["email.send", "agent", "pending", false],
      ["email.send", "human", "executed", false],
      ["mail.star", "human", "executed", true],
      ["mail.archive", "human", "executed", true],
    ]);
    // human rows now record their payload so undo knows what to reverse
    expect(list.find((r) => r.kind === "mail.archive")?.payload).toMatchObject({ messageId: "m1" });

    // per-tenant: another tenant sees nothing of this log
    const other = makeCaller("tenant_al1b", db, new CorsairFake(), new LlmFake());
    expect(await other.action.list()).toEqual([]);
  });

  it("undo reverses an executed archive and logs a new action", async () => {
    const corsair = new CorsairFake();
    corsair.seedLiveMailbox("tenant_al2", [msg("m1")]);
    const caller = makeCaller("tenant_al2", db, corsair, new LlmFake());
    await caller.inbox.refresh();
    await caller.inbox.archive({ id: "m1" });
    expect(await corsair.getCachedMessage("tenant_al2", "m1")).toBeNull();

    const archiveRow = (await caller.action.list()).find((r) => r.kind === "mail.archive");
    expect(archiveRow).toBeDefined();
    const result = await caller.action.undo({ actionId: archiveRow!.id });
    expect(result).toMatchObject({ kind: "mail.unarchive", status: "executed" });

    const restored = await corsair.getCachedMessage("tenant_al2", "m1");
    expect(restored?.labelIds).toContain("INBOX");

    const list = await caller.action.list();
    expect(list.find((r) => r.id === archiveRow!.id)).toMatchObject({ status: "executed" });
    expect(list.filter((r) => r.kind === "mail.unarchive")).toHaveLength(1);
    expect(list.find((r) => r.kind === "mail.unarchive")).toMatchObject({ initiator: "human", status: "executed" });

    // one-step undo: the undo itself is not undoable
    const undoRow = list.find((r) => r.kind === "mail.unarchive");
    expect(undoRow?.undoable).toBe(false);
    await expect(caller.action.undo({ actionId: undoRow!.id })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("undo reverses a star", async () => {
    const corsair = new CorsairFake();
    corsair.seedLiveMailbox("tenant_al3", [msg("m2")]);
    const caller = makeCaller("tenant_al3", db, corsair, new LlmFake());
    await caller.inbox.refresh();
    await caller.inbox.setStarred({ id: "m2", starred: true });
    expect((await corsair.getCachedMessage("tenant_al3", "m2"))?.labelIds).toContain("STARRED");
    const starRow = (await caller.action.list()).find((r) => r.kind === "mail.star");

    await caller.action.undo({ actionId: starRow!.id });
    const after = await corsair.getCachedMessage("tenant_al3", "m2");
    expect(after?.labelIds).not.toContain("STARRED");
    expect((await caller.action.list()).find((r) => r.kind === "mail.unstar")).toMatchObject({
      initiator: "human",
      status: "executed",
    });
  });

  it("offers no undo for executed sends, pending proposals, or failed writes", async () => {
    const corsair = new CorsairFake();
    corsair.seedLiveMailbox("tenant_al4", [msg("m4")]);
    const llm = new LlmFake().script(
      { toolCalls: [{ name: "propose_send_email", arguments: { to: "z@example.com", subject: "Draft", body: "B" } }] },
      { text: "pending" },
    );
    const caller = makeCaller("tenant_al4", db, corsair, llm);
    await caller.inbox.refresh();

    await caller.inbox.send({ to: "s@example.com", subject: "Sent", body: "irreversible" });
    await askAll(caller, { sessionId: null, content: "draft another email" });
    corsair.failWrite = new Error("provider down");
    await expect(caller.inbox.archive({ id: "m4" })).rejects.toThrow("provider down");
    corsair.failWrite = null;

    const list = await caller.action.list();
    const sent = list.find((r) => r.kind === "email.send" && r.status === "executed");
    const pending = list.find((r) => r.status === "pending");
    const failed = list.find((r) => r.status === "failed");
    expect(sent?.undoable).toBe(false);
    expect(pending?.undoable).toBe(false);
    expect(failed?.undoable).toBe(false);
    await expect(caller.action.undo({ actionId: sent!.id })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(caller.action.undo({ actionId: pending!.id })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(caller.action.undo({ actionId: failed!.id })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("offers no undo on legacy rows written without payload", async () => {
    const caller = makeCaller("tenant_al6", db, new CorsairFake(), new LlmFake());
    // rows created before the payload fix carry no messageId to reverse
    await db.insert(actions).values({
      id: "legacy_archive",
      tenantId: "tenant_al6",
      kind: "mail.archive",
      initiator: "human",
      status: "executed",
      payload: null,
    });
    const [row] = await caller.action.list();
    expect(row.undoable).toBe(false);
    await expect(caller.action.undo({ actionId: "legacy_archive" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("undo is tenant-scoped and validates ids", async () => {    const corsair = new CorsairFake();
    corsair.seedLiveMailbox("tenant_al5", [msg("m5")]);
    const callerA = makeCaller("tenant_al5", db, corsair, new LlmFake());
    await callerA.inbox.refresh();
    await callerA.inbox.archive({ id: "m5" });
    const archiveRow = (await callerA.action.list()).find((r) => r.kind === "mail.archive");

    const callerB = makeCaller("tenant_al5b", db, new CorsairFake(), new LlmFake());
    await expect(callerB.action.undo({ actionId: archiveRow!.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(callerA.action.undo({ actionId: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

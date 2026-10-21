import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "@/server/api/root";
import { CorsairFake, type CachedMessage } from "@/server/adapters/corsair";
import { LlmFake } from "@/server/adapters/llm";
import { type Db, createTestDb } from "@/server/db";
import { actions } from "@/server/db/schema";

function makeCaller(tenantId: string | null, db: Db, corsair: CorsairFake) {
  const session = tenantId
    ? { user: { id: tenantId, name: "Tester", email: "t@example.com", image: null }, expires: "2099-01-01T00:00:00.000Z" }
    : null;
  return appRouter.createCaller({ db, session, corsair, llm: new LlmFake() });
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

async function actionRows(db: Db, tenantId: string) {
  return db
    .select({
      kind: actions.kind,
      initiator: actions.initiator,
      status: actions.status,
    })
    .from(actions)
    .where(eq(actions.tenantId, tenantId));
}

describe("router seam: direct mailbox writes", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  });

  it("composes and sends an email with no approval involved; logs an executed human action", async () => {
    const corsair = new CorsairFake();
    const caller = makeCaller("tenant_send", db, corsair);

    const result = await caller.inbox.send({
      to: "friend@example.com",
      subject: "Hello",
      body: "Hi there",
    });
    expect(result).toMatchObject({ kind: "email.send", status: "executed" });

    expect(corsair.sent).toEqual([
      { tenantId: "tenant_send", to: "friend@example.com", subject: "Hello", body: "Hi there" },
    ]);
    await expect(actionRows(db, "tenant_send")).resolves.toEqual([
      { kind: "email.send", initiator: "human", status: "executed" },
    ]);
  });

  it("archives a message out of the list and logs the action", async () => {
    const corsair = new CorsairFake();
    corsair.seedLiveMailbox("tenant_arch", [msg("a1"), msg("a2")]);
    const caller = makeCaller("tenant_arch", db, corsair);
    await caller.inbox.refresh();

    await caller.inbox.archive({ id: "a1" });

    const list = await caller.inbox.list();
    expect(list.messages.map((m) => m.id)).toEqual(["a2"]);
    await expect(actionRows(db, "tenant_arch")).resolves.toEqual([
      { kind: "mail.archive", initiator: "human", status: "executed" },
    ]);
  });

  it("stars and unstars, updating labels and logging both kinds", async () => {
    const corsair = new CorsairFake();
    corsair.seedLiveMailbox("tenant_star", [msg("s1")]);
    const caller = makeCaller("tenant_star", db, corsair);
    await caller.inbox.refresh();

    await caller.inbox.setStarred({ id: "s1", starred: true });
    await expect(caller.inbox.message({ id: "s1" })).resolves.toMatchObject({
      labelIds: expect.arrayContaining(["INBOX", "STARRED"]),
    });

    await caller.inbox.setStarred({ id: "s1", starred: false });
    await expect(caller.inbox.message({ id: "s1" })).resolves.toMatchObject({
      labelIds: expect.not.arrayContaining(["STARRED"]),
    });

    expect((await actionRows(db, "tenant_star")).map((r) => r.kind)).toEqual([
      "mail.star",
      "mail.unstar",
    ]);
  });

  it("marks read and unread via the UNREAD label and logs both kinds", async () => {
    const corsair = new CorsairFake();
    corsair.seedLiveMailbox("tenant_read", [msg("r1", { labelIds: ["INBOX", "UNREAD"] })]);
    const caller = makeCaller("tenant_read", db, corsair);
    await caller.inbox.refresh();

    await caller.inbox.setRead({ id: "r1", read: true });
    await expect(caller.inbox.message({ id: "r1" })).resolves.toMatchObject({
      labelIds: expect.arrayContaining(["INBOX"]),
    });
    expect((await caller.inbox.list({ filter: "unread" })).messages).toEqual([]);

    await caller.inbox.setRead({ id: "r1", read: false });
    await expect(caller.inbox.message({ id: "r1" })).resolves.toMatchObject({
      labelIds: expect.arrayContaining(["UNREAD"]),
    });

    expect((await actionRows(db, "tenant_read")).map((r) => r.kind)).toEqual([
      "mail.mark_read",
      "mail.mark_unread",
    ]);
  });

  it("records a failed action when the provider write rejects, and rethrows", async () => {
    const corsair = new CorsairFake();
    corsair.seedLiveMailbox("tenant_fail", [msg("f1")]);
    const caller = makeCaller("tenant_fail", db, corsair);
    await caller.inbox.refresh();

    corsair.failWrite = new Error("gmail rejected the write");
    await expect(caller.inbox.archive({ id: "f1" })).rejects.toThrow("gmail rejected the write");

    // the message is untouched in the cache
    await expect(caller.inbox.message({ id: "f1" })).resolves.toMatchObject({ id: "f1" });
    await expect(actionRows(db, "tenant_fail")).resolves.toEqual([
      { kind: "mail.archive", initiator: "human", status: "failed" },
    ]);
  });

  it("rejects unauthenticated writers on every write procedure", async () => {
    const caller = makeCaller(null, db, new CorsairFake());
    await expect(
      caller.inbox.send({ to: "a@b.c", subject: "", body: "" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.inbox.archive({ id: "x" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      caller.inbox.setStarred({ id: "x", starred: true }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.inbox.setRead({ id: "x", read: true })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

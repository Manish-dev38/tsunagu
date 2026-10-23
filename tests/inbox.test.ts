import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "@/server/api/root";
import { CorsairFake, type CachedMessage, extractHtml, normalizeInternalDate } from "@/server/adapters/corsair";
import { LlmFake } from "@/server/adapters/llm";
import { type Db, createTestDb } from "@/server/db";
import { Poller } from "@/server/sync/poller";
import { getLastSync } from "@/server/sync/state";

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

describe("router seam: inbox", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  });

  it("returns an empty list for a tenant with no synced mail", async () => {
    const caller = makeCaller("tenant_a", db, new CorsairFake());
    const result = await caller.inbox.list();
    expect(result.messages).toEqual([]);
    expect(result.unreadCount).toBe(0);
    expect(result.lastSyncedAt).toBeNull();
  });

  it("refresh syncs the live mailbox into the cache; list is newest-first", async () => {
    const corsair = new CorsairFake();
    corsair.seedLiveMailbox("tenant_a", [
      msg("m1", { internalDate: "2026-01-01T10:00:00.000Z" }),
      msg("m2", { internalDate: "2026-01-02T10:00:00.000Z" }),
    ]);
    const caller = makeCaller("tenant_a", db, corsair);

    const before = await caller.inbox.list();
    expect(before.messages).toEqual([]);

    const refresh = await caller.inbox.refresh();
    expect(refresh.synced).toBe(2);

    const after = await caller.inbox.list();
    expect(after.messages.map((m) => m.id)).toEqual(["m2", "m1"]);
    expect(after.lastSyncedAt).not.toBeNull();
  });

  it("unread filter and unread count come from the cache", async () => {
    const corsair = new CorsairFake();
    corsair.seedLiveMailbox("tenant_unread", [
      msg("u1", { labelIds: ["INBOX", "UNREAD"], internalDate: "2026-01-01T10:00:00.000Z" }),
      msg("u2", { labelIds: ["INBOX"], internalDate: "2026-01-01T11:00:00.000Z" }),
      msg("u3", { labelIds: ["INBOX", "UNREAD"], internalDate: "2026-01-01T12:00:00.000Z" }),
    ]);
    const caller = makeCaller("tenant_unread", db, corsair);
    await caller.inbox.refresh();

    const unread = await caller.inbox.list({ filter: "unread" });
    expect(unread.messages.map((m) => m.id)).toEqual(["u3", "u1"]);
    expect(unread.unreadCount).toBe(2);

    const all = await caller.inbox.list({ filter: "all" });
    expect(all.messages).toHaveLength(3);
    expect(all.unreadCount).toBe(2);
  });

  it("search matches subject, from and snippet case-insensitively", async () => {
    const corsair = new CorsairFake();
    corsair.seedLiveMailbox("tenant_search", [
      msg("s1", { subject: "Quarterly Report", from: "boss@corp.com", snippet: "please review" }),
      msg("s2", { subject: "Lunch?", from: "friend@mail.com", snippet: "sushi tomorrow?" }),
      msg("s3", { subject: "Deploy done", from: "ci@corp.com", snippet: "Quarterly pipeline is green" }),
    ]);
    const caller = makeCaller("tenant_search", db, corsair);
    await caller.inbox.refresh();

    await expect(caller.inbox.list({ query: "quarterly" })).resolves.toMatchObject({
      messages: [{ id: "s1" }, { id: "s3" }],
    });
    await expect(caller.inbox.list({ query: "friend@mail" })).resolves.toMatchObject({
      messages: [{ id: "s2" }],
    });
    await expect(caller.inbox.list({ query: "sushi" })).resolves.toMatchObject({
      messages: [{ id: "s2" }],
    });
    await expect(caller.inbox.list({ query: "nonexistent" })).resolves.toMatchObject({
      messages: [],
    });
  });

  it("opens a full email by id, scoped to the tenant", async () => {
    const corsair = new CorsairFake();
    corsair.seedLiveMailbox("tenant_open", [
      msg("open1", { body: "Full body of the email", to: "me@example.com" }),
    ]);
    const caller = makeCaller("tenant_open", db, corsair);
    await caller.inbox.refresh();

    await expect(caller.inbox.message({ id: "open1" })).resolves.toMatchObject({
      id: "open1",
      body: "Full body of the email",
      to: "me@example.com",
    });

    // unknown id and other tenants' messages both come back null
    await expect(caller.inbox.message({ id: "missing" })).resolves.toBeNull();
    const intruder = makeCaller("tenant_intruder", db, corsair);
    await expect(intruder.inbox.message({ id: "open1" })).resolves.toBeNull();
  });

  it("refresh drops messages deleted from the live mailbox", async () => {
    const corsair = new CorsairFake();
    corsair.seedLiveMailbox("tenant_del", [msg("d1"), msg("d2")]);
    const caller = makeCaller("tenant_del", db, corsair);

    await caller.inbox.refresh();
    expect((await caller.inbox.list()).messages).toHaveLength(2);

    corsair.seedLiveMailbox("tenant_del", [msg("d1")]);
    const refresh = await caller.inbox.refresh();
    expect(refresh.deleted).toBe(1);

    const list = await caller.inbox.list();
    expect(list.messages.map((m) => m.id)).toEqual(["d1"]);
    await expect(caller.inbox.message({ id: "d2" })).resolves.toBeNull();
  });

  it("tenants cannot see or evict each other's mail", async () => {
    const corsair = new CorsairFake();
    corsair.seedLiveMailbox("tenant_x", [msg("x1")]);
    corsair.seedLiveMailbox("tenant_y", [msg("y1")]);
    const x = makeCaller("tenant_x", db, corsair);
    const y = makeCaller("tenant_y", db, corsair);

    await x.inbox.refresh();
    await y.inbox.refresh();

    expect((await x.inbox.list()).messages.map((m) => m.id)).toEqual(["x1"]);
    expect((await y.inbox.list()).messages.map((m) => m.id)).toEqual(["y1"]);

    // y syncing an empty mailbox must not touch x's cache
    corsair.seedLiveMailbox("tenant_y", []);
    await y.inbox.refresh();
    expect((await y.inbox.list()).messages).toEqual([]);
    expect((await x.inbox.list()).messages.map((m) => m.id)).toEqual(["x1"]);
    await expect(x.inbox.message({ id: "y1" })).resolves.toBeNull();
  });

  it("poller runs any provider and records freshness per tenant", async () => {
    const calls: string[] = [];
    const poller = new Poller(db, [
      {
        name: "googlecalendar",
        sync: async (tenantId) => {
          calls.push(tenantId);
          return { syncedAt: "2026-02-01T00:00:00.000Z" };
        },
      },
    ]);

    await poller.pollTenant("tenant_poll");
    expect(calls).toEqual(["tenant_poll"]);
    await expect(getLastSync(db, "tenant_poll", "googlecalendar")).resolves.toBe(
      "2026-02-01T00:00:00.000Z",
    );
  });

  it("re-polling advances the freshness timestamp", async () => {
    let tick = 0;
    const poller = new Poller(db, [
      {
        name: "googlecalendar",
        sync: async () => {
          tick += 1;
          return { syncedAt: new Date(Date.UTC(2026, 1, tick)).toISOString() };
        },
      },
    ]);

    await poller.pollTenant("tenant_fresh");
    const first = await getLastSync(db, "tenant_fresh", "googlecalendar");
    await poller.pollTenant("tenant_fresh");
    const second = await getLastSync(db, "tenant_fresh", "googlecalendar");

    expect(first).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it("pollAll discovers tenants from sync state and isolates provider failures", async () => {
    const corsair = new CorsairFake();
    await makeCaller("tenant_p1", db, corsair).inbox.refresh();
    await makeCaller("tenant_p2", db, corsair).inbox.refresh();

    const polled: string[] = [];
    const poller = new Poller(db, [
      {
        name: "gmail",
        sync: async (tenantId) => {
          if (tenantId === "tenant_p1") throw new Error("disconnected");
          polled.push(tenantId);
          return { syncedAt: new Date().toISOString() };
        },
      },
    ]);

    await poller.pollAll();
    expect(polled).toContain("tenant_p2");
    expect(polled).not.toContain("tenant_p1");
  });

  it("message exposes original html for the reader, and stays plain for text mail", async () => {
    const corsair = new CorsairFake();
    const html = '<div style="color:#e53e3e"><b>Hi Manish</b></div>';
    corsair.seedLiveMailbox("tenant_rich", [
      msg("h1", { html }),
      msg("h2", { body: "just plain text" }),
    ]);
    const caller = makeCaller("tenant_rich", db, corsair);
    await caller.inbox.refresh();

    const rich = await caller.inbox.message({ id: "h1" });
    expect(rich?.html).toBe(html);
    const plain = await caller.inbox.message({ id: "h2" });
    expect(plain?.html ?? "").toBe("");
  });

  it("rejects unauthenticated callers on every procedure", async () => {
    const caller = makeCaller(null, db, new CorsairFake());
    await expect(caller.inbox.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.inbox.message({ id: "x" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.inbox.refresh()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("extractHtml", () => {
  const html = "<div><b>Hi Manish</b></div>";

  it("decodes a base64url html part from a multipart payload", () => {
    const payload = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: Buffer.from("plain").toString("base64url") } },
        { mimeType: "text/html", body: { data: Buffer.from(html).toString("base64url") } },
      ],
    };
    expect(extractHtml(payload)).toBe(html);
  });

  it("finds html nested deeper in multiparts", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [{ mimeType: "text/html", body: { data: Buffer.from(html).toString("base64url") } }],
        },
      ],
    };
    expect(extractHtml(payload)).toBe(html);
  });

  it("returns html already stored decoded", () => {
    expect(extractHtml({ mimeType: "text/html", body: { data: html } })).toBe(html);
  });

  it("falls back to the extracted body when it is html and the payload has none", () => {
    expect(extractHtml(undefined, html)).toBe(html);
    expect(extractHtml({ mimeType: "text/plain" }, html)).toBe(html);
  });

  it("returns empty for plain-text mail and garbage", () => {
    expect(extractHtml(undefined, "hello world")).toBe("");
    expect(extractHtml({ mimeType: "text/plain", body: { data: "aGk=" } }, "hi")).toBe("");
    expect(extractHtml(null, null)).toBe("");
  });
});

describe("normalizeInternalDate", () => {
  it("converts gmail epoch-ms strings to ISO", () => {
    expect(normalizeInternalDate("1792726960000")).toBe(new Date(1792726960000).toISOString());
  });

  it("passes ISO through untouched", () => {
    expect(normalizeInternalDate("2026-01-01T10:00:00.000Z")).toBe("2026-01-01T10:00:00.000Z");
  });

  it("leaves unusable values alone instead of throwing", () => {
    expect(normalizeInternalDate("")).toBe("");
    expect(normalizeInternalDate("not-a-date")).toBe("not-a-date");
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "@/server/api/root";
import { CorsairFake, type CachedEvent } from "@/server/adapters/corsair";
import { LlmFake } from "@/server/adapters/llm";
import { type Db, createTestDb } from "@/server/db";
import { actions } from "@/server/db/schema";
import { Poller } from "@/server/sync/poller";
import { getLastSync } from "@/server/sync/state";

const DAY = 86_400_000;

function makeCaller(tenantId: string | null, db: Db, corsair: CorsairFake) {
  const session = tenantId
    ? { user: { id: tenantId, name: "Tester", email: "t@example.com", image: null }, expires: "2099-01-01T00:00:00.000Z" }
    : null;
  return appRouter.createCaller({ db, session, corsair, llm: new LlmFake() });
}

// Event offset from now, always at noon local time.
function ev(id: string, offsetDays: number, overrides: Partial<CachedEvent> = {}): CachedEvent {
  const start = new Date(Date.now() + offsetDays * DAY);
  start.setHours(12, 0, 0, 0);
  const end = new Date(start.getTime() + 3_600_000);
  return {
    id,
    summary: `Event ${id}`,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    htmlLink: `https://calendar.google.com/event?eid=${id}`,
    joinLink: `https://meet.google.com/${id}`,
    ...overrides,
  };
}

async function actionRow(db: Db, id: string) {
  const [row] = await db.select().from(actions).where(eq(actions.id, id)).limit(1);
  return row;
}

describe("router seam: calendar (ticket #8)", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  });

  it("routine shows today through +7 days (day 7 in, day 8 out), synced via refresh", async () => {
    const corsair = new CorsairFake();
    corsair.seedLiveCalendar("tenant_routine", [ev("soon", 2), ev("d7", 7), ev("d8", 8)]);
    const caller = makeCaller("tenant_routine", db, corsair);

    expect(await caller.calendar.routine()).toEqual([]);

    const refresh = await caller.calendar.refresh();
    expect(refresh.synced).toBe(3);

    const routine = await caller.calendar.routine();
    expect(routine.map((e) => e.id)).toEqual(["soon", "d7"]);
  });

  it("events query returns only the requested window", async () => {
    const corsair = new CorsairFake();
    corsair.seedLiveCalendar("tenant_window", [ev("w1", 2), ev("w2", 30)]);
    const caller = makeCaller("tenant_window", db, corsair);
    await caller.calendar.refresh();

    const from = new Date(Date.now() + 1 * DAY).toISOString();
    const to = new Date(Date.now() + 5 * DAY).toISOString();
    const events = await caller.calendar.events({ timeMin: from, timeMax: to });
    expect(events.map((e) => e.id)).toEqual(["w1"]);
  });

  it("direct create reaches Corsair immediately with no approval and records a human action", async () => {
    const corsair = new CorsairFake();
    const caller = makeCaller("tenant_create", db, corsair);
    const start = new Date(Date.now() + DAY).toISOString();

    const written = await caller.calendar.createEvent({ summary: "Standup", start });

    expect(corsair.createdEvents).toEqual([
      {
        tenantId: "tenant_create",
        summary: "Standup",
        start,
        end: new Date(Date.parse(start) + 3_600_000).toISOString(),
      },
    ]);
    // ungated like inbox writes: no proposal row anywhere
    expect(await caller.chat.proposals()).toEqual([]);
    await expect(actionRow(db, written.id)).resolves.toMatchObject({
      kind: "calendar.create",
      initiator: "human",
      status: "executed",
    });
    // survives the next sync (real plugin write-throughs both ways)
    await caller.calendar.refresh();
    expect((await caller.calendar.routine()).map((e) => e.summary)).toContain("Standup");
  });

  it("rejects an empty summary before any write happens", async () => {
    const corsair = new CorsairFake();
    const caller = makeCaller("tenant_invalid", db, corsair);

    await expect(
      caller.calendar.createEvent({ summary: "", start: new Date().toISOString() }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(corsair.createdEvents).toEqual([]);
  });

  it("keeps calendar data isolated between tenants", async () => {
    const corsair = new CorsairFake();
    corsair.seedLiveCalendar("tenant_iso_a", [ev("a1", 2)]);
    await makeCaller("tenant_iso_a", db, corsair).calendar.refresh();
    await makeCaller("tenant_iso_a", db, corsair).calendar.createEvent({
      summary: "A only",
      start: new Date(Date.now() + 3 * DAY).toISOString(),
    });

    const callerB = makeCaller("tenant_iso_b", db, corsair);
    const wide = {
      timeMin: new Date(Date.now() - DAY).toISOString(),
      timeMax: new Date(Date.now() + 10 * DAY).toISOString(),
    };
    expect(await callerB.calendar.routine()).toEqual([]);
    expect(await callerB.calendar.events(wide)).toEqual([]);

    await callerB.calendar.createEvent({
      summary: "B only",
      start: new Date(Date.now() + 4 * DAY).toISOString(),
    });

    const routineA = await makeCaller("tenant_iso_a", db, corsair).calendar.routine();
    expect(routineA.map((e) => e.summary)).toEqual(
      expect.arrayContaining(["Event a1", "A only"]),
    );
    expect(routineA.map((e) => e.summary)).not.toContain("B only");
  });

  it("poller syncs the calendar provider and isolates a failing provider", async () => {
    const corsair = new CorsairFake();
    corsair.seedLiveCalendar("tenant_pcal", [ev("p1", 1)]);
    const poller = new Poller(db, [
      { name: "gmail", sync: async () => { throw new Error("not connected"); } },
      { name: "googlecalendar", sync: (tenantId) => corsair.syncCalendar(tenantId) },
    ]);

    await poller.pollTenant("tenant_pcal");

    await expect(getLastSync(db, "tenant_pcal", "googlecalendar")).resolves.not.toBeNull();
    await expect(getLastSync(db, "tenant_pcal", "gmail")).resolves.toBeNull();
    const routine = await makeCaller("tenant_pcal", db, corsair).calendar.routine();
    expect(routine.map((e) => e.id)).toEqual(["p1"]);
  });

  it("rejects unauthenticated callers on every calendar procedure", async () => {
    const caller = makeCaller(null, db, new CorsairFake());
    const wide = {
      timeMin: new Date().toISOString(),
      timeMax: new Date(Date.now() + DAY).toISOString(),
    };
    await expect(caller.calendar.routine()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.calendar.events(wide)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      caller.calendar.createEvent({ summary: "x", start: wide.timeMin }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.calendar.refresh()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

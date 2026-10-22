import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "@/server/api/root";
import { CorsairFake, routineWindow, type CachedEvent } from "@/server/adapters/corsair";
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

async function askAll(
  caller: ReturnType<typeof makeCaller>,
  input: { sessionId: string | null; content: string },
): Promise<AskEvent[]> {
  const stream = (await caller.chat.ask(input)) as unknown as AsyncIterable<AskEvent>;
  const events: AskEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const HOUR = 3_600_000;
// relative times: routineWindow() slides with the clock, fixed dates would rot
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function ev(id: string, start: string, end: string): CachedEvent {
  return {
    id,
    summary: "Team sync",
    start: { dateTime: start },
    end: { dateTime: end },
    htmlLink: `https://calendar.google.com/event?eid=${id}`,
    joinLink: "",
  };
}

async function actionRow(db: Db, id: string) {
  const [row] = await db.select().from(actions).where(eq(actions.id, id)).limit(1);
  return row;
}

describe("router seam: approval-gated agent calendar writes (ADR-0001)", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  });

  // Drives one chat turn in which the model calls the given propose tool.
  async function propose(
    caller: ReturnType<typeof makeCaller>,
    llm: LlmFake,
    tool: string,
    args: Record<string, unknown>,
  ) {
    llm.script(
      { toolCalls: [{ name: tool, arguments: args }] },
      { text: "Waiting for your approval in Chat." },
    );
    await askAll(caller, { sessionId: null, content: `calendar ${tool}` });
    const proposals = await caller.chat.proposals();
    return proposals[0];
  }

  it("schedule stays inert until approved, then creates exactly once", async () => {
    const corsair = new CorsairFake();
    const llm = new LlmFake();
    const caller = makeCaller("tenant_sched", db, corsair, llm);
    const args = {
      summary: "Design review",
      start: iso(HOUR),
      end: iso(2 * HOUR),
      attendees: ["a@example.com"],
      notify: true,
    };

    const proposal = await propose(caller, llm, "propose_schedule_event", args);

    expect(corsair.createdEvents).toEqual([]);
    expect(proposal).toMatchObject({
      kind: "calendar.create",
      initiator: "agent",
      status: "pending",
      payload: args,
    });
    expect(JSON.stringify(llm.requests[1].messages)).toContain("pending_approval");

    const result = await caller.chat.approve({ id: proposal.id });
    expect(result).toMatchObject({ kind: "calendar.create", status: "executed", id: proposal.id });
    expect(corsair.createdEvents).toEqual([{ tenantId: "tenant_sched", ...args }]);
    expect(await caller.chat.proposals()).toEqual([]);
    await expect(actionRow(db, proposal.id)).resolves.toMatchObject({
      initiator: "agent",
      status: "executed",
    });

    await expect(caller.chat.approve({ id: proposal.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(corsair.createdEvents).toHaveLength(1);
    // the audit row survives: a discard after execution must not flip it
    await expect(caller.chat.discardProposal({ id: proposal.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("honors an explicit notify=false choice: the event is created silently", async () => {
    const corsair = new CorsairFake();
    const llm = new LlmFake();
    const caller = makeCaller("tenant_silent", db, corsair, llm);
    const args = {
      summary: "Quiet standup",
      start: iso(HOUR),
      end: iso(2 * HOUR),
      attendees: ["b@example.com"],
      notify: false,
    };

    const proposal = await propose(caller, llm, "propose_schedule_event", args);
    await caller.chat.approve({ id: proposal.id });

    expect(corsair.createdEvents).toHaveLength(1);
    expect(corsair.createdEvents[0]?.notify).toBe(false);
  });

  it("reschedule moves the times only after approval", async () => {
    const corsair = new CorsairFake();
    const llm = new LlmFake();
    const caller = makeCaller("tenant_move", db, corsair, llm);
    const oldStart = iso(HOUR);
    const oldEnd = iso(2 * HOUR);
    corsair.seedLiveCalendar("tenant_move", [ev("ev1", oldStart, oldEnd)]);
    await caller.calendar.refresh();
    const start = iso(5 * HOUR);
    const end = iso(6 * HOUR);

    const proposal = await propose(caller, llm, "propose_reschedule_event", {
      eventId: "ev1",
      summary: "Team sync",
      start,
      end,
      notify: true,
    });

    expect(corsair.rescheduled).toEqual([]);
    const before = await corsair.listCachedEvents("tenant_move", routineWindow());
    expect(before[0]?.start.dateTime).toBe(oldStart);

    await caller.chat.approve({ id: proposal.id });
    expect(corsair.rescheduled).toEqual([
      { tenantId: "tenant_move", eventId: "ev1", start, end, notify: true },
    ]);
    const after = await corsair.listCachedEvents("tenant_move", routineWindow());
    expect(after[0]?.start.dateTime).toBe(start);
    expect(after[0]?.end.dateTime).toBe(end);
    expect(await caller.chat.proposals()).toEqual([]);
  });

  it("cancel removes the event only after approval", async () => {
    const corsair = new CorsairFake();
    const llm = new LlmFake();
    const caller = makeCaller("tenant_cancel", db, corsair, llm);
    corsair.seedLiveCalendar("tenant_cancel", [ev("ev2", iso(HOUR), iso(2 * HOUR))]);
    await caller.calendar.refresh();

    const proposal = await propose(caller, llm, "propose_cancel_event", {
      eventId: "ev2",
      summary: "Team sync",
      notify: false,
    });

    expect(corsair.canceled).toEqual([]);
    expect(await corsair.listCachedEvents("tenant_cancel", routineWindow())).toHaveLength(1);

    await caller.chat.approve({ id: proposal.id });
    expect(corsair.canceled).toEqual([
      { tenantId: "tenant_cancel", eventId: "ev2", notify: false },
    ]);
    expect(await corsair.listCachedEvents("tenant_cancel", routineWindow())).toEqual([]);
  });

  it("edit stores kind-aware values the fake receives on approve", async () => {
    const corsair = new CorsairFake();
    const llm = new LlmFake();
    const caller = makeCaller("tenant_edit_cal", db, corsair, llm);
    const args = {
      summary: "Standup",
      start: iso(HOUR),
      end: iso(2 * HOUR),
      attendees: [] as string[],
      notify: true,
    };

    const proposal = await propose(caller, llm, "propose_schedule_event", args);
    const edited = {
      summary: "Standup (moved)",
      start: iso(7 * HOUR),
      end: iso(8 * HOUR),
      attendees: ["late@example.com"],
      notify: false,
    };

    await caller.chat.editProposal({ id: proposal.id, ...edited });
    await expect(actionRow(db, proposal.id)).resolves.toMatchObject({
      status: "edited",
      payload: edited,
    });

    await caller.chat.approve({ id: proposal.id });
    expect(corsair.createdEvents).toEqual([{ tenantId: "tenant_edit_cal", ...edited }]);
  });

  it("discard blocks the calendar write; later approve conflicts", async () => {
    const corsair = new CorsairFake();
    const llm = new LlmFake();
    const caller = makeCaller("tenant_discard_cal", db, corsair, llm);

    const proposal = await propose(caller, llm, "propose_cancel_event", {
      eventId: "ev3",
      summary: "Ghost event",
      notify: true,
    });
    const result = await caller.chat.discardProposal({ id: proposal.id });
    expect(result).toEqual({ id: proposal.id, status: "discarded" });

    expect(corsair.canceled).toEqual([]);
    expect(await caller.chat.proposals()).toEqual([]);
    await expect(actionRow(db, proposal.id)).resolves.toMatchObject({ status: "discarded" });
    await expect(caller.chat.approve({ id: proposal.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("list_events feeds the model from the cache so it can find event ids", async () => {
    const corsair = new CorsairFake();
    const llm = new LlmFake().script(
      { toolCalls: [{ name: "list_events", arguments: {} }] },
      { text: "Found it." },
    );
    const caller = makeCaller("tenant_list_ev", db, corsair, llm);
    corsair.seedLiveCalendar("tenant_list_ev", [ev("ev4", iso(HOUR), iso(2 * HOUR))]);
    await caller.calendar.refresh();

    await askAll(caller, { sessionId: null, content: "what is on my calendar?" });

    expect(JSON.stringify(llm.requests[1].messages)).toContain("Team sync");
    expect(JSON.stringify(llm.requests[1].messages)).toContain("ev4");
  });

  it("contrast: a human calendar.createEvent writes immediately while the agent proposal waits", async () => {
    const corsair = new CorsairFake();
    const llm = new LlmFake();
    const caller = makeCaller("tenant_pair_cal", db, corsair, llm);

    await caller.calendar.createEvent({ summary: "Human block", start: iso(HOUR) });
    expect(corsair.createdEvents).toHaveLength(1);

    const proposal = await propose(caller, llm, "propose_schedule_event", {
      summary: "Agent block",
      start: iso(3 * HOUR),
      end: iso(4 * HOUR),
      attendees: [],
      notify: true,
    });
    expect(corsair.createdEvents).toHaveLength(1);

    await caller.chat.approve({ id: proposal.id });
    expect(corsair.createdEvents).toHaveLength(2);
    expect(corsair.createdEvents[1]).toMatchObject({ summary: "Agent block", notify: true });
  });

  it("rejects a malformed start at the tool boundary before any proposal exists", async () => {
    const corsair = new CorsairFake();
    const llm = new LlmFake().script(
      {
        toolCalls: [
          {
            name: "propose_schedule_event",
            arguments: { summary: "Bad time", start: "tomorrow at 3", attendees: [], notify: false },
          },
        ],
      },
      { text: "Let me retry with a proper time." },
    );
    const caller = makeCaller("tenant_badtime", db, corsair, llm);

    await askAll(caller, { sessionId: null, content: "schedule tomorrow at 3" });

    expect(JSON.stringify(llm.requests[1].messages)).toContain("ISO datetime");
    expect(await caller.chat.proposals()).toEqual([]);
    expect(corsair.createdEvents).toEqual([]);
  });

  it("a corrupt stored payload fails approve before the claim and stays pending", async () => {
    const corsair = new CorsairFake();
    const caller = makeCaller("tenant_corrupt", db, corsair, new LlmFake());
    await db.insert(actions).values({
      id: "corrupt_cal_1",
      tenantId: "tenant_corrupt",
      kind: "calendar.create",
      initiator: "agent",
      status: "pending",
      payload: { summary: "No start" },
    });

    await expect(caller.chat.approve({ id: "corrupt_cal_1" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(corsair.createdEvents).toEqual([]);
    await expect(actionRow(db, "corrupt_cal_1")).resolves.toMatchObject({ status: "pending" });
  });
});

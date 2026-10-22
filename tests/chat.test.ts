import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "@/server/api/root";
import { CorsairFake, type CachedMessage } from "@/server/adapters/corsair";
import { LlmFake } from "@/server/adapters/llm";
import { type Db, createTestDb } from "@/server/db";

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

function replyOf(events: AskEvent[]): string {
  const done = events.at(-1) as { type: string; reply?: string };
  expect(done.type).toBe("done");
  return done.reply ?? "";
}

function sessionIdOf(events: AskEvent[]): string {
  const first = events[0] as { type: string; sessionId?: string };
  expect(first.type).toBe("session");
  return first.sessionId ?? "";
}

describe("router seam: chat sessions, streaming, agent reads", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  });

  it("creates a Session on first ask, streams deltas, persists both turns", async () => {
    const llm = new LlmFake().script({ text: "Hello there" });
    const caller = makeCaller("tenant_chat1", db, new CorsairFake(), llm);

    const events = await askAll(caller, { sessionId: null, content: "hi assistant" });
    const sessionId = sessionIdOf(events);

    const streamed = events
      .filter((e): e is { type: "delta"; text: string } => e.type === "delta")
      .map((e) => e.text)
      .join("");
    expect(streamed).toBe("Hello there");
    expect(replyOf(events)).toBe("Hello there");

    const rows = await caller.chat.messages({ sessionId });
    expect(rows.map((r) => [r.role, r.content])).toEqual([
      ["user", "hi assistant"],
      ["assistant", "Hello there"],
    ]);

    const list = await caller.chat.sessions();
    expect(list[0]).toMatchObject({ id: sessionId, title: "hi assistant" });
  });

  it("runs a read loop: list the inbox, read a message, answer from it", async () => {
    const llm = new LlmFake().script(
      { toolCalls: [{ name: "list_emails", arguments: {} }] },
      { toolCalls: [{ name: "read_email", arguments: { id: "m1" } }] },
      { text: "The meeting is at 10am" },
    );
    const corsair = new CorsairFake();
    corsair.seedLiveMailbox("tenant_loop", [msg("m1"), msg("m2")]);
    const caller = makeCaller("tenant_loop", db, corsair, llm);
    await caller.inbox.refresh();

    const events = await askAll(caller, { sessionId: null, content: "what time is the meeting?" });
    expect(replyOf(events)).toBe("The meeting is at 10am");

    expect(llm.requests).toHaveLength(3);
    const firstToolResult = JSON.stringify(llm.requests[1].messages);
    expect(firstToolResult).toContain("Subject m1");
    const secondToolResult = JSON.stringify(llm.requests[2].messages);
    expect(secondToolResult).toContain("Body of m1");
  });

  it("digests the inbox when asked to summarize it", async () => {
    const llm = new LlmFake().script(
      { toolCalls: [{ name: "list_emails", arguments: { query: "invoice" } }] },
      { text: "Digest: one invoice from billing, one overdue reminder" },
    );
    const corsair = new CorsairFake();
    corsair.seedLiveMailbox("tenant_digest", [
      msg("i1", { subject: "Invoice 42" }),
      msg("i2", { subject: "Newsletter" }),
    ]);
    const caller = makeCaller("tenant_digest", db, corsair, llm);
    await caller.inbox.refresh();

    const events = await askAll(caller, { sessionId: null, content: "summarize my inbox about invoices" });
    expect(replyOf(events)).toBe("Digest: one invoice from billing, one overdue reminder");

    const first = JSON.stringify(llm.requests[0].messages);
    expect(first).toContain("summarize my inbox about invoices");
    const toolArgs = llm.requests[1].messages.filter((m) => m.role === "tool");
    expect(toolArgs).toHaveLength(1);
    expect(toolArgs[0].content).toContain("Invoice 42");
  });

  it("summarizes a single email after reading it", async () => {
    const llm = new LlmFake().script(
      { toolCalls: [{ name: "read_email", arguments: { id: "s1" } }] },
      { text: "It is a receipt for 42 euros." },
    );
    const corsair = new CorsairFake();
    corsair.seedLiveMailbox("tenant_sum", [msg("s1", { subject: "Your receipt" })]);
    const caller = makeCaller("tenant_sum", db, corsair, llm);
    await caller.inbox.refresh();

    const events = await askAll(caller, { sessionId: null, content: "summarize s1" });
    expect(replyOf(events)).toBe("It is a receipt for 42 euros.");
    expect(JSON.stringify(llm.requests[1].messages)).toContain("Your receipt");
  });

  it("offers cache reads, gated proposal tools, and memory extraction only", async () => {
    const llm = new LlmFake().script({ text: "Sure" });
    const caller = makeCaller("tenant_ro", db, new CorsairFake(), llm);

    await askAll(caller, { sessionId: null, content: "hello" });

    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0].tools).toEqual([
      "list_emails",
      "read_email",
      "propose_send_email",
      "list_events",
      "propose_schedule_event",
      "propose_reschedule_event",
      "propose_cancel_event",
      "store_memory",
    ]);
    for (const request of llm.requests) {
      // no direct provider writes exist for the model; propose is gated (ADR-0001)
      expect(request.tools).not.toContain("send_email");
      expect(request.tools).not.toContain("archive");
      expect(request.tools).not.toContain("reschedule_event");
      expect(request.tools).not.toContain("cancel_event");
    }
  });

  it("keeps sessions isolated between tenants", async () => {
    const llm = new LlmFake().script({ text: "for A" });
    const callerA = makeCaller("tenant_iso_a", db, new CorsairFake(), llm);
    const events = await askAll(callerA, { sessionId: null, content: "private thought" });
    const sessionId = sessionIdOf(events);

    const callerB = makeCaller("tenant_iso_b", db, new CorsairFake(), new LlmFake());
    await expect(callerB.chat.messages({ sessionId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      askAll(callerB, { sessionId, content: "sneaky" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await callerB.chat.sessions()).toEqual([]);
  });

  it("resumes: a second ask carries the first exchange to the model", async () => {
    const llm = new LlmFake().script({ text: "first reply" }, { text: "second reply" });
    const caller = makeCaller("tenant_resume", db, new CorsairFake(), llm);

    const first = await askAll(caller, { sessionId: null, content: "my name is Sam" });
    const sessionId = sessionIdOf(first);
    await askAll(caller, { sessionId, content: "what is my name?" });

    expect(llm.requests).toHaveLength(2);
    const secondTurn = JSON.stringify(llm.requests[1].messages);
    expect(secondTurn).toContain("my name is Sam");
    expect(secondTurn).toContain("first reply");
    expect(secondTurn).toContain("what is my name?");

    const rows = await caller.chat.messages({ sessionId });
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("rejects unauthenticated access to every chat procedure", async () => {
    const caller = makeCaller(null, db, new CorsairFake(), new LlmFake());
    await expect(caller.chat.sessions()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.chat.messages({ sessionId: "x" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(askAll(caller, { sessionId: null, content: "hi" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

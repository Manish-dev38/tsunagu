import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "@/server/api/root";
import { CorsairFake } from "@/server/adapters/corsair";
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

async function askAll(
  caller: ReturnType<typeof makeCaller>,
  input: { sessionId: string | null; content: string },
): Promise<AskEvent[]> {
  const stream = (await caller.chat.ask(input)) as unknown as AsyncIterable<AskEvent>;
  const events: AskEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("router seam: memory", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  });

  it("stores an explicit 'remember …' as source=manual without model help", async () => {
    const llm = new LlmFake().script({ text: "Got it." });
    const caller = makeCaller("tenant_mem1", db, new CorsairFake(), llm);

    await askAll(caller, { sessionId: null, content: "remember I prefer aisle seats" });

    const rows = await caller.memory.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("manual");
    expect(rows[0].content).toBe("I prefer aisle seats");
    // deterministic: the fact exists without the model calling any tool
    expect(llm.requests).toHaveLength(1);
  });

  it("stores an agent-extracted fact as source=extracted", async () => {
    const llm = new LlmFake().script(
      { toolCalls: [{ name: "store_memory", arguments: { fact: "Works at Acme Corp" } }] },
      { text: "Noted." },
    );
    const caller = makeCaller("tenant_mem2", db, new CorsairFake(), llm);

    await askAll(caller, { sessionId: null, content: "hello" });

    const rows = await caller.memory.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("extracted");
    expect(rows[0].content).toBe("Works at Acme Corp");
  });

  it("never invents memory without a trigger turn calling store_memory", async () => {
    const llm = new LlmFake().script({ text: "just chatting, nothing saved" });
    const caller = makeCaller("tenant_mem3", db, new CorsairFake(), llm);

    expect(await caller.memory.list()).toEqual([]);
    await askAll(caller, { sessionId: null, content: "just chatting" });
    expect(await caller.memory.list()).toEqual([]);
  });

  it("reads Memory at the start of each turn, visible in the model's first request", async () => {
    const llm = new LlmFake()
      .script({ text: "Saved." })
      .script({ text: "Momo." });
    const caller = makeCaller("tenant_mem4", db, new CorsairFake(), llm);

    await askAll(caller, { sessionId: null, content: "remember My cat is named Momo" });
    await askAll(caller, { sessionId: null, content: "what is my cat's name?" });

    const firstMessage = llm.requests[1].messages[1] as { role: string; content: string };
    expect(llm.requests[1].messages[0]).toMatchObject({ role: "system" });
    expect(firstMessage.role).toBe("system");
    expect(firstMessage.content).toContain("Momo");
    // memory sits before conversation history
    const historyStart = llm.requests[1].messages.findIndex((m) => m.role === "user");
    expect(historyStart).toBeGreaterThan(1);
  });

  it("keeps a manual remember even when the model turn fails", async () => {
    const llm = new LlmFake(); // no scripted response: the turn throws
    const caller = makeCaller("tenant_mem6", db, new CorsairFake(), llm);

    await expect(
      askAll(caller, { sessionId: null, content: "remember Rings the doorbell twice" }),
    ).rejects.toThrow();
    const rows = await caller.memory.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("manual");
    expect(rows[0].content).toBe("Rings the doorbell twice");
  });

  it("lists both sources, and the user can edit and delete any item", async () => {
    const llm = new LlmFake()
      .script({ text: "ok" })
      .script(
        { toolCalls: [{ name: "store_memory", arguments: { fact: "Prefers window seats" } }] },
        { text: "Noted." },
      );
    const caller = makeCaller("tenant_mem5", db, new CorsairFake(), llm);

    await askAll(caller, { sessionId: null, content: "remember Lives in Berlin" });
    await askAll(caller, { sessionId: null, content: "hello" });

    const rows = await caller.memory.list();
    expect(new Set(rows.map((r) => r.source))).toEqual(new Set(["manual", "extracted"]));

    const extracted = rows.find((r) => r.source === "extracted");
    expect(extracted).toBeDefined();
    await caller.memory.update({ id: extracted!.id, content: "Prefers window seats on short flights" });
    expect((await caller.memory.list()).find((r) => r.id === extracted!.id)?.content).toBe(
      "Prefers window seats on short flights",
    );

    await caller.memory.delete({ id: extracted!.id });
    expect((await caller.memory.list()).find((r) => r.id === extracted!.id)).toBeUndefined();
    // edit validation runs at the router boundary
    const manual = rows.find((r) => r.source === "manual");
    await expect(caller.memory.update({ id: manual!.id, content: "" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("scopes list and mutations to the tenant", async () => {
    const llm = new LlmFake().script({ text: "ok" });
    const callerA = makeCaller("tenant_memA", db, new CorsairFake(), llm);
    await askAll(callerA, { sessionId: null, content: "remember A secret fact" });
    const [aRow] = await callerA.memory.list();

    const callerB = makeCaller("tenant_memB", db, new CorsairFake(), new LlmFake());
    expect(await callerB.memory.list()).toEqual([]);
    await expect(callerB.memory.update({ id: aRow.id, content: "hijacked" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(callerB.memory.delete({ id: aRow.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await callerA.memory.list())[0].content).toBe("A secret fact");
  });
});

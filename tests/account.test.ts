import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "@/server/api/root";
import { CorsairFake } from "@/server/adapters/corsair";
import { LlmFake } from "@/server/adapters/llm";
import { type Db, createTestDb } from "@/server/db";
import { sessionMessages } from "@/server/db/schema";

type AskEvent =
  | { type: "session"; sessionId: string }
  | { type: "delta"; text: string }
  | { type: "done"; reply: string };

function makeCaller(
  tenantId: string | null,
  db: Db,
  corsair: CorsairFake,
  llm: LlmFake,
) {
  const session = tenantId
    ? { user: { id: tenantId, name: "Sam Doe", email: `${tenantId}@example.com`, image: null }, expires: "2099-01-01T00:00:00.000Z" }
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

describe("router seam: account", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  });

  it("deleteData removes only the tenant's memory, sessions, and their messages", async () => {
    const corsair = new CorsairFake();
    for (const tenant of ["tenant_del_a", "tenant_del_b"]) {
      await corsair.createConnectLink(tenant, "gmail");
      corsair.simulateHubApproval(tenant, "gmail");
    }
    const llmA = new LlmFake().script({ text: "hi A" }, { text: "noted" });
    const llmB = new LlmFake().script({ text: "hi B" }, { text: "noted" });
    const callerA = makeCaller("tenant_del_a", db, corsair, llmA);
    const callerB = makeCaller("tenant_del_b", db, corsair, llmB);

    const eventsA = await askAll(callerA, { sessionId: null, content: "hello A" });
    const sessionA = (eventsA[0] as { sessionId: string }).sessionId;
    await askAll(callerA, { sessionId: sessionA, content: "remember Lives in A town" });
    const eventsB = await askAll(callerB, { sessionId: null, content: "hello B" });
    const sessionB = (eventsB[0] as { sessionId: string }).sessionId;
    expect(await callerA.memory.list()).toHaveLength(1);
    expect(await callerA.chat.sessions()).toHaveLength(1);

    const result = await callerA.account.deleteData();
    expect(result).toEqual({ memory: 1, sessions: 1 });

    expect(await callerA.memory.list()).toEqual([]);
    expect(await callerA.chat.sessions()).toEqual([]);
    await expect(callerA.chat.messages({ sessionId: sessionA })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await db.select().from(sessionMessages).where(eq(sessionMessages.sessionId, sessionA))).toEqual([]);

    // tenant B is untouched
    expect(await callerB.chat.sessions()).toHaveLength(1);
    expect((await callerB.chat.sessions())[0].id).toBe(sessionB);
    await askAll(callerB, { sessionId: sessionB, content: "remember B fact" });
    expect(await callerB.memory.list()).toHaveLength(1);

    // connectors remain connected (disconnect lives on the Connector screen)
    expect((await corsair.connectionStatus("tenant_del_a")).gmail).toBe("connected");
  });

  it("deleteData requires a session", async () => {
    const caller = makeCaller(null, db, new CorsairFake(), new LlmFake());
    await expect(caller.account.deleteData()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

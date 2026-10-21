import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "@/server/api/root";
import { CorsairFake } from "@/server/adapters/corsair";
import { LlmFake } from "@/server/adapters/llm";
import { type Db, createTestDb } from "@/server/db";
import { actions } from "@/server/db/schema";

type AskEvent =
  | { type: "session"; sessionId: string }
  | { type: "delta"; text: string }
  | { type: "done"; reply: string };

const DRAFT = { to: "friend@example.com", subject: "Hello", body: "Hi there" };

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

// Drives one chat turn in which the model drafts the given email.
async function draftProposal(
  caller: ReturnType<typeof makeCaller>,
  llm: LlmFake,
  draft: { to: string; subject: string; body: string },
) {
  llm.script(
    { toolCalls: [{ name: "propose_send_email", arguments: draft }] },
    { text: "Drafted and waiting for your approval in Chat." },
  );
  await askAll(caller, { sessionId: null, content: `email ${draft.to}` });
  const proposals = await caller.chat.proposals();
  return proposals[0];
}

async function actionRow(db: Db, id: string) {
  const [row] = await db.select().from(actions).where(eq(actions.id, id)).limit(1);
  return row;
}

describe("router seam: approval-gated agent send (ADR-0001)", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  });

  it("agent draft creates an inert pending proposal; nothing reaches the mailbox", async () => {
    const corsair = new CorsairFake();
    const llm = new LlmFake();
    const caller = makeCaller("tenant_gate", db, corsair, llm);

    const proposal = await draftProposal(caller, llm, DRAFT);

    expect(corsair.sent).toEqual([]);
    expect(proposal).toMatchObject({
      kind: "email.send",
      initiator: "agent",
      status: "pending",
      payload: DRAFT,
    });
    // the tool result told the model the draft is waiting for approval
    expect(JSON.stringify(llm.requests[1].messages)).toContain("pending_approval");
  });

  it("approve sends exactly the pending payload once and marks the action executed", async () => {
    const corsair = new CorsairFake();
    const llm = new LlmFake();
    const caller = makeCaller("tenant_approve", db, corsair, llm);
    const proposal = await draftProposal(caller, llm, DRAFT);

    const result = await caller.chat.approve({ id: proposal.id });

    expect(result).toMatchObject({ kind: "email.send", status: "executed", id: proposal.id });
    expect(corsair.sent).toEqual([{ tenantId: "tenant_approve", ...DRAFT }]);
    expect(await caller.chat.proposals()).toEqual([]);
    await expect(actionRow(db, proposal.id)).resolves.toMatchObject({
      initiator: "agent",
      status: "executed",
    });
  });

  it("a second approve after execution conflicts and never sends twice", async () => {
    const corsair = new CorsairFake();
    const llm = new LlmFake();
    const caller = makeCaller("tenant_double", db, corsair, llm);
    const proposal = await draftProposal(caller, llm, DRAFT);

    await caller.chat.approve({ id: proposal.id });
    await expect(caller.chat.approve({ id: proposal.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(corsair.sent).toHaveLength(1);
  });

  it("a human-initiated action cannot be approved as a proposal", async () => {
    const corsair = new CorsairFake();
    const caller = makeCaller("tenant_human", db, corsair, new LlmFake());

    const written = await caller.inbox.send({ to: "a@example.com", subject: "human", body: "now" });
    await expect(caller.chat.approve({ id: written.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(corsair.sent).toHaveLength(1);
  });

  it("edit updates the payload in place; approve then sends the edited version", async () => {
    const corsair = new CorsairFake();
    const llm = new LlmFake();
    const caller = makeCaller("tenant_edit", db, corsair, llm);
    const proposal = await draftProposal(caller, llm, DRAFT);
    const edited = { to: "boss@example.com", subject: "Re: Hello", body: "Edited body" };

    await caller.chat.editProposal({ id: proposal.id, ...edited });

    await expect(actionRow(db, proposal.id)).resolves.toMatchObject({
      status: "edited",
      payload: edited,
    });
    const open = await caller.chat.proposals();
    expect(open).toHaveLength(1);
    expect(open[0]?.payload).toEqual(edited);

    await caller.chat.approve({ id: proposal.id });
    expect(corsair.sent).toEqual([{ tenantId: "tenant_edit", ...edited }]);
  });

  it("discard sends nothing and closes the proposal; later approve conflicts", async () => {
    const corsair = new CorsairFake();
    const llm = new LlmFake();
    const caller = makeCaller("tenant_discard", db, corsair, llm);
    const proposal = await draftProposal(caller, llm, DRAFT);

    const result = await caller.chat.discardProposal({ id: proposal.id });
    expect(result).toEqual({ id: proposal.id, status: "discarded" });

    expect(corsair.sent).toEqual([]);
    expect(await caller.chat.proposals()).toEqual([]);
    await expect(actionRow(db, proposal.id)).resolves.toMatchObject({ status: "discarded" });
    await expect(caller.chat.approve({ id: proposal.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      caller.chat.editProposal({ id: proposal.id, ...DRAFT }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("a provider failure on approve surfaces status=failed and sends nothing", async () => {
    const corsair = new CorsairFake();
    const llm = new LlmFake();
    const caller = makeCaller("tenant_fail", db, corsair, llm);
    const proposal = await draftProposal(caller, llm, DRAFT);

    corsair.failWrite = new Error("smtp rejected");
    await expect(caller.chat.approve({ id: proposal.id })).rejects.toThrow("smtp rejected");

    expect(corsair.sent).toEqual([]);
    await expect(actionRow(db, proposal.id)).resolves.toMatchObject({ status: "failed" });
  });

  it("contrast pair: a human send executes immediately while the agent draft waits", async () => {
    const corsair = new CorsairFake();
    const llm = new LlmFake();
    const caller = makeCaller("tenant_pair", db, corsair, llm);

    // human direct write - ungated, the user is the approval (ticket #5)
    await caller.inbox.send({ to: "a@example.com", subject: "human", body: "now" });
    expect(corsair).toMatchObject({ sent: [{ tenantId: "tenant_pair", to: "a@example.com" }] });

    // agent write - inert until approved
    const proposal = await draftProposal(caller, llm, DRAFT);
    expect(corsair.sent).toHaveLength(1);

    await caller.chat.approve({ id: proposal.id });
    expect(corsair.sent).toHaveLength(2);
    expect(corsair.sent[1]).toMatchObject({ to: DRAFT.to, subject: DRAFT.subject });
  });

  it("keeps proposals isolated between tenants", async () => {
    const corsair = new CorsairFake();
    const llm = new LlmFake();
    const callerA = makeCaller("tenant_prop_a", db, corsair, llm);
    const proposal = await draftProposal(callerA, llm, DRAFT);

    const callerB = makeCaller("tenant_prop_b", db, new CorsairFake(), new LlmFake());
    expect(await callerB.chat.proposals()).toEqual([]);
    await expect(callerB.chat.approve({ id: proposal.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      callerB.chat.editProposal({ id: proposal.id, ...DRAFT }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(callerB.chat.discardProposal({ id: proposal.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects unauthenticated access to every approval procedure", async () => {
    const caller = makeCaller(null, db, new CorsairFake(), new LlmFake());
    await expect(caller.chat.proposals()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.chat.approve({ id: "x" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.chat.editProposal({ id: "x", ...DRAFT })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.chat.discardProposal({ id: "x" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { isUnread, type CorsairPort } from "@/server/adapters/corsair";
import type { LlmMessage, LlmPort, ToolSpec } from "@/server/adapters/llm";
import { createProposal } from "@/server/actions";
import type { Db } from "@/server/db";
import { sessionMessages } from "@/server/db/schema";

// shortcut: fixed iteration cap; raise when a real workflow needs more tool hops
const MAX_ITERATIONS = 8;

// propose_send_email only creates a pending approval proposal - never a
// provider write; the mail leaves exclusively via the approval card (ADR-0001).
export const AGENT_TOOLS: ToolSpec[] = [
  {
    name: "list_emails",
    description:
      "List or search the user's inbox from the local cache. Returns id, from, subject, snippet, date and unread flag.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Free-text search over subject, sender, snippet and body",
        },
        unreadOnly: { type: "boolean", description: "Only return unread emails" },
        limit: { type: "number", description: "Max results, default 10, capped at 50" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "read_email",
    description: "Read one email in full by its id.",
    parameters: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_send_email",
    description:
      "Propose sending an email (to/subject/body). Creates a pending proposal the user reviews in Chat with Approve, Edit and Discard; nothing is sent until they approve.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient address" },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["to", "subject", "body"],
      additionalProperties: false,
    },
  },
];

const SYSTEM_PROMPT = [
  "You are the Tsunagu assistant, a concise email aide.",
  "You can list/search the inbox and read single emails in full, all from a local cache.",
  "When the user asks to send an email, draft it and call propose_send_email, then tell them it is waiting for approval in Chat; never claim it was sent.",
  "You cannot modify, delete, archive or label anything, and you have no calendar access yet - never claim otherwise.",
  "For 'summarize this email' read it first; for 'summarize my inbox' list first, then answer in a short digest.",
].join(" ");

export type ChatTurnEvent =
  | { type: "delta"; text: string }
  | { type: "done"; reply: string };

export async function* runChatTurn(opts: {
  db: Db;
  corsair: CorsairPort;
  llm: LlmPort;
  tenantId: string;
  sessionId: string;
  userText: string;
}): AsyncGenerator<ChatTurnEvent> {
  const { db, corsair, llm, tenantId, sessionId, userText } = opts;

  await db.insert(sessionMessages).values({
    id: randomUUID(),
    sessionId,
    role: "user",
    content: userText,
  });

  const history = await db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.sessionId, sessionId))
    .orderBy(asc(sessionMessages.createdAt));

  const messages: LlmMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  let seen = "";
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    let text = "";
    const toolCalls: { id: string; name: string; arguments: string }[] = [];
    for await (const event of llm.streamChat({ messages, tools: AGENT_TOOLS })) {
      if (event.type === "text_delta") {
        text += event.text;
        seen += event.text;
        yield { type: "delta", text: event.text };
      } else if (event.type === "tool_call") {
        toolCalls.push(event);
      }
    }
    if (toolCalls.length === 0) break;
    messages.push({ role: "assistant", content: text || null, toolCalls });
    for (const call of toolCalls) {
      messages.push({
        role: "tool",
        toolCallId: call.id,
        content: await executeTool(db, corsair, tenantId, call.name, call.arguments),
      });
    }
  }

  const reply = seen || "I couldn't complete that request.";
  await db.insert(sessionMessages).values({
    id: randomUUID(),
    sessionId,
    role: "assistant",
    content: reply,
  });
  yield { type: "done", reply };
}

async function executeTool(
  db: Db,
  corsair: CorsairPort,
  tenantId: string,
  name: string,
  argsJson: string,
): Promise<string> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    return JSON.stringify({ error: "invalid JSON arguments" });
  }
  try {
    if (name === "list_emails") {
      const messages = await corsair.listCachedMessages(tenantId, {
        query: typeof args.query === "string" && args.query ? args.query : undefined,
        filter: args.unreadOnly ? "unread" : "all",
        limit: Math.min(Number(args.limit) || 10, 50),
      });
      return JSON.stringify(
        messages.map((m) => ({
          id: m.id,
          from: m.from,
          subject: m.subject,
          snippet: m.snippet,
          date: m.internalDate,
          unread: isUnread(m),
        })),
      );
    }
    if (name === "read_email") {
      const id = typeof args.id === "string" ? args.id : "";
      const message = id ? await corsair.getCachedMessage(tenantId, id) : null;
      return JSON.stringify(message ?? { error: `no email with id ${id}` });
    }
    if (name === "propose_send_email") {
      if (
        typeof args.to !== "string" ||
        !args.to.trim() ||
        typeof args.subject !== "string" ||
        typeof args.body !== "string"
      ) {
        return JSON.stringify({ error: "to, subject and body are required" });
      }
      const proposal = await createProposal(db, tenantId, {
        to: args.to,
        subject: args.subject,
        body: args.body,
      });
      return JSON.stringify({
        status: "pending_approval",
        proposalId: proposal.id,
        message: "Draft created. Nothing was sent; the user must approve it in Chat.",
      });
    }
    return JSON.stringify({ error: `unknown tool ${name}` });
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
  }
}

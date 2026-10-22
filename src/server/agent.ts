import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { isUnread, routineWindow, type CorsairPort } from "@/server/adapters/corsair";
import type { LlmMessage, LlmPort, ToolSpec } from "@/server/adapters/llm";
import { createProposal, isoDatetime } from "@/server/actions";
import type { Db } from "@/server/db";
import { sessionMessages } from "@/server/db/schema";

// shortcut: fixed iteration cap; raise when a real workflow needs more tool hops
const MAX_ITERATIONS = 8;

// propose_* tools only create pending approval proposals - never provider
// writes; every change leaves exclusively via the approval card (ADR-0001).
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
  {
    name: "list_events",
    description:
      "List the user's upcoming calendar events (today through the next 7 days) from the local cache. Returns id, summary, start, end and join link; use the id for reschedule/cancel proposals.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "propose_schedule_event",
    description:
      "Propose creating a calendar event. Creates a pending proposal the user reviews in Chat with Approve, Edit and Discard; nothing is added to the calendar and no attendee is notified until they approve. notify=true emails attendees the invitation on approval, false keeps it silent.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Event title" },
        start: { type: "string", description: "ISO datetime, e.g. 2026-10-25T10:00:00.000Z" },
        end: { type: "string", description: "ISO datetime; defaults to one hour after start if omitted" },
        attendees: {
          type: "array",
          items: { type: "string" },
          description: "Attendee email addresses; empty array when the user is the only participant",
        },
        notify: {
          type: "boolean",
          description: "Explicit choice: true to email attendees on approval, false to keep it silent",
        },
      },
      required: ["summary", "start", "attendees", "notify"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_reschedule_event",
    description:
      "Propose moving an existing event to a new time. Creates a pending proposal; nothing changes on the calendar until the user approves. notify=true emails attendees about the change, false keeps it silent.",
    parameters: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Event id from list_events" },
        summary: { type: "string", description: "The event's title from list_events; shown on the approval card" },
        start: { type: "string", description: "New ISO datetime start" },
        end: { type: "string", description: "New ISO datetime end (keep the original duration when the user does not state one)" },
        notify: { type: "boolean", description: "Explicit choice: true to email attendees, false to stay silent" },
      },
      required: ["eventId", "summary", "start", "end", "notify"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_cancel_event",
    description:
      "Propose cancelling an existing event. Creates a pending proposal; nothing changes on the calendar until the user approves. notify=true emails attendees the cancellation, false keeps it silent.",
    parameters: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Event id from list_events" },
        summary: { type: "string", description: "The event's title from list_events; shown on the approval card" },
        notify: { type: "boolean", description: "Explicit choice: true to email attendees, false to stay silent" },
      },
      required: ["eventId", "summary", "notify"],
      additionalProperties: false,
    },
  },
];

const SYSTEM_PROMPT = [
  "You are the Tsunagu assistant, a concise email and calendar aide.",
  "You can list/search the inbox and read single emails in full, all from a local cache.",
  "When the user asks to send an email, draft it and call propose_send_email, then tell them it is waiting for approval in Chat; never claim it was sent.",
  "You can see upcoming calendar events with list_events. To schedule, move or cancel an event, call propose_schedule_event, propose_reschedule_event or propose_cancel_event and tell the user it is waiting for approval; nothing reaches the calendar before they approve.",
  "Always make an explicit notify choice on calendar proposals: true to email attendees about the change, false to keep it silent.",
  "You cannot modify, delete, archive or label email, and calendar changes only happen through the approval cards.",
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
        kind: "email.send",
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
    if (name === "list_events") {
      const events = await corsair.listCachedEvents(tenantId, routineWindow());
      return JSON.stringify(
        events.map((e) => ({
          id: e.id,
          summary: e.summary,
          start: e.start,
          end: e.end,
          joinLink: e.joinLink,
        })),
      );
    }
    if (name === "propose_schedule_event") {
      if (typeof args.summary !== "string" || !args.summary.trim() || typeof args.start !== "string" || !args.start) {
        return JSON.stringify({ error: "summary and start are required" });
      }
      // same schema as approve-time validation: reject bad formats here so a
      // proposal the model is told "pending" never fails approval later
      if (!isoDatetime.safeParse(args.start).success) {
        return JSON.stringify({ error: "start must be an ISO datetime, e.g. 2026-10-25T10:00:00.000Z" });
      }
      if (typeof args.end === "string" && args.end && !isoDatetime.safeParse(args.end).success) {
        return JSON.stringify({ error: "end must be an ISO datetime, e.g. 2026-10-25T11:00:00.000Z" });
      }
      if (
        typeof args.notify !== "boolean" ||
        !Array.isArray(args.attendees) ||
        args.attendees.some((a) => typeof a !== "string" || !z.email().safeParse(a).success)
      ) {
        return JSON.stringify({ error: "attendees (array of email addresses) and notify (true/false choice) are required" });
      }
      const proposal = await createProposal(db, tenantId, {
        kind: "calendar.create",
        summary: args.summary,
        start: args.start,
        ...(typeof args.end === "string" && args.end ? { end: args.end } : {}),
        attendees: args.attendees as string[],
        notify: args.notify,
      });
      return JSON.stringify({
        status: "pending_approval",
        proposalId: proposal.id,
        message: "Event draft created. Nothing is on the calendar; the user must approve it in Chat.",
      });
    }
    if (name === "propose_reschedule_event") {
      if (
        typeof args.eventId !== "string" ||
        !args.eventId ||
        typeof args.summary !== "string" ||
        !args.summary.trim() ||
        typeof args.start !== "string" ||
        !args.start ||
        typeof args.end !== "string" ||
        !args.end
      ) {
        return JSON.stringify({ error: "eventId, summary, start and end are required" });
      }
      if (!isoDatetime.safeParse(args.start).success || !isoDatetime.safeParse(args.end).success) {
        return JSON.stringify({ error: "start and end must be ISO datetimes, e.g. 2026-10-25T10:00:00.000Z" });
      }
      if (typeof args.notify !== "boolean") {
        return JSON.stringify({ error: "notify is required: true to email attendees, false to keep it silent" });
      }
      const proposal = await createProposal(db, tenantId, {
        kind: "calendar.reschedule",
        eventId: args.eventId,
        summary: args.summary,
        start: args.start,
        end: args.end,
        notify: args.notify,
      });
      return JSON.stringify({
        status: "pending_approval",
        proposalId: proposal.id,
        message: "Reschedule draft created. Nothing changed on the calendar; the user must approve it in Chat.",
      });
    }
    if (name === "propose_cancel_event") {
      if (typeof args.eventId !== "string" || !args.eventId || typeof args.summary !== "string" || !args.summary.trim()) {
        return JSON.stringify({ error: "eventId and summary are required" });
      }
      if (typeof args.notify !== "boolean") {
        return JSON.stringify({ error: "notify is required: true to email attendees, false to keep it silent" });
      }
      const proposal = await createProposal(db, tenantId, {
        kind: "calendar.cancel",
        eventId: args.eventId,
        summary: args.summary,
        notify: args.notify,
      });
      return JSON.stringify({
        status: "pending_approval",
        proposalId: proposal.id,
        message: "Cancellation draft created. Nothing changed on the calendar; the user must approve it in Chat.",
      });
    }
    return JSON.stringify({ error: `unknown tool ${name}` });
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
  }
}

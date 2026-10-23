import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { runChatTurn } from "@/server/agent";
import { isoDatetime, performWrite, PROPOSAL_KINDS, type ActionWrite } from "@/server/actions";
import { CONNECTORS, routineWindow } from "@/server/adapters/corsair";
import { actions, memory, sessionMessages, sessions } from "@/server/db/schema";
import { getLastSync, recordSync } from "@/server/sync/state";
import { protectedProcedure, router, type Context } from "./trpc";

const connectorSchema = z.enum(CONNECTORS);

// One draft shape for every email send: human compose, agent proposal,
// and approval-card edits.
const emailDraftSchema = z.object({ to: z.string().min(1), subject: z.string(), body: z.string() });

const scheduleEventSchema = z.object({
  summary: z.string().min(1),
  start: isoDatetime,
  end: isoDatetime.optional(),
  attendees: z.array(z.email()).default([]),
  notify: z.boolean(),
});

const rescheduleEventSchema = z.object({
  eventId: z.string().min(1),
  summary: z.string().min(1),
  start: isoDatetime,
  end: isoDatetime,
  notify: z.boolean(),
});

const cancelEventSchema = z.object({
  eventId: z.string().min(1),
  summary: z.string().min(1),
  notify: z.boolean(),
});

// Validates a proposal payload against its kind's schema and maps it to the
// execute-time write; the create default (end = start + 1h) resolves here so
// edit stores the effective payload the card then shows.
function proposalWrite(kind: string, payload: unknown): ActionWrite {
  if (kind === "email.send") {
    const r = emailDraftSchema.safeParse(payload);
    if (!r.success) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "proposal payload is not a valid email draft" });
    }
    return { kind: "email.send", ...r.data };
  }
  if (kind === "calendar.create") {
    const r = scheduleEventSchema.safeParse(payload);
    if (!r.success) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "proposal payload is not a valid event schedule" });
    }
    return {
      kind: "calendar.create",
      summary: r.data.summary,
      start: r.data.start,
      end: r.data.end ?? new Date(Date.parse(r.data.start) + 3_600_000).toISOString(),
      attendees: r.data.attendees,
      notify: r.data.notify,
    };
  }
  if (kind === "calendar.reschedule") {
    const r = rescheduleEventSchema.safeParse(payload);
    if (!r.success) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "proposal payload is not a valid reschedule" });
    }
    return { kind: "calendar.reschedule", ...r.data };
  }
  if (kind === "calendar.cancel") {
    const r = cancelEventSchema.safeParse(payload);
    if (!r.success) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "proposal payload is not a valid cancellation" });
    }
    return { kind: "calendar.cancel", ...r.data };
  }
  throw new TRPCError({ code: "BAD_REQUEST", message: "unknown proposal kind" });
}

const connectorsRouter = router({
  list: protectedProcedure.query(({ ctx }) => ctx.corsair.connectionStatus(ctx.tenantId)),

  connectUrl: protectedProcedure
    .input(z.object({ connector: connectorSchema }))
    .mutation(async ({ ctx, input }) => {
      const { connectUrl } = await ctx.corsair.createConnectLink(ctx.tenantId, input.connector);
      return { url: connectUrl };
    }),

  disconnect: protectedProcedure
    .input(z.object({ connector: connectorSchema }))
    .mutation(({ ctx, input }) => ctx.corsair.disconnect(ctx.tenantId, input.connector)),
});

const inboxRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          filter: z.enum(["all", "unread"]).optional(),
          query: z.string().optional(),
          limit: z.number().int().min(1).max(100).optional(),
          offset: z.number().int().min(0).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const { filter = "all", query, limit = 50, offset = 0 } = input ?? {};
      const [messages, unreadCount, lastSyncedAt] = await Promise.all([
        ctx.corsair.listCachedMessages(ctx.tenantId, { filter, query, limit, offset }),
        ctx.corsair.cachedUnreadCount(ctx.tenantId),
        getLastSync(ctx.db, ctx.tenantId, "gmail"),
      ]);
      return { messages, unreadCount, lastSyncedAt };
    }),

  message: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => ctx.corsair.getCachedMessage(ctx.tenantId, input.id)),

  refresh: protectedProcedure.mutation(async ({ ctx }) => {
    const result = await ctx.corsair.syncGmail(ctx.tenantId);
    await recordSync(ctx.db, ctx.tenantId, "gmail", new Date(result.syncedAt));
    return result;
  }),

  send: protectedProcedure
    .input(emailDraftSchema)
    .mutation(({ ctx, input }) =>
      performWrite(ctx.db, ctx.corsair, ctx.tenantId, {
        kind: "email.send",
        ...input,
      }),
    ),

  archive: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) =>
      performWrite(ctx.db, ctx.corsair, ctx.tenantId, {
        kind: "mail.archive",
        messageId: input.id,
      }),
    ),

  setStarred: protectedProcedure
    .input(z.object({ id: z.string(), starred: z.boolean() }))
    .mutation(({ ctx, input }) =>
      performWrite(ctx.db, ctx.corsair, ctx.tenantId, {
        kind: input.starred ? "mail.star" : "mail.unstar",
        messageId: input.id,
      }),
    ),

  setRead: protectedProcedure
    .input(z.object({ id: z.string(), read: z.boolean() }))
    .mutation(({ ctx, input }) =>
      performWrite(ctx.db, ctx.corsair, ctx.tenantId, {
        kind: input.read ? "mail.mark_read" : "mail.mark_unread",
        messageId: input.id,
      }),
    ),
});

const chatRouter = router({
  sessions: protectedProcedure.query(({ ctx }) =>
    ctx.db
      .select()
      .from(sessions)
      .where(eq(sessions.tenantId, ctx.tenantId))
      .orderBy(desc(sessions.updatedAt)),
  ),

  messages: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertSession(ctx.db, input.sessionId, ctx.tenantId);
      return ctx.db
        .select()
        .from(sessionMessages)
        .where(eq(sessionMessages.sessionId, input.sessionId))
        .orderBy(asc(sessionMessages.createdAt));
    }),

  ask: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().nullable(),
        content: z.string().min(1).max(4000),
      }),
    )
    .subscription(async function* ({ ctx, input }) {
      let sessionId = input.sessionId;
      if (sessionId) {
        await assertSession(ctx.db, sessionId, ctx.tenantId);
      } else {
        sessionId = randomUUID();
        await ctx.db.insert(sessions).values({
          id: sessionId,
          tenantId: ctx.tenantId,
          title: input.content.slice(0, 60),
        });
      }
      // Explicit "remember …" is a direct Memory write: the human typed it,
      // which is the approval (ADR-0001); no card, no model cooperation.
      // shortcut: prefix match only, widen when more phrasings matter
      const remembered = input.content.match(/^remember\s+(.+)/i);
      const rememberedContent = remembered?.[1].trim();
      if (rememberedContent) {
        await ctx.db.insert(memory).values({
          id: randomUUID(),
          tenantId: ctx.tenantId,
          content: rememberedContent,
          source: "manual",
        });
      }
      yield { type: "session" as const, sessionId };
      yield* runChatTurn({
        db: ctx.db,
        corsair: ctx.corsair,
        llm: ctx.llm,
        tenantId: ctx.tenantId,
        sessionId,
        userText: input.content,
      });
      await ctx.db.update(sessions).set({ updatedAt: new Date() }).where(eq(sessions.id, sessionId));
    }),

  // Approval cards (ADR-0001): the agent's proposals sit here inert until
  // approved, edited then approved, or discarded.
  proposals: protectedProcedure.query(({ ctx }) =>
    ctx.db
      .select()
      .from(actions)
      .where(
        and(
          eq(actions.tenantId, ctx.tenantId),
          inArray(actions.kind, PROPOSAL_KINDS),
          eq(actions.initiator, "agent"),
          inArray(actions.status, ["pending", "edited"]),
        ),
      )
      .orderBy(desc(actions.createdAt)),
  ),

  approve: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const proposal = await loadProposal(ctx.db, input.id, ctx.tenantId);
      // validate before claiming: a corrupt payload must not burn the proposal
      const write = proposalWrite(proposal.kind, proposal.payload);
      // the status guard is the claim: only one concurrent approve/discard/edit
      // can move pending|edited -> approved, so the write happens exactly once
      const claimed = await ctx.db
        .update(actions)
        .set({ status: "approved" })
        .where(
          and(
            eq(actions.id, proposal.id),
            eq(actions.tenantId, ctx.tenantId),
            inArray(actions.status, ["pending", "edited"]),
          ),
        )
        .returning({ id: actions.id });
      if (claimed.length === 0) throw new TRPCError({ code: "CONFLICT" });
      return performWrite(
        ctx.db,
        ctx.corsair,
        ctx.tenantId,
        write,
        { actionId: proposal.id },
      );
    }),

  editProposal: protectedProcedure
    // loose: the payload keys depend on the proposal's kind; proposalWrite
    // validates them against that kind's schema below
    .input(z.object({ id: z.string().min(1) }).loose())
    .mutation(async ({ ctx, input }) => {
      const proposal = await loadProposal(ctx.db, input.id, ctx.tenantId);
      const write = proposalWrite(proposal.kind, input);
      const payload: Record<string, unknown> = { ...write };
      delete payload.kind;
      const updated = await ctx.db
        .update(actions)
        .set({ status: "edited", payload })
        .where(
          and(
            eq(actions.id, proposal.id),
            eq(actions.tenantId, ctx.tenantId),
            inArray(actions.status, ["pending", "edited"]),
          ),
        )
        .returning({ id: actions.id });
      if (updated.length === 0) throw new TRPCError({ code: "CONFLICT" });
      return { id: proposal.id, status: "edited" as const };
    }),

  discardProposal: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const proposal = await loadProposal(ctx.db, input.id, ctx.tenantId);
      // same claim guard as approve/edit: never flip an executed write back,
      // the Action row is the audit trail (ADR-0001)
      const discarded = await ctx.db
        .update(actions)
        .set({ status: "discarded" })
        .where(
          and(
            eq(actions.id, proposal.id),
            eq(actions.tenantId, ctx.tenantId),
            inArray(actions.status, ["pending", "edited"]),
          ),
        )
        .returning({ id: actions.id });
      if (discarded.length === 0) throw new TRPCError({ code: "CONFLICT" });
      return { id: proposal.id, status: "discarded" as const };
    }),
});

async function loadProposal(db: Context["db"], id: string, tenantId: string) {
  const [proposal] = await db
    .select()
    .from(actions)
    .where(
      and(
        eq(actions.id, id),
        eq(actions.tenantId, tenantId),
        eq(actions.initiator, "agent"),
        inArray(actions.kind, PROPOSAL_KINDS),
      ),
    )
    .limit(1);
  if (!proposal) throw new TRPCError({ code: "NOT_FOUND" });
  if (proposal.status !== "pending" && proposal.status !== "edited") {
    throw new TRPCError({ code: "CONFLICT" });
  }
  return proposal;
}

async function assertSession(db: Context["db"], sessionId: string, tenantId: string) {
  const [session] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.tenantId, tenantId)))
    .limit(1);
  if (!session) throw new TRPCError({ code: "NOT_FOUND" });
}

// Human calendar writes are ungated like inbox writes (ADR-0001: the user is
// the approval); agent calendar writes go through the approval cards (#9).
const calendarRouter = router({
  refresh: protectedProcedure.mutation(async ({ ctx }) => {
    const result = await ctx.corsair.syncCalendar(ctx.tenantId);
    await recordSync(ctx.db, ctx.tenantId, "googlecalendar", new Date(result.syncedAt));
    return result;
  }),

  routine: protectedProcedure.query(({ ctx }) =>
    ctx.corsair.listCachedEvents(ctx.tenantId, routineWindow()),
  ),

  events: protectedProcedure
    .input(z.object({ timeMin: isoDatetime, timeMax: isoDatetime }))
    .query(({ ctx, input }) =>
      ctx.corsair.listCachedEvents(ctx.tenantId, {
        timeMin: input.timeMin,
        timeMax: input.timeMax,
      }),
    ),

  createEvent: protectedProcedure
    .input(
      z.object({
        summary: z.string().min(1),
        start: isoDatetime,
        end: isoDatetime.optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const end = input.end ?? new Date(Date.parse(input.start) + 3_600_000).toISOString();
      return performWrite(ctx.db, ctx.corsair, ctx.tenantId, {
        kind: "calendar.create",
        summary: input.summary,
        start: input.start,
        end,
        attendees: [],
        notify: false,
      });
    }),
});

const memoryRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db
      .select()
      .from(memory)
      .where(eq(memory.tenantId, ctx.tenantId))
      .orderBy(desc(memory.createdAt)),
  ),

  update: protectedProcedure
    .input(z.object({ id: z.string().min(1), content: z.string().trim().min(1).max(4000) }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .update(memory)
        .set({ content: input.content })
        .where(and(eq(memory.id, input.id), eq(memory.tenantId, ctx.tenantId)))
        .returning({ id: memory.id });
      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
      return rows[0];
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .delete(memory)
        .where(and(eq(memory.id, input.id), eq(memory.tenantId, ctx.tenantId)))
        .returning({ id: memory.id });
      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
      return rows[0];
    }),
});

// Undo-where-possible (ADR-0001): one-step reversal of executed archive/star
// rows; everything else (sent mail, proposals, calendar, failed rows) offers none.
const UNDOABLE: Partial<Record<string, (messageId: string) => ActionWrite>> = {
  "mail.archive": (messageId) => ({ kind: "mail.unarchive", messageId }),
  "mail.star": (messageId) => ({ kind: "mail.unstar", messageId }),
};

const actionRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(actions)
      .where(eq(actions.tenantId, ctx.tenantId))
      .orderBy(desc(actions.createdAt));
    // flag mirrors the undo mutation's guard: legacy rows without a payload
    // messageId would offer a button that can only fail with CONFLICT
    return rows.map((row) => {
      const messageId = (row.payload as { messageId?: unknown } | null)?.messageId;
      return {
        ...row,
        undoable: row.status === "executed" && typeof messageId === "string" && row.kind in UNDOABLE,
      };
    });
  }),

  undo: protectedProcedure
    .input(z.object({ actionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(actions)
        .where(and(eq(actions.id, input.actionId), eq(actions.tenantId, ctx.tenantId)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      const messageId = (row.payload as { messageId?: string } | null)?.messageId;
      const undoWrite = messageId ? UNDOABLE[row.kind]?.(messageId) : undefined;
      if (!undoWrite || row.status !== "executed") {
        throw new TRPCError({ code: "CONFLICT", message: "this action cannot be undone" });
      }
      // reverses through the shared write pipeline, which logs a new Action
      return performWrite(ctx.db, ctx.corsair, ctx.tenantId, undoWrite);
    }),
});

const accountRouter = router({
  // clean exit: Memory + Sessions only — the action log stays as audit trail,
  // connectors stay connected until disconnected on the Connector screen
  deleteData: protectedProcedure.mutation(async ({ ctx }) => {
    const deletedMemory = await ctx.db
      .delete(memory)
      .where(eq(memory.tenantId, ctx.tenantId))
      .returning({ id: memory.id });
    // session_messages cascade via the FK
    const deletedSessions = await ctx.db
      .delete(sessions)
      .where(eq(sessions.tenantId, ctx.tenantId))
      .returning({ id: sessions.id });
    return { memory: deletedMemory.length, sessions: deletedSessions.length };
  }),
});

export const appRouter = router({
  me: protectedProcedure.query(({ ctx }) => ({
    tenantId: ctx.tenantId,
    name: ctx.session?.user?.name ?? null,
    email: ctx.session?.user?.email ?? null,
  })),
  connectors: connectorsRouter,
  inbox: inboxRouter,
  chat: chatRouter,
  calendar: calendarRouter,
  memory: memoryRouter,
  action: actionRouter,
  account: accountRouter,
});

export type AppRouter = typeof appRouter;

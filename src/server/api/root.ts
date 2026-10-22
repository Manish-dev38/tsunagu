import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { runChatTurn } from "@/server/agent";
import { performWrite } from "@/server/actions";
import { CONNECTORS, routineWindow } from "@/server/adapters/corsair";
import { actions, sessionMessages, sessions } from "@/server/db/schema";
import { getLastSync, recordSync } from "@/server/sync/state";
import { protectedProcedure, router, type Context } from "./trpc";

const connectorSchema = z.enum(CONNECTORS);

// One draft shape for every email send: human compose, agent proposal,
// and approval-card edits.
const emailDraftSchema = z.object({ to: z.string().min(1), subject: z.string(), body: z.string() });

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
          eq(actions.kind, "email.send"),
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
      // the status guard is the claim: only one concurrent approve/discard/edit
      // can move pending|edited -> approved, so the send happens exactly once
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
      const parsed = emailDraftSchema.safeParse(proposal.payload);
      if (!parsed.success) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "proposal payload is not a valid email draft" });
      }
      return performWrite(
        ctx.db,
        ctx.corsair,
        ctx.tenantId,
        { kind: "email.send", ...parsed.data },
        { actionId: proposal.id },
      );
    }),

  editProposal: protectedProcedure
    .input(z.object({ id: z.string() }).extend(emailDraftSchema.shape))
    .mutation(async ({ ctx, input }) => {
      const proposal = await loadProposal(ctx.db, input.id, ctx.tenantId);
      await ctx.db
        .update(actions)
        .set({
          status: "edited",
          payload: { to: input.to, subject: input.subject, body: input.body },
        })
        .where(eq(actions.id, proposal.id));
      return { id: proposal.id, status: "edited" as const };
    }),

  discardProposal: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const proposal = await loadProposal(ctx.db, input.id, ctx.tenantId);
      await ctx.db
        .update(actions)
        .set({ status: "discarded" })
        .where(eq(actions.id, proposal.id));
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
        eq(actions.kind, "email.send"),
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

const isoDatetime = z.iso.datetime("must be an ISO datetime");

// Human calendar writes are ungated like inbox writes (ADR-0001: the user is
// the approval); the agent gets no calendar tool until #9.
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
      });
    }),
});

export const appRouter = router({
  me: protectedProcedure.query(({ ctx }) => ({
    tenantId: ctx.tenantId,
    name: ctx.session?.user?.name ?? null,
  })),
  connectors: connectorsRouter,
  inbox: inboxRouter,
  chat: chatRouter,
  calendar: calendarRouter,
});

export type AppRouter = typeof appRouter;

import { z } from "zod";
import { performWrite } from "@/server/actions";
import { CONNECTORS } from "@/server/adapters/corsair";
import { getLastSync, recordSync } from "@/server/sync/state";
import { protectedProcedure, router } from "./trpc";

const connectorSchema = z.enum(CONNECTORS);

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
    .input(z.object({ to: z.string().min(1), subject: z.string(), body: z.string() }))
    .mutation(({ ctx, input }) =>
      performWrite(ctx.db, ctx.corsair, ctx.tenantId, {
        kind: "email.send",
        to: input.to,
        subject: input.subject,
        body: input.body,
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

export const appRouter = router({
  me: protectedProcedure.query(({ ctx }) => ({
    tenantId: ctx.tenantId,
    name: ctx.session?.user?.name ?? null,
  })),
  connectors: connectorsRouter,
  inbox: inboxRouter,
});

export type AppRouter = typeof appRouter;

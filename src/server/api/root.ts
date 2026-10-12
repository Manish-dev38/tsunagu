import { z } from "zod";
import { CONNECTOR_PLUGINS } from "@/server/adapters/corsair";
import { protectedProcedure, router } from "./trpc";

const pluginSchema = z.enum(CONNECTOR_PLUGINS);

const connectorsRouter = router({
  list: protectedProcedure.query(({ ctx }) => ctx.corsair.connectionStatus(ctx.tenantId)),

  connectUrl: protectedProcedure
    .input(z.object({ plugin: pluginSchema }))
    .mutation(async ({ ctx, input }) => {
      const { connectUrl } = await ctx.corsair.createConnectLink(ctx.tenantId, input.plugin);
      return { url: connectUrl };
    }),

  disconnect: protectedProcedure
    .input(z.object({ plugin: pluginSchema }))
    .mutation(({ ctx, input }) => ctx.corsair.disconnect(ctx.tenantId, input.plugin)),
});

export const appRouter = router({
  me: protectedProcedure.query(({ ctx }) => ({
    tenantId: ctx.tenantId,
    name: ctx.session?.user?.name ?? null,
  })),
  connectors: connectorsRouter,
});

export type AppRouter = typeof appRouter;

import { z } from "zod";
import { CONNECTORS } from "@/server/adapters/corsair";
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

export const appRouter = router({
  me: protectedProcedure.query(({ ctx }) => ({
    tenantId: ctx.tenantId,
    name: ctx.session?.user?.name ?? null,
  })),
  connectors: connectorsRouter,
});

export type AppRouter = typeof appRouter;

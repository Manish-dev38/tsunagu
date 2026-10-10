import { protectedProcedure, router } from "./trpc";

export const appRouter = router({
  me: protectedProcedure.query(({ ctx }) => ({
    tenantId: ctx.tenantId,
    name: ctx.session?.user?.name ?? null,
  })),
});

export type AppRouter = typeof appRouter;

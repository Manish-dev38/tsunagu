import { publicProcedure, router } from "./trpc";

export const appRouter = router({
  me: publicProcedure.query(({ ctx }) => ({
    tenantId: ctx.session?.user?.id ?? null,
    name: ctx.session?.user?.name ?? null,
  })),
});

export type AppRouter = typeof appRouter;

import { initTRPC, TRPCError } from "@trpc/server";
import type { Session } from "next-auth";
import type { CorsairPort } from "@/server/adapters/corsair";
import type { LlmPort } from "@/server/adapters/llm";
import type { Db } from "@/server/db";

export interface Context {
  db: Db;
  session: Session | null;
  corsair: CorsairPort;
  llm: LlmPort;
}

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user?.id) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, tenantId: ctx.session.user.id } });
});

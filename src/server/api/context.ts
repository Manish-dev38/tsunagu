import { auth } from "@/server/auth";
import { LlmFake } from "@/server/adapters/llm";
import { RealCorsair } from "@/server/corsair/client";
import { getDb } from "@/server/db";
import { ensurePolling } from "@/server/sync/poller";
import type { Context } from "./trpc";

export async function createContext(): Promise<Context> {
  const db = getDb();
  const corsair = new RealCorsair();
  ensurePolling(db, corsair);
  return {
    db,
    session: await auth(),
    corsair,
    llm: new LlmFake(),
  };
}

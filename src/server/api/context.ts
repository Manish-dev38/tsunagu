import { auth } from "@/server/auth";
import { RealCorsair } from "@/server/corsair/client";
import { getDb } from "@/server/db";
import { openAiLlm } from "@/server/llm";
import type { Context } from "./trpc";

export async function createContext(): Promise<Context> {
  const db = getDb();
  const corsair = new RealCorsair();
  return {
    db,
    session: await auth(),
    corsair,
    llm: openAiLlm,
  };
}

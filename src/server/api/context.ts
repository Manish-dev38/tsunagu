import { auth } from "@/server/auth";
import { LlmFake } from "@/server/adapters/llm";
import { RealCorsair } from "@/server/corsair/client";
import { getDb } from "@/server/db";
import type { Context } from "./trpc";

export async function createContext(): Promise<Context> {
  return {
    db: getDb(),
    session: await auth(),
    corsair: new RealCorsair(),
    llm: new LlmFake(),
  };
}

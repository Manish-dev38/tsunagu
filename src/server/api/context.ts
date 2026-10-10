import { auth } from "@/server/auth";
import { CorsairFake } from "@/server/adapters/corsair";
import { LlmFake } from "@/server/adapters/llm";
import { getDb } from "@/server/db";
import type { Context } from "./trpc";

export async function createContext(): Promise<Context> {
  return {
    db: getDb(),
    session: await auth(),
    corsair: new CorsairFake(),
    llm: new LlmFake(),
  };
}

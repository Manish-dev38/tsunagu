import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "@/server/api/root";
import { CorsairFake } from "@/server/adapters/corsair";
import { LlmFake } from "@/server/adapters/llm";
import { type Db, createTestDb } from "@/server/db";

function makeCaller(
  session: { user: { id: string; name?: string | null; email?: string | null; image?: string | null }; expires: string } | null,
  db: Db,
) {
  return appRouter.createCaller({ db, session, corsair: new CorsairFake(), llm: new LlmFake() });
}

describe("router seam: me", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  });

  it("returns the tenant id and profile name, email and image from the session", async () => {
    const caller = makeCaller(
      {
        user: {
          id: "tenant_1",
          name: "Manish",
          email: "mani@example.com",
          image: "https://lh3.googleusercontent.com/avatar.png",
        },
        expires: "2099-01-01T00:00:00.000Z",
      },
      db,
    );
    await expect(caller.me()).resolves.toEqual({
      tenantId: "tenant_1",
      name: "Manish",
      email: "mani@example.com",
      image: "https://lh3.googleusercontent.com/avatar.png",
    });
  });

  it("rejects unauthenticated callers instead of leaking a null tenant", async () => {
    const caller = makeCaller(null, db);
    await expect(caller.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

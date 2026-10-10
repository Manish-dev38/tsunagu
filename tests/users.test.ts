import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { type Db, createTestDb } from "@/server/db";
import { users } from "@/server/db/schema";
import { upsertUser } from "@/server/users";

describe("trust boundary: upsertUser", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  });

  it("rejects an identity without id", async () => {
    expect(await upsertUser(db, { id: null, email: "noid@b.c" })).toBe(false);
    const rows = await db.select().from(users).where(eq(users.email, "noid@b.c"));
    expect(rows).toHaveLength(0);
  });

  it("rejects an identity without email", async () => {
    expect(await upsertUser(db, { id: "u_noemail", email: null })).toBe(false);
    const rows = await db.select().from(users).where(eq(users.id, "u_noemail"));
    expect(rows).toHaveLength(0);
  });

  it("inserts and then updates on conflict", async () => {
    expect(await upsertUser(db, { id: "u_upsert", email: "a@b.c", name: "Old" })).toBe(true);
    expect(await upsertUser(db, { id: "u_upsert", email: "a@b.c", name: "New" })).toBe(true);
    const rows = await db.select().from(users).where(eq(users.id, "u_upsert"));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("New");
  });
});

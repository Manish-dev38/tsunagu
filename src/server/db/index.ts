import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";
import { dbSource, ensureDbDir } from "./source";

function createDrizzle(client: PGlite) {
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDrizzle>;

let testDb: Promise<Db> | undefined;

export function createTestDb(): Promise<Db> {
  testDb ??= (async () => {
    const db = createDrizzle(new PGlite());
    await migrate(db, { migrationsFolder: "./drizzle" });
    return db;
  })();
  return testDb;
}

let appDb: Db | undefined;

export function getDb(): Db {
  if (!appDb) {
    ensureDbDir();
    appDb = createDrizzle(new PGlite(dbSource));
  }
  return appDb;
}

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { Pool } from "pg";
import * as schema from "./schema";
import { dbSource, ensureDbDir } from "./source";

export type Db = ReturnType<typeof createDrizzle>;

function createDrizzle(pool: Pool) {
  return drizzle(pool, { schema });
}

// PGlite and node-postgres instances share the query surface this app uses; only $client differs.
function createLocalDrizzle(client: PGlite): Db {
  return drizzlePglite(client, { schema }) as unknown as Db;
}

let testDb: Promise<Db> | undefined;

export function createTestDb(): Promise<Db> {
  testDb ??= (async () => {
    const db = drizzlePglite(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    return db as unknown as Db;
  })();
  return testDb;
}

let appDb: Db | undefined;

export function getDb(): Db {
  if (!appDb) {
    if (process.env.DATABASE_URL) {
      appDb = createDrizzle(new Pool({ connectionString: process.env.DATABASE_URL }));
    } else {
      ensureDbDir();
      appDb = createLocalDrizzle(new PGlite(dbSource));
    }
  }
  return appDb;
}

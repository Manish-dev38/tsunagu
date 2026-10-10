import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "./schema";

function createDrizzle(client: PGlite) {
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDrizzle>;

export function createTestDb(): Db {
  return createDrizzle(new PGlite());
}

let appDb: Db | undefined;

export function getDb(): Db {
  if (!appDb) {
    const source = process.env.DATABASE_PATH ?? "./.data/tsunagu";
    // PGlite's nodefs driver creates only the leaf dir, not parents
    mkdirSync(source, { recursive: true });
    appDb = createDrizzle(new PGlite(source));
  }
  return appDb;
}

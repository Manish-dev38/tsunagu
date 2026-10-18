import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { Pool } from "pg";
import { dbSource, ensureDbDir } from "../src/server/db/source.ts";

// Neon: migrations run over the direct (unpooled) URL, per neon-postgres skill.
const directUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (directUrl) {
  const pool = new Pool({ connectionString: directUrl, max: 1 });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();
} else {
  ensureDbDir();
  await migratePglite(drizzlePglite(new PGlite(dbSource)), { migrationsFolder: "./drizzle" });
}
console.log("migrations applied");

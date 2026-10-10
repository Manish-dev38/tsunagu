import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { dbSource, ensureDbDir } from "../src/server/db/source.ts";

ensureDbDir();
const db = drizzle(new PGlite(dbSource));
await migrate(db, { migrationsFolder: "./drizzle" });
console.log("migrations applied");

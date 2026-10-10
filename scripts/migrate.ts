import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const source = process.env.DATABASE_PATH ?? "./.data/tsunagu";
mkdirSync(source, { recursive: true });
const client = new PGlite(source);
const db = drizzle(client);
await migrate(db, { migrationsFolder: "./drizzle" });
console.log("migrations applied");
await client.close();

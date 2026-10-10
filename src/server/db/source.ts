import { mkdirSync } from "node:fs";

export const dbSource = process.env.DATABASE_PATH ?? "./.data/tsunagu";

export function ensureDbDir() {
  // PGlite's nodefs driver creates only the leaf dir, not parents
  mkdirSync(dbSource, { recursive: true });
}

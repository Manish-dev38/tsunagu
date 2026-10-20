import { createCorsair } from "corsair";
import { setupCorsair } from "corsair/setup";
import { gmail } from "@corsair-dev/gmail";
import { googlecalendar } from "@corsair-dev/googlecalendar";
import { Pool } from "pg";

// DDL mirrored from corsair's own test fixtures (only place it ships), timestamps widened for pg.
const DDL = [
  `CREATE TABLE IF NOT EXISTS corsair_integrations (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    name TEXT NOT NULL,
    config TEXT NOT NULL,
    dek TEXT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS corsair_accounts (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    tenant_id TEXT NOT NULL,
    integration_id TEXT NOT NULL,
    config TEXT NOT NULL,
    dek TEXT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS corsair_entities (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    account_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    version TEXT NOT NULL,
    data TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS corsair_events (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    account_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT
  )`,
];

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} — copy .env.example to .env and fill it in`);
  return value;
}

// DDL is an admin/migration task: Neon skill says use the direct (unpooled) URL.
const connectionString = process.env.DATABASE_URL_UNPOOLED ?? required("DATABASE_URL");
const pool = new Pool({ connectionString });

for (const statement of DDL) await pool.query(statement);

const client = createCorsair({
  multiTenancy: true,
  plugins: [gmail({ authType: "oauth_2" }), googlecalendar({ authType: "oauth_2" })],
  database: pool,
  kek: required("CORSAIR_KEK"),
  hub: {
    projectApiKey: required("CORSAIR_HUB_PROJECT_API_KEY"),
    signingSecret: required("CORSAIR_HUB_SIGNING_SECRET"),
    tunnel: false,
  },
});

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const credentials =
  clientId && clientSecret
    ? {
        gmail: { client_id: clientId, client_secret: clientSecret },
        googlecalendar: { client_id: clientId, client_secret: clientSecret },
      }
    : undefined;

console.log(await setupCorsair(client, { credentials }));
await pool.end();

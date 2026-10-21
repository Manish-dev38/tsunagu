import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name"),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const syncState = pgTable(
  "sync_state",
  {
    tenantId: text("tenant_id").notNull(),
    provider: text("provider").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.provider] })],
);

// The Action log: every mailbox write (human now, agent later) is one row.
export const actions = pgTable("actions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  kind: text("kind").notNull(),
  initiator: text("initiator").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

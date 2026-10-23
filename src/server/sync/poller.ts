import type { Connector } from "@/server/adapters/corsair";
import type { Db } from "@/server/db";
import { syncState } from "@/server/db/schema";
import { recordSync } from "./state";

export interface SyncProvider {
  name: Connector;
  sync(tenantId: string): Promise<{ syncedAt: string }>;
}

export class Poller {
  constructor(
    private db: Db,
    private providers: SyncProvider[],
  ) {}

  async pollTenant(tenantId: string): Promise<void> {
    for (const provider of this.providers) {
      try {
        const { syncedAt } = await provider.sync(tenantId);
        await recordSync(this.db, tenantId, provider.name, new Date(syncedAt));
      } catch {
        // one disconnected provider must not starve the others
        // (e.g. a tenant with only Google Calendar connected)
      }
    }
  }

  async pollAll(): Promise<void> {
    // discovery: anyone who ever synced (any provider) is worth polling
    const rows = await this.db.select({ tenantId: syncState.tenantId }).from(syncState);
    const tenants = [...new Set(rows.map((row) => row.tenantId))];
    for (const tenantId of tenants) {
      try {
        await this.pollTenant(tenantId);
      } catch {
        // one disconnected tenant must not kill the poll cycle
      }
    }
  }
}

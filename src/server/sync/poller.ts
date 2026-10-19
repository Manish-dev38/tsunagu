import type { CorsairPort } from "@/server/adapters/corsair";
import type { Db } from "@/server/db";
import { syncState } from "@/server/db/schema";
import { recordSync } from "./state";

export interface SyncProvider {
  name: string;
  sync(tenantId: string): Promise<{ syncedAt: string }>;
}

const DEFAULT_INTERVAL_MS = 5 * 60_000;

export class Poller {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private db: Db,
    private providers: SyncProvider[],
    private intervalMs: number = DEFAULT_INTERVAL_MS,
  ) {}

  async pollTenant(tenantId: string): Promise<void> {
    for (const provider of this.providers) {
      const { syncedAt } = await provider.sync(tenantId);
      await recordSync(this.db, tenantId, provider.name, new Date(syncedAt));
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

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.pollAll(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

let running: Poller | undefined;

export function ensurePolling(db: Db, corsair: CorsairPort): void {
  // Calendar (#7) adds another provider entry here; the shape is the contract
  running ??= new Poller(db, [{ name: "gmail", sync: (tenantId) => corsair.syncGmail(tenantId) }]);
  running.start();
}

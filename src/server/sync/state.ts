import { and, eq } from "drizzle-orm";
import type { Connector } from "@/server/adapters/corsair";
import type { Db } from "@/server/db";
import { syncState } from "@/server/db/schema";

export async function getLastSync(db: Db, tenantId: string, provider: Connector): Promise<string | null> {
  const [row] = await db
    .select({ syncedAt: syncState.syncedAt })
    .from(syncState)
    .where(and(eq(syncState.tenantId, tenantId), eq(syncState.provider, provider)))
    .limit(1);
  return row ? row.syncedAt.toISOString() : null;
}

export async function recordSync(db: Db, tenantId: string, provider: Connector, syncedAt: Date): Promise<void> {
  await db
    .insert(syncState)
    .values({ tenantId, provider, syncedAt })
    .onConflictDoUpdate({
      target: [syncState.tenantId, syncState.provider],
      set: { syncedAt },
    });
}

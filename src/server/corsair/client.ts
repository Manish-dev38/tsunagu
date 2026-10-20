import { createCorsair } from "corsair";
import { gmail } from "@corsair-dev/gmail";
import { googlecalendar } from "@corsair-dev/googlecalendar";
import { Pool } from "pg";
import {
  applyListOptions,
  isUnread,
  type CachedMessage,
  type ConnectionStatus,
  type Connector,
  type CorsairPort,
  type ListMessagesOptions,
  type SyncResult,
} from "@/server/adapters/corsair";

let pool: Pool | undefined;
let client: ReturnType<typeof createCorsair> | undefined;

export function getClient() {
  if (!client) {
    const kek = process.env.CORSAIR_KEK;
    const databaseUrl = process.env.DATABASE_URL;
    const projectApiKey = process.env.CORSAIR_HUB_PROJECT_API_KEY;
    const signingSecret = process.env.CORSAIR_HUB_SIGNING_SECRET;
    if (!kek || !databaseUrl || !projectApiKey || !signingSecret) {
      throw new Error(
        "Corsair is not configured: set CORSAIR_KEK, DATABASE_URL, CORSAIR_HUB_PROJECT_API_KEY and CORSAIR_HUB_SIGNING_SECRET (see .env.example; run `npm run corsair:setup` once per database)",
      );
    }
    pool = new Pool({ connectionString: databaseUrl });
    client = createCorsair({
      multiTenancy: true,
      plugins: [gmail({ authType: "oauth_2" }), googlecalendar({ authType: "oauth_2" })],
      database: pool,
      kek,
      hub: {
        projectApiKey,
        signingSecret,
        redirectURL: process.env.APP_URL ? `${process.env.APP_URL}/connector` : undefined,
      },
    });
  }
  return client;
}

export class RealCorsair implements CorsairPort {
  async connectionStatus(tenantId: string): Promise<ConnectionStatus> {
    return (await getClient().manage.connectionStatus.get({ tenantId })) as ConnectionStatus;
  }

  async createConnectLink(tenantId: string, connector: Connector) {
    const link = await getClient().manage.connect.createLink({
      plugin: connector,
      tenantId,
      oauthMode: "byo",
    });
    return { connectUrl: link.connectUrl };
  }

  async disconnect(tenantId: string, connector: Connector) {
    const result = await getClient().manage.disconnect({ plugin: connector, tenantId });
    return { disconnected: result.disconnected };
  }

  async syncGmail(tenantId: string): Promise<SyncResult> {
    const client = getClient().withTenant(tenantId);
    // keep the poll light: latest 10 only (Gmail list is newest-first);
    // raise maxResults when search/history needs a deeper cache
    // cast: corsair's generic client types collapse to any through the plugin chain
    const res = (await client.gmail.api.messages.list({ maxResults: 10 })) as {
      messages?: { id?: string }[];
    };
    const liveIds = (res.messages ?? []).flatMap((m) => (m.id ? [m.id] : []));
    for (const id of liveIds) {
      // full fetch extracts subject/body/from/to; skip messages that vanish mid-sync
      await client.gmail.api.messages.get({ id, format: "full" }).catch(() => undefined);
    }
    // deletions: cache rows the live mailbox no longer returns
    const liveSet = new Set(liveIds);
    let deleted = 0;
    const cached = (await client.gmail.db.messages.list({ limit: 1000 })) as MessageEntityRow[];
    for (const entity of cached) {
      if (!liveSet.has(entity.entity_id)) {
        await client.gmail.db.messages.deleteByEntityId(entity.entity_id);
        deleted++;
      }
    }
    return { syncedAt: new Date().toISOString(), synced: liveIds.length, deleted };
  }

  async listCachedMessages(tenantId: string, opts: ListMessagesOptions = {}): Promise<CachedMessage[]> {
    // shortcut: scans at most 500 cached rows and sorts in-process (entity client has no
    // server-side sort), upgrade to a DB-side sorted query when a mailbox outgrows it
    const rows = (await getClient()
      .withTenant(tenantId)
      .gmail.db.messages.list({ limit: 500 })) as MessageEntityRow[];
    return applyListOptions(rows.map(toCachedMessage), opts);
  }

  async cachedUnreadCount(tenantId: string): Promise<number> {
    // shortcut: scans at most 1000 cached rows, upgrade with an indexed count when needed
    const rows = (await getClient()
      .withTenant(tenantId)
      .gmail.db.messages.list({ limit: 1000 })) as MessageEntityRow[];
    return rows.filter((row) => isUnread(toCachedMessage(row))).length;
  }

  async getCachedMessage(tenantId: string, messageId: string): Promise<CachedMessage | null> {
    const row = (await getClient()
      .withTenant(tenantId)
      .gmail.db.messages.findByEntityId(messageId)) as MessageEntityRow | null;
    return row ? toCachedMessage(row) : null;
  }
}

type MessageEntityRow = Parameters<typeof toCachedMessage>[0];

function toCachedMessage(row: {
  entity_id: string;
  data: {
    threadId?: string | null;
    labelIds?: string[] | null;
    snippet?: string | null;
    subject?: string | null;
    from?: string | null;
    to?: string | null;
    body?: string | null;
    internalDate?: string | null;
  };
}): CachedMessage {
  return {
    id: row.entity_id,
    threadId: row.data.threadId ?? "",
    labelIds: row.data.labelIds ?? [],
    snippet: row.data.snippet ?? "",
    subject: row.data.subject ?? "",
    from: row.data.from ?? "",
    to: row.data.to ?? "",
    body: row.data.body ?? "",
    internalDate: row.data.internalDate ?? "",
  };
}

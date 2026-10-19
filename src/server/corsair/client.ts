import { createCorsair } from "corsair";
import { gmail } from "@corsair-dev/gmail";
import { googlecalendar } from "@corsair-dev/googlecalendar";
import { Pool } from "pg";
import type {
  CachedMessage,
  ConnectionStatus,
  Connector,
  CorsairPort,
  ListMessagesOptions,
  SyncResult,
} from "@/server/adapters/corsair";

let pool: Pool | undefined;
let client: ReturnType<typeof createCorsair> | undefined;

function getClient() {
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
    // live list/get write-through into the corsair cache; cap pages at 500 for v1.
    // casts: corsair's generic client types collapse to any through the plugin chain
    const liveIds: string[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 5; page++) {
      const res = (await client.gmail.api.messages.list({ maxResults: 100, pageToken })) as {
        messages?: { id?: string }[];
        nextPageToken?: string;
      };
      for (const m of res.messages ?? []) {
        if (!m.id) continue;
        liveIds.push(m.id);
        // full fetch extracts subject/body/from/to; skip messages that vanish mid-sync
        await client.gmail.api.messages.get({ id: m.id, format: "full" }).catch(() => undefined);
      }
      pageToken = res.nextPageToken;
      if (!pageToken) break;
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
    const { filter = "all", query, limit = 50, offset = 0 } = opts;
    // scan cap: entity client has no server-side sort; upgrade when a mailbox outgrows it
    const rows = (await getClient()
      .withTenant(tenantId)
      .gmail.db.messages.list({ limit: 500 })) as MessageEntityRow[];
    let messages = rows.map(toCachedMessage);
    if (filter === "unread") messages = messages.filter((m) => m.labelIds.includes("UNREAD"));
    if (query) {
      const q = query.toLowerCase();
      messages = messages.filter((m) =>
        [m.subject, m.from, m.snippet, m.body].some((field) => field.toLowerCase().includes(q)),
      );
    }
    messages.sort((a, b) => b.internalDate.localeCompare(a.internalDate));
    return messages.slice(offset, offset + limit);
  }

  async cachedUnreadCount(tenantId: string): Promise<number> {
    const rows = (await getClient()
      .withTenant(tenantId)
      .gmail.db.messages.list({ limit: 1000 })) as MessageEntityRow[];
    return rows.filter((row) => (row.data.labelIds ?? []).includes("UNREAD")).length;
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

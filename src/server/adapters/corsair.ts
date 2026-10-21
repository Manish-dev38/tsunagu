export const CONNECTORS = ["gmail", "googlecalendar"] as const;

export type Connector = (typeof CONNECTORS)[number];

export type ConnectionState = "connected" | "missing_credentials" | "not_connected";

export type ConnectionStatus = Partial<Record<Connector, ConnectionState>>;

export interface CachedMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  subject: string;
  from: string;
  to: string;
  body: string;
  internalDate: string;
}

export interface ListMessagesOptions {
  filter?: "all" | "unread";
  query?: string;
  limit?: number;
  offset?: number;
}

export interface SyncResult {
  syncedAt: string;
  synced: number;
  deleted: number;
}

export function isUnread(message: CachedMessage): boolean {
  return message.labelIds.includes("UNREAD");
}

export function applyListOptions(messages: CachedMessage[], opts: ListMessagesOptions): CachedMessage[] {
  const { filter = "all", query, limit = 50, offset = 0 } = opts;
  let result = messages;
  if (filter === "unread") result = result.filter(isUnread);
  if (query) {
    const q = query.toLowerCase();
    result = result.filter((m) =>
      [m.subject, m.from, m.snippet, m.body].some((field) => field.toLowerCase().includes(q)),
    );
  }
  result.sort((a, b) => b.internalDate.localeCompare(a.internalDate));
  return result.slice(offset, offset + limit);
}

export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
}

export interface MailboxWrites {
  sendEmail(tenantId: string, input: SendEmailInput): Promise<void>;
  archiveMessage(tenantId: string, messageId: string): Promise<void>;
  setStarred(tenantId: string, messageId: string, starred: boolean): Promise<void>;
  setRead(tenantId: string, messageId: string, read: boolean): Promise<void>;
}

export interface CorsairPort extends MailboxWrites {
  connectionStatus(tenantId: string): Promise<ConnectionStatus>;
  createConnectLink(tenantId: string, connector: Connector): Promise<{ connectUrl: string }>;
  disconnect(tenantId: string, connector: Connector): Promise<{ disconnected: boolean }>;
  listCachedMessages(tenantId: string, opts?: ListMessagesOptions): Promise<CachedMessage[]>;
  cachedUnreadCount(tenantId: string): Promise<number>;
  getCachedMessage(tenantId: string, messageId: string): Promise<CachedMessage | null>;
  syncGmail(tenantId: string): Promise<SyncResult>;
}

export class CorsairFake implements CorsairPort {
  private connected = new Map<string, Set<Connector>>();
  private pending = new Set<string>();
  private liveMailbox = new Map<string, CachedMessage[]>();
  private cache = new Map<string, Map<string, CachedMessage>>();
  sent: Array<SendEmailInput & { tenantId: string }> = [];
  failWrite: Error | null = null;

  async connectionStatus(tenantId: string): Promise<ConnectionStatus> {
    const set = this.connected.get(tenantId);
    return Object.fromEntries(
      CONNECTORS.map((connector) => [connector, set?.has(connector) ? "connected" : "not_connected"]),
    ) as ConnectionStatus;
  }

  async createConnectLink(tenantId: string, connector: Connector) {
    this.pending.add(`${tenantId}:${connector}`);
    return { connectUrl: `https://hub.test/connect/${tenantId}/${connector}` };
  }

  async disconnect(tenantId: string, connector: Connector) {
    this.pending.delete(`${tenantId}:${connector}`);
    const disconnected = this.connected.get(tenantId)?.delete(connector) ?? false;
    return { disconnected };
  }

  async sendEmail(tenantId: string, input: SendEmailInput) {
    if (this.failWrite) throw this.failWrite;
    this.sent.push({ tenantId, ...input });
  }

  async archiveMessage(tenantId: string, messageId: string) {
    if (this.failWrite) throw this.failWrite;
    this.setLabel(tenantId, messageId, "INBOX", false);
    // drop from cache so the list reflects the archive before the next poll
    this.cache.get(tenantId)?.delete(messageId);
  }

  async setStarred(tenantId: string, messageId: string, starred: boolean) {
    if (this.failWrite) throw this.failWrite;
    this.setLabel(tenantId, messageId, "STARRED", starred);
  }

  async setRead(tenantId: string, messageId: string, read: boolean) {
    if (this.failWrite) throw this.failWrite;
    // Gmail models "read" as the absence of the UNREAD label
    this.setLabel(tenantId, messageId, "UNREAD", !read);
  }

  // mutates cache and live mailbox alike so a later sync cannot resurrect stale labels
  private setLabel(tenantId: string, messageId: string, label: string, present: boolean) {
    const cached = this.cache.get(tenantId)?.get(messageId);
    const live = (this.liveMailbox.get(tenantId) ?? []).find((m) => m.id === messageId);
    for (const msg of [cached, live]) {
      if (!msg) continue;
      const labels = new Set(msg.labelIds);
      if (present) labels.add(label);
      else labels.delete(label);
      msg.labelIds = [...labels];
    }
  }

  async listCachedMessages(tenantId: string, opts: ListMessagesOptions = {}): Promise<CachedMessage[]> {
    return applyListOptions([...(this.cache.get(tenantId)?.values() ?? [])], opts);
  }

  async cachedUnreadCount(tenantId: string): Promise<number> {
    return [...(this.cache.get(tenantId)?.values() ?? [])].filter(isUnread).length;
  }

  async getCachedMessage(tenantId: string, messageId: string): Promise<CachedMessage | null> {
    return this.cache.get(tenantId)?.get(messageId) ?? null;
  }

  seedLiveMailbox(tenantId: string, messages: CachedMessage[]): void {
    this.liveMailbox.set(tenantId, messages);
  }

  async syncGmail(tenantId: string): Promise<SyncResult> {
    // mirrors the real adapter: the poll is INBOX-scoped, so archived mail leaves the cache
    const live = (this.liveMailbox.get(tenantId) ?? []).filter((m) => m.labelIds.includes("INBOX"));
    const cache = this.cache.get(tenantId) ?? new Map<string, CachedMessage>();
    const liveIds = new Set(live.map((m) => m.id));
    let deleted = 0;
    for (const id of [...cache.keys()]) {
      if (!liveIds.has(id)) {
        cache.delete(id);
        deleted++;
      }
    }
    for (const m of live) cache.set(m.id, { ...m });
    this.cache.set(tenantId, cache);
    return { syncedAt: new Date().toISOString(), synced: live.length, deleted };
  }

  simulateHubApproval(tenantId: string, connector: Connector): boolean {
    if (!this.pending.delete(`${tenantId}:${connector}`)) return false;
    const set = this.connected.get(tenantId) ?? new Set<Connector>();
    set.add(connector);
    this.connected.set(tenantId, set);
    return true;
  }
}

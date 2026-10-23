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
  // original HTML for the reader; omitted on list rows (snippet view only)
  html?: string;
}

export function normalizeInternalDate(raw: string): string {
  // Gmail hands out epoch milliseconds as a string, which Date() rejects as-is
  if (!/^\d+$/.test(raw)) return raw;
  const d = new Date(Number(raw));
  return Number.isNaN(d.getTime()) ? raw : d.toISOString();
}

type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };

function findHtmlPart(value: unknown): GmailPart | null {
  if (!value || typeof value !== "object") return null;
  const part = value as GmailPart;
  if (part.mimeType === "text/html" && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const hit = findHtmlPart(child);
    if (hit) return hit;
  }
  return null;
}

export function extractHtml(payload: unknown, body?: string | null): string {
  const data = findHtmlPart(payload)?.body?.data;
  if (data) {
    // Gmail's body.data is base64url; rows synced already-decoded contain markup
    if (data.includes("<")) return data;
    try {
      const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
      return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    } catch {
      return "";
    }
  }
  // extractors sometimes only keep `body`, and it may itself be HTML
  if (typeof body === "string" && /^\s*<[a-z!/]/i.test(body)) return body;
  return "";
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

export interface EventDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface CachedEvent {
  id: string;
  summary: string;
  start: EventDateTime;
  end: EventDateTime;
  htmlLink: string;
  joinLink: string;
}

export interface CreateEventInput {
  summary: string;
  start: string; // ISO datetime
  end: string; // ISO datetime
  attendees: string[];
  notify: boolean; // email attendees about this change
}

export interface RescheduleEventInput {
  eventId: string;
  start: string;
  end: string;
  notify: boolean;
}

export interface CancelEventInput {
  eventId: string;
  notify: boolean;
}

// Half-open window [timeMin, timeMax) over ISO datetimes.
export interface EventWindow {
  timeMin: string;
  timeMax: string;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Routine panel window: today through +7 calendar days inclusive
// (spec: includes day 7, excludes day 8).
export function routineWindow(now = new Date()): EventWindow {
  const min = startOfDay(now);
  const max = new Date(min);
  max.setDate(max.getDate() + 8);
  return { timeMin: min.toISOString(), timeMax: max.toISOString() };
}

// Sync/cache window: the current month plus one month either side, so the
// grid can navigate a month out without a fresh poll. shortcut: fixed
// +/-1 month, widen when users navigate further than that.
export function monthWindow(now = new Date()): EventWindow {
  const min = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const max = new Date(now.getFullYear(), now.getMonth() + 2, 1);
  return { timeMin: min.toISOString(), timeMax: max.toISOString() };
}

function eventStart(event: CachedEvent): Date {
  if (event.start.dateTime) return new Date(event.start.dateTime);
  // all-day events carry a bare date: parse it as a LOCAL calendar day, not a
  // UTC instant, so the day-boundary routine window holds in every timezone
  const [y, m, d] = (event.start.date ?? "").split("-").map(Number);
  if (!y || !m || !d) return new Date(0);
  return new Date(y, m - 1, d);
}

export function inEventWindow(event: CachedEvent, window: EventWindow): boolean {
  const t = eventStart(event).getTime();
  return t >= Date.parse(window.timeMin) && t < Date.parse(window.timeMax);
}

export function applyEventWindow(events: CachedEvent[], window: EventWindow): CachedEvent[] {
  return events
    .filter((event) => inEventWindow(event, window))
    .sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime());
}

export interface MailboxWrites {
  sendEmail(tenantId: string, input: SendEmailInput): Promise<void>;
  archiveMessage(tenantId: string, messageId: string): Promise<void>;
  unarchiveMessage(tenantId: string, messageId: string): Promise<void>;
  setStarred(tenantId: string, messageId: string, starred: boolean): Promise<void>;
  setRead(tenantId: string, messageId: string, read: boolean): Promise<void>;
}

export interface CalendarWrites {
  createEvent(tenantId: string, input: CreateEventInput): Promise<void>;
  rescheduleEvent(tenantId: string, input: RescheduleEventInput): Promise<void>;
  cancelEvent(tenantId: string, input: CancelEventInput): Promise<void>;
}

export interface CorsairPort extends MailboxWrites, CalendarWrites {
  connectionStatus(tenantId: string): Promise<ConnectionStatus>;
  createConnectLink(tenantId: string, connector: Connector): Promise<{ connectUrl: string }>;
  disconnect(tenantId: string, connector: Connector): Promise<{ disconnected: boolean }>;
  listCachedMessages(tenantId: string, opts?: ListMessagesOptions): Promise<CachedMessage[]>;
  cachedUnreadCount(tenantId: string): Promise<number>;
  getCachedMessage(tenantId: string, messageId: string): Promise<CachedMessage | null>;
  listCachedEvents(tenantId: string, window: EventWindow): Promise<CachedEvent[]>;
  syncGmail(tenantId: string): Promise<SyncResult>;
  syncCalendar(tenantId: string): Promise<SyncResult>;
}

export class CorsairFake implements CorsairPort {
  private connected = new Map<string, Set<Connector>>();
  private pending = new Set<string>();
  private liveMailbox = new Map<string, CachedMessage[]>();
  private cache = new Map<string, Map<string, CachedMessage>>();
  private liveCalendar = new Map<string, CachedEvent[]>();
  private eventCache = new Map<string, Map<string, CachedEvent>>();
  sent: Array<SendEmailInput & { tenantId: string }> = [];
  createdEvents: Array<CreateEventInput & { tenantId: string }> = [];
  rescheduled: Array<RescheduleEventInput & { tenantId: string }> = [];
  canceled: Array<CancelEventInput & { tenantId: string }> = [];
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

  async unarchiveMessage(tenantId: string, messageId: string) {
    if (this.failWrite) throw this.failWrite;
    this.setLabel(tenantId, messageId, "INBOX", true);
    // restore the cache copy the archive dropped so undo is visible in the list
    const live = (this.liveMailbox.get(tenantId) ?? []).find((m) => m.id === messageId);
    if (live) this.cache.get(tenantId)?.set(messageId, { ...live });
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

  async createEvent(tenantId: string, input: CreateEventInput) {
    if (this.failWrite) throw this.failWrite;
    this.createdEvents.push({ tenantId, ...input });
    // write-through like the real plugin: cached AND visible to the next sync,
    // which would otherwise drop it as provider-absent
    const event: CachedEvent = {
      id: `evt_created_${this.createdEvents.length}`,
      summary: input.summary,
      start: { dateTime: input.start },
      end: { dateTime: input.end },
      htmlLink: "",
      joinLink: "",
    };
    const cache = this.eventCache.get(tenantId) ?? new Map<string, CachedEvent>();
    cache.set(event.id, event);
    this.eventCache.set(tenantId, cache);
    const live = this.liveCalendar.get(tenantId) ?? [];
    live.push(event);
    this.liveCalendar.set(tenantId, live);
  }

  async rescheduleEvent(tenantId: string, input: RescheduleEventInput) {
    if (this.failWrite) throw this.failWrite;
    const cache = this.eventCache.get(tenantId);
    const live = this.liveCalendar.get(tenantId);
    const idx = live ? live.findIndex((e) => e.id === input.eventId) : -1;
    const current = cache?.get(input.eventId) ?? (idx >= 0 ? live![idx] : undefined);
    if (!current) throw new Error(`no event ${input.eventId}`);
    const updated: CachedEvent = {
      ...current,
      start: { dateTime: input.start },
      end: { dateTime: input.end },
    };
    cache?.set(input.eventId, updated);
    if (idx >= 0) live![idx] = updated;
    this.rescheduled.push({ tenantId, ...input });
  }

  async cancelEvent(tenantId: string, input: CancelEventInput) {
    if (this.failWrite) throw this.failWrite;
    const cache = this.eventCache.get(tenantId);
    const live = this.liveCalendar.get(tenantId);
    const idx = live ? live.findIndex((e) => e.id === input.eventId) : -1;
    const known = (cache?.has(input.eventId) ?? false) || idx >= 0;
    if (!known) throw new Error(`no event ${input.eventId}`);
    cache?.delete(input.eventId);
    if (idx >= 0) live!.splice(idx, 1);
    this.canceled.push({ tenantId, ...input });
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

  seedLiveCalendar(tenantId: string, events: CachedEvent[]): void {
    this.liveCalendar.set(tenantId, events);
  }

  async listCachedEvents(tenantId: string, window: EventWindow): Promise<CachedEvent[]> {
    return applyEventWindow([...(this.eventCache.get(tenantId)?.values() ?? [])], window);
  }

  async syncCalendar(tenantId: string): Promise<SyncResult> {
    // mirrors the real adapter: only the sync window is fetched, and cached
    // rows inside that window the provider no longer returns are dropped
    const window = monthWindow();
    const live = (this.liveCalendar.get(tenantId) ?? []).filter((e) => inEventWindow(e, window));
    const cache = this.eventCache.get(tenantId) ?? new Map<string, CachedEvent>();
    const liveIds = new Set(live.map((e) => e.id));
    let deleted = 0;
    for (const [id, event] of [...cache]) {
      if (!liveIds.has(id) && inEventWindow(event, window)) {
        cache.delete(id);
        deleted++;
      }
    }
    for (const event of live) cache.set(event.id, { ...event });
    this.eventCache.set(tenantId, cache);
    return { syncedAt: new Date().toISOString(), synced: live.length, deleted };
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

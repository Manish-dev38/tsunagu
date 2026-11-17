import { createCorsair } from "corsair";
import { gmail } from "@corsair-dev/gmail";
import { googlecalendar } from "@corsair-dev/googlecalendar";
import { Pool } from "pg";
import {
  PAGE_SIZE,
  SYNC_WINDOW,
  applyEventWindow,
  applyListOptions,
  inEventWindow,
  isUnread,
  monthWindow,
  type CachedEvent,
  type CachedMessage,
  type CancelEventInput,
  type ConnectionStatus,
  type Connector,
  type CorsairPort,
  type CreateEventInput,
  type EventDateTime,
  type EventWindow,
  type ListMessagesOptions,
  type MessagePage,
  type PageMessagesOptions,
  type RescheduleEventInput,
  type SendEmailInput,
  type SyncResult,
  extractHtml,
  normalizeInternalDate,
} from "@/server/adapters/corsair";

let pool: Pool | undefined;
let client: ReturnType<typeof createCorsair> | undefined;
// one background fill per tenant: a Refresh click and a poll cycle must not
// stack duplicate Gmail fetches for the same ids
const fills = new Map<string, Promise<void>>();
// a cache read decrypts every row (~4-5 s for 200 mails); scrolling asks for
// one page at a time, so the parsed list is reused. Writes and every sync
// invalidate it, so the TTL costs freshness only for mail that arrives elsewhere
// (which no sync has seen either)
const SNAPSHOTS_TTL_MS = 300_000;
const snapshots = new Map<string, { at: number; messages: CachedMessage[] }>();

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
    // the newest SYNC_WINDOW inbox ids are the sync window; only ids missing
    // from the cache get fetched, so a steady-state poll does no mail work
    const liveIds = await this.inboxIds(tenantId, SYNC_WINDOW);
    const liveSet = new Set(liveIds);
    const cachedRows = (await client.gmail.db.messages.list({ limit: 1000 })) as MessageEntityRow[];
    const cachedIds = new Set(cachedRows.map((row) => row.entity_id));
    const missing = liveIds.filter((id) => !cachedIds.has(id));
    // the plugin writes each row through one at a time (~0.7 s), so 200 cold
    // messages take minutes: fill in the background instead of blocking Refresh
    // (an id list that changes while a fill runs is picked up by the next poll)
    if (missing.length && !fills.has(tenantId)) {
      fills.set(
        tenantId,
        this.fillMissing(tenantId, missing).finally(() => fills.delete(tenantId)),
      );
    }
    // deletions: a cached row above the oldest message of a full window that
    // Gmail no longer returns left the inbox (archived elsewhere). Rows below the
    // window are kept, so the cache is not trimmed back to the newest page
    const cutoff =
      liveIds.length === SYNC_WINDOW
        ? cachedRows.reduce<string | null>((min, row) => {
            if (!liveSet.has(row.entity_id)) return min;
            const date = toCachedMessage(row).internalDate;
            return min === null || date < min ? date : min;
          }, null)
        : null;
    let deleted = 0;
    const survivors: { id: string; date: string }[] = [];
    for (const row of cachedRows) {
      const date = toCachedMessage(row).internalDate;
      if (!liveSet.has(row.entity_id) && (cutoff === null || date >= cutoff)) {
        await client.gmail.db.messages.deleteByEntityId(row.entity_id);
        deleted++;
      } else {
        survivors.push({ id: row.entity_id, date });
      }
    }
    // cap: past the window, the oldest rows go first
    const overflow = survivors.length + missing.length - SYNC_WINDOW;
    if (overflow > 0) {
      survivors.sort((a, b) => a.date.localeCompare(b.date));
      for (const row of survivors.slice(0, overflow)) {
        await client.gmail.db.messages.deleteByEntityId(row.id);
        deleted++;
      }
    }
    // however the cache changed above, the paged snapshot is stale now
    snapshots.delete(tenantId);
    return { syncedAt: new Date().toISOString(), synced: liveIds.length, deleted };
  }

  // metadata only: headers + snippet is all the list needs, and a full message
  // carries ~30 KB of body, which made every cache read drag megabytes.
  // Bodies load on demand (getCachedMessage/fetchMessageLive).
  // Gmail answers 403 Forbidden for part of a wide burst, so chunks stay small
  // and one retry pass catches the rest; whatever still fails is simply missing
  // from the cache and the next poll picks it up
  private async fillMissing(tenantId: string, ids: string[]): Promise<void> {
    const client = getClient().withTenant(tenantId);
    const failed: string[] = [];
    // rows land every few seconds; invalidating per chunk would re-read the whole
    // cache that often, so a 10 s throttle keeps the first rows appearing early
    let shownAt = Date.now();
    const fetchChunks = async (batch: string[], size: number) => {
      for (let i = 0; i < batch.length; i += size) {
        const chunk = batch.slice(i, i + size);
        const results = await Promise.all(
          chunk.map((id) =>
            client.gmail.api.messages
              .get({ id, format: "metadata" })
              .then(() => true)
              .catch(() => false),
          ),
        );
        results.forEach((ok, index) => {
          if (!ok) failed.push(chunk[index]);
        });
        if (Date.now() - shownAt > 10_000) {
          snapshots.delete(tenantId);
          shownAt = Date.now();
        }
      }
      snapshots.delete(tenantId);
    };
    await fetchChunks(ids, 10);
    if (failed.length) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const retry = [...failed];
      failed.length = 0;
      await fetchChunks(retry, 5);
    }
  }

  // ids only: the plugin's messages.list also writes every id through the cache
  // one row at a time (~0.5 s each), which alone made a 200-message sync minutes.
  // Falls back to the plugin when the raw call cannot auth, so the real OAuth
  // error still surfaces.
  private async inboxIds(tenantId: string, limit: number): Promise<string[]> {
    const client = getClient().withTenant(tenantId);
    const fromPlugin = async () =>
      ((await client.gmail.api.messages.list({ maxResults: limit, labelIds: ["INBOX"] })) as {
        messages?: { id?: string }[];
      }).messages ?? [];
    try {
      const token = await client.gmail.keys.get_access_token();
      if (!token) throw new Error("no access token");
      const query = new URLSearchParams({ maxResults: String(limit), labelIds: "INBOX" });
      const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Gmail list failed (${res.status})`);
      const body = (await res.json()) as { messages?: { id?: string }[] };
      return (body.messages ?? []).flatMap((m) => (m.id ? [m.id] : []));
    } catch {
      return (await fromPlugin()).flatMap((m) => (m.id ? [m.id] : []));
    }
  }

  async syncCalendar(tenantId: string): Promise<SyncResult> {
    const client = getClient().withTenant(tenantId);
    const window = monthWindow();
    // shortcut: fixed ±1-month window, first page only, no delta sync;
    // paginate/switch to sync tokens when a calendar outgrows it
    // cast: corsair's generic client types collapse to any through the plugin chain
    const res = (await client.googlecalendar.api.events.getMany({
      timeMin: window.timeMin,
      timeMax: window.timeMax,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
    })) as { items?: { id?: string }[] };
    // getMany already write-throughs every returned event into the cache
    const liveIds = new Set((res.items ?? []).flatMap((item) => (item.id ? [item.id] : [])));
    // deletions: cached rows inside the window the provider no longer returns
    let deleted = 0;
    const cached = (await client.googlecalendar.db.events.list({ limit: 1000 })) as EventEntityRow[];
    for (const row of cached) {
      const event = toCachedEvent(row);
      if (!liveIds.has(event.id) && inEventWindow(event, window)) {
        await client.googlecalendar.db.events.deleteByEntityId(row.entity_id);
        deleted++;
      }
    }
    return { syncedAt: new Date().toISOString(), synced: liveIds.size, deleted };
  }

  async listCachedEvents(tenantId: string, window: EventWindow): Promise<CachedEvent[]> {
    // shortcut: scans at most 500 cached rows and filters in-process,
    // DB-side window query when a calendar outgrows it
    const rows = (await getClient()
      .withTenant(tenantId)
      .googlecalendar.db.events.list({ limit: 500 })) as EventEntityRow[];
    return applyEventWindow(rows.map(toCachedEvent), window);
  }

  async createEvent(tenantId: string, input: CreateEventInput) {
    // plugin write-throughs the created event into the cache, so the grid
    // and routine panel reflect it before the next poll
    const client = getClient().withTenant(tenantId);
    const created = await client.googlecalendar.api.events.create({
      event: {
        summary: input.summary,
        start: { dateTime: input.start },
        end: { dateTime: input.end },
        ...(input.attendees.length ? { attendees: input.attendees.map((email) => ({ email })) } : {}),
      },
    });
    // shortcut: plugin 0.1.8 drops sendUpdates on create (verify dist: body only,
    // no query), so notify=true needs a follow-up update that forwards it;
    // remove when upstream create accepts sendUpdates
    if (input.notify && input.attendees.length && created.id) {
      await client.googlecalendar.api.events.update({
        id: created.id,
        event: created,
        sendUpdates: "all",
      });
    }
  }

  async rescheduleEvent(tenantId: string, input: RescheduleEventInput) {
    const client = getClient().withTenant(tenantId);
    // shortcut: get-then-PUT has a lost-update window; merge by event version
    // if concurrent edits start losing data
    // update is a PUT replace: carry every current field (attendees,
    // description, reminders...) and swap only the times
    const current = await client.googlecalendar.api.events.get({ id: input.eventId });
    await client.googlecalendar.api.events.update({
      id: input.eventId,
      event: {
        ...current,
        start: { dateTime: input.start },
        end: { dateTime: input.end },
      },
      sendUpdates: input.notify ? "all" : "none",
    });
  }

  async cancelEvent(tenantId: string, input: CancelEventInput) {
    // plugin drops the cache row itself; no proactive cache delete needed
    await getClient().withTenant(tenantId).googlecalendar.api.events.delete({
      id: input.eventId,
      sendUpdates: input.notify ? "all" : "none",
    });
  }

  async listCachedMessages(tenantId: string, opts: ListMessagesOptions = {}): Promise<CachedMessage[]> {
    // shortcut: scans at most 1000 cached rows and sorts in-process (entity client has no
    // server-side sort), upgrade to a DB-side sorted query when a mailbox outgrows it
    return applyListOptions(await this.cacheSnapshot(tenantId), opts);
  }

  async cachedUnreadCount(tenantId: string): Promise<number> {
    return (await this.cacheSnapshot(tenantId)).filter(isUnread).length;
  }

  async getCachedMessage(tenantId: string, messageId: string): Promise<CachedMessage | null> {
    const row = (await getClient()
      .withTenant(tenantId)
      .gmail.db.messages.findByEntityId(messageId)) as MessageEntityRow | null;
    // sync stores metadata only, so a row without a body was never opened:
    // read it live (that call also upgrades the row to the full message)
    if (row && !row.data.body) return this.fetchMessageLive(tenantId, messageId);
    // original HTML rides only on the detail query; list rows stay snippet-sized
    return row
      ? { ...toCachedMessage(row), html: extractHtml(row.data.payload, row.data.body) }
      : null;
  }

  async pageMessages(tenantId: string, opts: PageMessagesOptions = {}): Promise<MessagePage> {
    const { cursor, filter = "all", query } = opts;
    const start = cursor ? Number(cursor) : 0;
    // browse the cache: one local read, no Gmail calls, so scrolling is instant
    const cached = await this.cacheSnapshot(tenantId);
    const matched = applyListOptions(cached, { filter, query, limit: cached.length });
    const next = start + PAGE_SIZE < matched.length ? String(start + PAGE_SIZE) : null;
    return {
      emails: matched.slice(start, start + PAGE_SIZE),
      nextPageToken: next,
      hasMore: next !== null,
      unreadCount: cached.filter(isUnread).length,
    };
  }

  // shortcut: reads at most 1000 cached rows and sorts in-process, move the
  // sort into SQL when a mailbox outgrows the sync window
  private async cacheSnapshot(tenantId: string): Promise<CachedMessage[]> {
    const hit = snapshots.get(tenantId);
    if (hit && Date.now() - hit.at < SNAPSHOTS_TTL_MS) return hit.messages;
    const rows = (await getClient()
      .withTenant(tenantId)
      .gmail.db.messages.list({ limit: 1000 })) as MessageEntityRow[];
    const messages = rows.map((row) => this.toLiveMessage(row));
    snapshots.set(tenantId, { at: Date.now(), messages });
    return messages;
  }

  async fetchMessageLive(tenantId: string, messageId: string): Promise<CachedMessage | null> {
    const client = getClient().withTenant(tenantId);
    // full format so the reader gets original HTML/body regardless of what the
    // list has paged into the cache
    await client.gmail.api.messages.get({ id: messageId, format: "full" }).catch(() => undefined);
    const row = (await client.gmail.db.messages.findByEntityId(messageId).catch(() => null)) as MessageEntityRow | null;
    // the row just grew a body, which the paged snapshot does not carry
    snapshots.delete(tenantId);
    return row ? this.toLiveMessage(row, true) : null;
  }

  private toLiveMessage(row: MessageEntityRow, withHtml = false): CachedMessage {
    return {
      ...toCachedMessage(row),
      attachments: hasAttachments(row.data.payload),
      ...(withHtml ? { html: extractHtml(row.data.payload, row.data.body) } : {}),
    };
  }

  async sendEmail(tenantId: string, input: SendEmailInput) {
    // shortcut: subject is raw UTF-8, no RFC2047 encoding; add it when non-ASCII subjects bounce
    const raw = Buffer.from(
      `To: ${input.to}\r\nSubject: ${input.subject}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${input.body}`,
    ).toString("base64url");
    await getClient().withTenant(tenantId).gmail.api.messages.send({ raw });
    snapshots.delete(tenantId);
  }

  async archiveMessage(tenantId: string, messageId: string) {
    const client = getClient().withTenant(tenantId);
    await client.gmail.api.messages.modify({ id: messageId, removeLabelIds: ["INBOX"] });
    // drop from cache so the list reflects the archive before the next poll
    await client.gmail.db.messages.deleteByEntityId(messageId).catch(() => undefined);
    snapshots.delete(tenantId);
  }

  async unarchiveMessage(tenantId: string, messageId: string) {
    await this.modifyLabel(tenantId, messageId, "INBOX", true);
  }

  async setStarred(tenantId: string, messageId: string, starred: boolean) {
    await this.modifyLabel(tenantId, messageId, "STARRED", starred);
  }

  async setRead(tenantId: string, messageId: string, read: boolean) {
    // Gmail models "read" as the absence of the UNREAD label
    await this.modifyLabel(tenantId, messageId, "UNREAD", !read);
  }

  private async modifyLabel(tenantId: string, messageId: string, label: string, present: boolean) {
    const client = getClient().withTenant(tenantId);
    await client.gmail.api.messages.modify({
      id: messageId,
      addLabelIds: present ? [label] : undefined,
      removeLabelIds: present ? undefined : [label],
    });
    // full get write-throughs the fresh labelIds into the cache
    await client.gmail.api.messages.get({ id: messageId, format: "full" }).catch(() => undefined);
    snapshots.delete(tenantId);
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
    payload?: unknown;
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
    internalDate: normalizeInternalDate(row.data.internalDate ?? ""),
  };
}

type EventEntityRow = {
  entity_id: string;
  data: {
    id?: string | null;
    summary?: string | null;
    start?: EventDateTime | null;
    end?: EventDateTime | null;
    htmlLink?: string | null;
    hangoutLink?: string | null;
    conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] | null } | null;
  };
};

type GmailPart = { mimeType?: string; filename?: string; parts?: GmailPart[] };

function hasAttachments(payload: unknown): boolean {
  // Gmail marks a part as an attachment by a non-empty filename, in the body
  // (single-part) or anywhere in the multipart tree
  if (!payload || typeof payload !== "object") return false;
  const part = payload as GmailPart;
  if (part.filename) return true;
  return (part.parts ?? []).some(hasAttachments);
}

function toCachedEvent(row: EventEntityRow): CachedEvent {
  const videoEntry = row.data.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === "video" && entry.uri,
  );
  const start: EventDateTime = {
    date: row.data.start?.date ?? undefined,
    dateTime: row.data.start?.dateTime ?? undefined,
    timeZone: row.data.start?.timeZone ?? undefined,
  };
  const end: EventDateTime = {
    date: row.data.end?.date ?? undefined,
    dateTime: row.data.end?.dateTime ?? undefined,
    timeZone: row.data.end?.timeZone ?? undefined,
  };
  return {
    id: row.entity_id,
    summary: row.data.summary ?? "",
    start,
    end,
    htmlLink: row.data.htmlLink ?? "",
    joinLink: row.data.hangoutLink ?? videoEntry?.uri ?? "",
  };
}

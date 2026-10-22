import { createCorsair } from "corsair";
import { gmail } from "@corsair-dev/gmail";
import { googlecalendar } from "@corsair-dev/googlecalendar";
import { Pool } from "pg";
import {
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
  type RescheduleEventInput,
  type SendEmailInput,
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
    // INBOX-scoped so archived mail leaves the cache on the next sync;
    // raise maxResults when search/history needs a deeper cache
    // cast: corsair's generic client types collapse to any through the plugin chain
    const res = (await client.gmail.api.messages.list({
      maxResults: 10,
      labelIds: ["INBOX"],
    })) as {
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

  async sendEmail(tenantId: string, input: SendEmailInput) {
    // shortcut: subject is raw UTF-8, no RFC2047 encoding; add it when non-ASCII subjects bounce
    const raw = Buffer.from(
      `To: ${input.to}\r\nSubject: ${input.subject}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${input.body}`,
    ).toString("base64url");
    await getClient().withTenant(tenantId).gmail.api.messages.send({ raw });
  }

  async archiveMessage(tenantId: string, messageId: string) {
    const client = getClient().withTenant(tenantId);
    await client.gmail.api.messages.modify({ id: messageId, removeLabelIds: ["INBOX"] });
    // drop from cache so the list reflects the archive before the next poll
    await client.gmail.db.messages.deleteByEntityId(messageId).catch(() => undefined);
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

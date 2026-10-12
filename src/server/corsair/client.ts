import { createCorsair } from "corsair";
import { gmail } from "@corsair-dev/gmail";
import { googlecalendar } from "@corsair-dev/googlecalendar";
import { Pool } from "pg";
import type { ConnectionStatus, Connector, CorsairPort } from "@/server/adapters/corsair";

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
}

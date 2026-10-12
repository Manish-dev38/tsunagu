export const CONNECTOR_PLUGINS = ["gmail", "googlecalendar"] as const;

export type ConnectorPlugin = (typeof CONNECTOR_PLUGINS)[number];

export type ConnectionState = "connected" | "missing_credentials" | "not_connected";

export type ConnectionStatus = Partial<Record<ConnectorPlugin, ConnectionState>>;

export interface CorsairPort {
  connectionStatus(tenantId: string): Promise<ConnectionStatus>;
  createConnectLink(tenantId: string, plugin: ConnectorPlugin): Promise<{ connectUrl: string }>;
  disconnect(tenantId: string, plugin: ConnectorPlugin): Promise<{ disconnected: boolean }>;
}

export class CorsairFake implements CorsairPort {
  private connected = new Map<string, Set<ConnectorPlugin>>();

  async connectionStatus(tenantId: string): Promise<ConnectionStatus> {
    const set = this.connected.get(tenantId);
    return Object.fromEntries(
      CONNECTOR_PLUGINS.map((plugin) => [plugin, set?.has(plugin) ? "connected" : "not_connected"]),
    ) as ConnectionStatus;
  }

  async createConnectLink(tenantId: string, plugin: ConnectorPlugin) {
    return { connectUrl: `https://hub.test/connect/${tenantId}/${plugin}` };
  }

  async disconnect(tenantId: string, plugin: ConnectorPlugin) {
    const disconnected = this.connected.get(tenantId)?.delete(plugin) ?? false;
    return { disconnected };
  }

  simulateHubApproval(tenantId: string, plugin: ConnectorPlugin) {
    const set = this.connected.get(tenantId) ?? new Set<ConnectorPlugin>();
    set.add(plugin);
    this.connected.set(tenantId, set);
  }
}

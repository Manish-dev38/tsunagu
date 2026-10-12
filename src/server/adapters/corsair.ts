export const CONNECTORS = ["gmail", "googlecalendar"] as const;

export type Connector = (typeof CONNECTORS)[number];

export type ConnectionState = "connected" | "missing_credentials" | "not_connected";

export type ConnectionStatus = Partial<Record<Connector, ConnectionState>>;

export interface CorsairPort {
  connectionStatus(tenantId: string): Promise<ConnectionStatus>;
  createConnectLink(tenantId: string, connector: Connector): Promise<{ connectUrl: string }>;
  disconnect(tenantId: string, connector: Connector): Promise<{ disconnected: boolean }>;
}

export class CorsairFake implements CorsairPort {
  private connected = new Map<string, Set<Connector>>();
  private pending = new Set<string>();

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

  simulateHubApproval(tenantId: string, connector: Connector): boolean {
    if (!this.pending.delete(`${tenantId}:${connector}`)) return false;
    const set = this.connected.get(tenantId) ?? new Set<Connector>();
    set.add(connector);
    this.connected.set(tenantId, set);
    return true;
  }
}

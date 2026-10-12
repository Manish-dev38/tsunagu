import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "@/server/api/root";
import { CorsairFake, type Connector } from "@/server/adapters/corsair";
import { LlmFake } from "@/server/adapters/llm";
import { type Db, createTestDb } from "@/server/db";

function makeCaller(tenantId: string | null, db: Db, corsair: CorsairFake) {
  const session = tenantId
    ? { user: { id: tenantId, name: "Tester", email: "t@example.com", image: null }, expires: "2099-01-01T00:00:00.000Z" }
    : null;
  return appRouter.createCaller({ db, session, corsair, llm: new LlmFake() });
}

async function approve(corsair: CorsairFake, tenantId: string, connector: Connector) {
  await corsair.createConnectLink(tenantId, connector);
  corsair.simulateHubApproval(tenantId, connector);
}

describe("router seam: connectors", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  });

  it("lists both connectors as not_connected for a fresh tenant", async () => {
    const caller = makeCaller("tenant_a", db, new CorsairFake());
    await expect(caller.connectors.list()).resolves.toEqual({
      gmail: "not_connected",
      googlecalendar: "not_connected",
    });
  });

  it("connect returns a link, and after Hub approval the status flips to connected", async () => {
    const corsair = new CorsairFake();
    const caller = makeCaller("tenant_a", db, corsair);

    const { url } = await caller.connectors.connectUrl({ connector: "gmail" });
    expect(url).toContain("tenant_a");
    await expect(caller.connectors.list()).resolves.toEqual({
      gmail: "not_connected",
      googlecalendar: "not_connected",
    });

    expect(corsair.simulateHubApproval("tenant_a", "gmail")).toBe(true);
    await expect(caller.connectors.list()).resolves.toEqual({
      gmail: "connected",
      googlecalendar: "not_connected",
    });

    expect(corsair.simulateHubApproval("tenant_a", "googlecalendar")).toBe(false);
  });

  it("disconnect removes only that connector", async () => {
    const corsair = new CorsairFake();
    await approve(corsair, "tenant_b", "gmail");
    await approve(corsair, "tenant_b", "googlecalendar");
    const caller = makeCaller("tenant_b", db, corsair);

    await caller.connectors.disconnect({ connector: "gmail" });
    await expect(caller.connectors.list()).resolves.toEqual({
      gmail: "not_connected",
      googlecalendar: "connected",
    });
  });

  it("tenants cannot see each other's connections", async () => {
    const corsair = new CorsairFake();
    await approve(corsair, "tenant_a", "gmail");

    await expect(makeCaller("tenant_c", db, corsair).connectors.list()).resolves.toEqual({
      gmail: "not_connected",
      googlecalendar: "not_connected",
    });
  });

  it("one tenant's disconnect cannot drop another tenant's connection", async () => {
    const corsair = new CorsairFake();
    await approve(corsair, "tenant_a", "gmail");

    const intruder = makeCaller("tenant_c", db, corsair);
    await expect(intruder.connectors.disconnect({ connector: "gmail" })).resolves.toEqual({
      disconnected: false,
    });
    await expect(makeCaller("tenant_a", db, corsair).connectors.list()).resolves.toEqual({
      gmail: "connected",
      googlecalendar: "not_connected",
    });
  });

  it("rejects an unknown connector", async () => {
    const caller = makeCaller("tenant_a", db, new CorsairFake());
    await expect(caller.connectors.connectUrl({ connector: "slack" as never })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("rejects unauthenticated callers", async () => {
    const caller = makeCaller(null, db, new CorsairFake());
    await expect(caller.connectors.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

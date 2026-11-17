import { RealCorsair } from "@/server/corsair/client";
import { getDb } from "@/server/db";
import { Poller } from "@/server/sync/poller";

// The Poller class existed but was never started, so mail stayed empty until a
// manual Refresh. Register it once on the Node runtime; edge deployments get no
// long-lived interval, so they keep relying on manual Refresh.
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const poller = new Poller(getDb(), [
    { name: "gmail", sync: (tenantId) => new RealCorsair().syncGmail(tenantId) },
    { name: "googlecalendar", sync: (tenantId) => new RealCorsair().syncCalendar(tenantId) },
  ]);

  const intervalMs = Number(process.env.POLL_INTERVAL_MS ?? 300_000);
  const id = setInterval(() => {
    // one failing tenant/provider must not kill the cycle
    poller.pollAll().catch(() => undefined);
  }, intervalMs);

  // keep the interval handle reachable so it isn't garbage-collected
  (globalThis as Record<string, unknown>).__tsunaguPollerInterval = id;
}

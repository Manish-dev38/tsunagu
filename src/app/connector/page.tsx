"use client";

import { useState } from "react";
import type { ConnectorPlugin } from "@/server/adapters/corsair";
import { api } from "@/trpc/provider";

const LABELS: Record<ConnectorPlugin, string> = {
  gmail: "Gmail",
  googlecalendar: "Google Calendar",
};

export default function ConnectorPage() {
  const list = api.connectors.list.useQuery();
  const utils = api.useUtils();
  const [error, setError] = useState<string | null>(null);

  const connect = api.connectors.connectUrl.useMutation({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (e) => setError(e.message),
  });

  const disconnect = api.connectors.disconnect.useMutation({
    onSuccess: () => {
      setError(null);
      void utils.connectors.list.invalidate();
    },
    onError: (e) => setError(e.message),
  });

  if (list.isPending) return <p className="text-sm text-neutral-500">Loading…</p>;

  if (list.error) {
    return (
      <div>
        <h1 className="mb-4 text-xl font-semibold">Connectors</h1>
        <p className="text-sm text-red-600">{list.error.message}</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Connectors</h1>
      <ul>
        {Object.entries(list.data).map(([plugin, state]) => (
          <li key={plugin} className="flex items-center justify-between border-b border-neutral-200 py-3">
            <span className="font-medium">{LABELS[plugin as ConnectorPlugin] ?? plugin}</span>
            <span className="flex items-center gap-4">
              <span className="text-sm text-neutral-500">{state}</span>
              {state === "connected" ? (
                <button
                  className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100"
                  onClick={() => disconnect.mutate({ plugin: plugin as ConnectorPlugin })}
                  disabled={disconnect.isPending}
                >
                  Disconnect
                </button>
              ) : (
                <button
                  className="rounded bg-neutral-900 px-3 py-1 text-sm text-white hover:bg-neutral-700"
                  onClick={() => connect.mutate({ plugin: plugin as ConnectorPlugin })}
                  disabled={connect.isPending}
                >
                  Connect
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </div>
  );
}

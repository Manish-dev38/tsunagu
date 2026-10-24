"use client";

import { useState } from "react";
import { CONNECTORS, type ConnectionStatus, type Connector } from "@/server/adapters/corsair";
import { api } from "@/trpc/provider";

const LABELS: Record<Connector, string> = {
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

  const onToggle = (connector: Connector, isConnected: boolean) => {
    setError(null);
    if (isConnected) disconnect.mutate({ connector });
    else connect.mutate({ connector });
  };

  if (list.isPending) return <p className="text-sm text-neutral-500">Loading…</p>;

  if (list.error) {
    return (
      <div>
        <h1 className="mb-4 text-xl font-semibold">Connectors</h1>
        <p className="text-sm text-red-600">{list.error.message}</p>
      </div>
    );
  }

  const status: ConnectionStatus = list.data;

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Connectors</h1>
      <ul>
        {CONNECTORS.map((connector) => {
          const state = status[connector] ?? "not_connected";
          const isConnected = state === "connected";
          return (
            <li key={connector} className="flex items-center justify-between border-b border-neutral-200 py-3">
              <span className="font-medium">{LABELS[connector]}</span>
              <span className="flex items-center gap-4">
                <span className="text-sm text-neutral-500">{state}</span>
                <button
                  className={
                    isConnected
                      ? "rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100"
                      : "rounded bg-neutral-900 px-3 py-1 text-sm text-white dark:text-neutral-950 hover:bg-neutral-700"
                  }
                  disabled={connect.isPending || disconnect.isPending}
                  onClick={() => onToggle(connector, isConnected)}
                >
                  {isConnected ? "Disconnect" : "Connect"}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </div>
  );
}

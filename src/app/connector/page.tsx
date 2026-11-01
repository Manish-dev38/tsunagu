"use client";

import { useState } from "react";
import { ArrowUpRight, Calendar, Mail, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { api } from "@/trpc/provider";
import {
  CONNECTORS,
  type ConnectionStatus,
  type Connector,
} from "@/server/adapters/corsair";

const LABELS: Record<Connector, string> = {
  gmail: "Gmail",
  googlecalendar: "Google Calendar",
};

const ICONS: Record<Connector, React.ReactNode> = {
  gmail: <Mail />,
  googlecalendar: <Calendar />,
};

export default function ConnectorPage() {
  const toast = useToast();
  const list = api.connectors.list.useQuery();
  const utils = api.useUtils();
  const [deletingConnector, setDeletingConnector] = useState<Connector | null>(null);

  const connect = api.connectors.connectUrl.useMutation({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (e) => toast(e.message, { tone: "danger" }),
  });

  const disconnect = api.connectors.disconnect.useMutation({
    onSuccess: () => {
      toast("Connector disconnected");
      setDeletingConnector(null);
      void utils.connectors.list.invalidate();
      void utils.inbox.list.invalidate();
      void utils.calendar.routine.invalidate();
      void utils.action.list.invalidate();
    },
    onError: (e) => toast(e.message, { tone: "danger" }),
  });

  const onToggle = (connector: Connector, isConnected: boolean) => {
    if (isConnected) setDeletingConnector(connector);
    else connect.mutate({ connector });
  };

  return (
    <div>
      <h1 className="page-title">Connectors</h1>
      <p className="page-lead">
        Tsunagu only sees the accounts you connect. You can disconnect either one at any time.
      </p>

      {list.isPending && <p className="small muted">Loading…</p>}

      {list.data &&
        Object.entries(list.data).map(([key, state]) => {
          const connector = key as Connector;
          const isConnected = state === "connected";
          const label = LABELS[connector] ?? connector;
          const description =
            connector === "gmail"
              ? "Syncs the 10 newest messages, reads and drafts mail with approval."
              : "Reads your routine and creates events only after you approve them.";

          return (
            <article key={connector} className="card-chai connector-row">
              <div className="flex items-center gap-3.5">
                <span className="connector-icon">{ICONS[connector]}</span>
                <div>
                  <div className="row" style={{ gap: 9 }}>
                    <strong style={{ fontSize: 14 }}>{label}</strong>
                    {isConnected && (
                      <span className="live-dot" aria-hidden="true" />
                    )}
                    <span
                      className={`status-text ${isConnected ? "status-executed" : "status-discarded"
}`}
                    >
                      {!isConnected && <span className="dot" aria-hidden="true" />}
                      {isConnected ? "Connected" : "Not connected"}
                    </span>
                  </div>
                  <p className="tiny muted" style={{ marginTop: 3 }}>
                    {description}
                  </p>
                </div>
              </div>
              <Button
                variant={isConnected ? "outline" : "solid"}
                size="sm"
                className={
                  isConnected
                    ? ""
                    : "gap-1.5 [&_svg:not([class*=size-])]:size-4"
                }
                disabled={connect.isPending || disconnect.isPending}
                onClick={() => onToggle(connector, isConnected)}
              >
                {isConnected ? "Disconnect" : "Connect"}
                {!isConnected && <ArrowUpRight />}
              </Button>
            </article>
          );
        })}

      <ConfirmDialog
        open={deletingConnector !== null}
        title="Disconnect this connector?"
        confirmLabel="Disconnect"
        busyLabel="Disconnecting"
        tone="danger"
        busy={disconnect.isPending}
        onConfirm={() => {
          if (deletingConnector) disconnect.mutate({ connector: deletingConnector });
        }}
        onCancel={() => setDeletingConnector(null)}
      >
        This will remove access to the account. You can reconnect at any time.
      </ConfirmDialog>
    </div>
  );
}

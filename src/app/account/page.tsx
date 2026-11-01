"use client";

import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconButton } from "@/components/ui/icon-button";
import { useToast } from "@/components/ui/toast";
import { api } from "@/trpc/provider";

export default function AccountPage() {
  const toast = useToast();
  const me = api.me.useQuery();
  const utils = api.useUtils();
  const [deleting, setDeleting] = useState(false);
  const deleteData = api.account.deleteData.useMutation({
    onSuccess: () => {
      toast("Memory and Chat sessions deleted");
      setDeleting(false);
      void utils.memory.list.invalidate();
      void utils.chat.sessions.invalidate();
    },
    onError: (e) => toast(e.message, { tone: "danger" }),
  });

  // errors surface as toasts (Q3=A); old inline error paragraphs removed
  useEffect(() => {
    if (me.error) toast(me.error.message, { tone: "danger" });
  }, [me.error, toast]);

  if (me.isPending) return <p className="small muted">Loading…</p>;

  return (
    <div>
      <h1 className="page-title">Account</h1>
      <p className="page-lead">Your profile and stored data.</p>

      <article className="card-chai account-card">
        <div className="row" style={{ gap: 16 }}>
          <span
            className="avatar"
            style={{ width: 56, height: 56, fontSize: 18 }}
            aria-hidden="true"
          >
            {me.data?.name?.charAt(0) ?? "U"}
          </span>
          <div className="grow">
            <p style={{ fontWeight: 700, fontSize: 15 }}>
              {me.data?.name ?? "Unnamed"}
            </p>
            <p className="small muted">{me.data?.email}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 [&_svg:not([class*=size-])]:size-4"
            onClick={() => void signOut()}
          >
            Sign out
          </Button>
        </div>
      </article>

      <article className="card-chai danger-card">
        <h3>Delete my data</h3>
        <p className="small muted">
          Removes every fact in Memory and all Chat sessions. Gmail and Calendar connections stay
          connected until you disconnect them on the Connectors screen. This cannot be undone.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 [&_svg:not([class*=size-])]:size-4 border-red-500/45 text-red-600"
          onClick={() => setDeleting(true)}
        >
          Delete my data
        </Button>
      </article>

      <ConfirmDialog
        open={deleting}
        title="Delete your data?"
        confirmLabel="Delete everything"
        busyLabel="Deleting"
        tone="danger"
        typeToConfirm={me.data?.name ?? ""}
        busy={deleteData.isPending}
        onConfirm={() => deleteData.mutate()}
        onCancel={() => setDeleting(false)}
      >
        {me.data?.name ? `Type "${me.data.name}" to confirm.` : "Type your name to confirm."}
      </ConfirmDialog>
    </div>
  );
}

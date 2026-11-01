"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconButton } from "@/components/ui/icon-button";
import { inputClass } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { api } from "@/trpc/provider";

export default function MemoryPage() {
  const utils = api.useUtils();
  const toast = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const list = api.memory.list.useQuery(undefined, { staleTime: 0 });

  // read failures surface as toasts too (Q3=A), once per new error
  useEffect(() => {
    if (list.error) toast(list.error.message, { tone: "danger" });
  }, [list.error, toast]);

  const update = api.memory.update.useMutation({
    onSuccess: () => {
      setEditingId(null);
      toast("Memory saved");
      void utils.memory.list.invalidate();
    },
    onError: (e) => toast(e.message, { tone: "danger" }),
  });

  const remove = api.memory.delete.useMutation({
    onSuccess: () => {
      setDeletingId(null);
      toast("Memory deleted");
      void utils.memory.list.invalidate();
    },
    onError: (e) => toast(e.message, { tone: "danger" }),
  });

  const deleting = list.data?.find((item) => item.id === deletingId);

  return (
    <div>
      <h1 className="page-title">Memory</h1>
      <p className="page-lead">
        Facts the assistant knows about you. Say{" "}
        <span className="font-mono text-[12.5px]">&quot;remember ...&quot;</span> in Chat to add one.
        Extracted facts are pulled from your mail and need no manual entry.
      </p>

      {list.isPending && <p className="small muted">Loading…</p>}
      {list.data?.length === 0 && <p className="small muted">No memories yet.</p>}

      <div className="memory-grid">
        {list.data?.map((item) => (
          <article key={item.id} className="card-chai p-4 stack memory-card">
            <span className={item.source === "manual" ? "chip" : "chip chip-special"}>
              {item.source !== "manual" && <span className="dot" aria-hidden="true" />}
              {item.source === "manual" ? "Manual" : "Extracted"}
            </span>

            {editingId === item.id ? (
              <>
                <textarea
                  className={inputClass + " textarea"}
                  rows={3}
                  aria-label="Memory content"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  autoFocus
                />
                <div className="row">
                  <Button
                    variant="soft"
                    size="sm"
                    className="h-[26px] px-[10px] text-[12px]"
                    disabled={!draft.trim() || update.isPending}
                    onClick={() => update.mutate({ id: item.id, content: draft })}
                  >
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-[26px] px-[10px] text-[12px]"
                    disabled={update.isPending}
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-[13.5px] [overflow-wrap:anywhere]">{item.content}</p>
                <div className="memory-actions">
                  <IconButton
                    variant="ghost"
                    className="size-[26px] text-muted-foreground"
                    aria-label={`Edit memory: ${item.content}`}
                    title="Edit memory"
                    onClick={() => {
                      setEditingId(item.id);
                      setDraft(item.content);
                    }}
                  >
                    <Pencil />
                  </IconButton>
                  <IconButton
                    variant="ghost"
                    className="size-[26px] text-muted-foreground"
                    aria-label={`Delete memory: ${item.content}`}
                    title="Delete memory"
                    onClick={() => setDeletingId(item.id)}
                  >
                    <Trash2 />
                  </IconButton>
                </div>
              </>
            )}
          </article>
        ))}
      </div>

      <ConfirmDialog
        open={deletingId !== null}
        title="Delete this memory?"
        confirmLabel="Delete memory"
        busyLabel="Deleting"
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => {
          if (deletingId) remove.mutate({ id: deletingId });
        }}
        onCancel={() => setDeletingId(null)}
      >
        {deleting?.content ?? "This fact will be removed for good."}
      </ConfirmDialog>
    </div>
  );
}

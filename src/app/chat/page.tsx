"use client";

import { skipToken } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api } from "@/trpc/provider";
import { ProposalCard } from "./proposal-card";

type AskInput = { sessionId: string | null; content: string };
type AskEvent =
  | { type: "session"; sessionId: string }
  | { type: "delta"; text: string }
  | { type: "done"; reply: string };

function AskRunner({
  input,
  onEvent,
  onError,
}: {
  input: AskInput;
  onEvent: (event: AskEvent) => void;
  onError: (error: { message: string }) => void;
}) {
  api.chat.ask.useSubscription(input, { onData: onEvent, onError });
  return null;
}

export default function ChatPage() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [askInput, setAskInput] = useState<AskInput | null>(null);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");

  const utils = api.useUtils();
  const me = api.me.useQuery();
  const sessions = api.chat.sessions.useQuery();
  const messages = api.chat.messages.useQuery(
    activeId ? { sessionId: activeId } : skipToken,
  );
  const proposals = api.chat.proposals.useQuery();

  const approve = api.chat.approve.useMutation({
    onSuccess: (result) => {
      setError(null);
      void utils.chat.proposals.invalidate();
      // refresh the view the write actually feeds
      if (result.kind.startsWith("calendar.")) {
        void utils.calendar.routine.invalidate();
        void utils.calendar.events.invalidate();
      } else {
        void utils.inbox.list.invalidate();
      }
    },
    onError: (e) => setError(e.message),
  });
  const editProposal = api.chat.editProposal.useMutation({
    onSuccess: () => {
      setError(null);
      void utils.chat.proposals.invalidate();
    },
    onError: (e) => setError(e.message),
  });
  const discardProposal = api.chat.discardProposal.useMutation({
    onSuccess: () => {
      setError(null);
      void utils.chat.proposals.invalidate();
    },
    onError: (e) => setError(e.message),
  });

  const finishTurn = () => {
    setAskInput(null);
    setPendingUser(null);
    setStreamText("");
    void utils.chat.messages.invalidate();
    void utils.chat.sessions.invalidate();
    // the turn may have just created a draft proposal
    void utils.chat.proposals.invalidate();
  };

  const send = (event: FormEvent) => {
    event.preventDefault();
    const content = input.trim();
    if (!content || askInput) return;
    setError(null);
    setPendingUser(content);
    setStreamText("");
    setAskInput({ sessionId: activeId, content });
    setInput("");
  };

  const resetView = (sessionId: string | null) => {
    // a running turn keeps streaming; ignore navigation until it settles
    if (askInput) return;
    setActiveId(sessionId);
    setStreamText("");
    setPendingUser(null);
    setError(null);
  };

  const rows = messages.data ?? [];
  // optimistic user bubble hides as soon as the persisted row arrives
  const showPending =
    pendingUser !== null && !rows.some((row) => row.role === "user" && row.content === pendingUser);

  return (
    <div className="flex gap-6">
      <div className="w-56 shrink-0">
        <button
          onClick={() => resetView(null)}
          className="mb-3 w-full rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
        >
          New chat
        </button>
        <ul className="space-y-1 text-sm">
          {sessions.data?.map((session) => (
            <li key={session.id}>
              <button
                onClick={() => resetView(session.id)}
                className={`block w-full truncate rounded px-2 py-1 text-left hover:bg-neutral-100 ${
                  activeId === session.id ? "bg-neutral-100 font-medium" : ""
                }`}
                title={session.title}
              >
                {session.title}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="mb-3 text-xl font-semibold">Chat</h1>
        <div className="min-h-64 flex-1 space-y-4 overflow-y-auto rounded border border-neutral-200 p-4">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!error && rows.length === 0 && !pendingUser && !askInput && (
            <div>
              <p className="text-lg font-medium">
                Hello {me.data?.name?.split(" ")[0] ?? "there"}
              </p>
              <p className="text-sm text-neutral-400">Ask anything about your inbox.</p>
            </div>
          )}
          {rows.map((message) => (
            <div key={message.id}>
              <div className="text-xs font-medium uppercase text-neutral-400">
                {message.role === "user" ? "You" : "Tsunagu"}
              </div>
              <p className="whitespace-pre-wrap text-sm text-neutral-800">{message.content}</p>
            </div>
          ))}
          {showPending && (
            <div>
              <div className="text-xs font-medium uppercase text-neutral-400">You</div>
              <p className="whitespace-pre-wrap text-sm text-neutral-800">{pendingUser}</p>
            </div>
          )}
          {askInput && (
            <div>
              <div className="text-xs font-medium uppercase text-neutral-400">Tsunagu</div>
              <p className="whitespace-pre-wrap text-sm text-neutral-800">
                {streamText || "Thinking…"}
              </p>
            </div>
          )}
        </div>
        {proposals.data && proposals.data.length > 0 && (
          <div className="mt-4 space-y-3">
            <h2 className="text-sm font-semibold text-neutral-500">Awaiting your approval</h2>
            {proposals.data.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                onApprove={() => approve.mutate({ id: proposal.id })}
                onEdit={(draft) => editProposal.mutate({ id: proposal.id, ...draft })}
                onDiscard={() => discardProposal.mutate({ id: proposal.id })}
                busy={
                  approve.isPending || editProposal.isPending || discardProposal.isPending
                }
              />
            ))}
          </div>
        )}
        <form onSubmit={send} className="mt-3 flex gap-2">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask anything about your inbox…"
            disabled={askInput !== null}
            className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
          <button
            type="submit"
            disabled={askInput !== null || !input.trim()}
            className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </div>

      {askInput && (
        <AskRunner
          input={askInput}
          onEvent={(event) => {
            if (event.type === "session") setActiveId(event.sessionId);
            else if (event.type === "delta") setStreamText((text) => text + event.text);
            else finishTurn();
          }}
          onError={(eventError) => {
            setError(eventError.message);
            finishTurn();
          }}
        />
      )}
    </div>
  );
}

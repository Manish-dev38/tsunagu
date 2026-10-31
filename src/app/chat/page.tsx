"use client";

import { skipToken } from "@tanstack/react-query";
import { PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Send, Zap } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/provider";
import { ProposalCard } from "./proposal-card";

const COLLAPSED_KEY = "tsunagu-chat-list-collapsed";
const SUGGESTIONS = ["Summarise unread mail", "What is on my Friday?", "Find the Zoho invoice"];

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

function initials(value: string | null | undefined): string {
  const parts = (value ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "You";
  return parts.map((word) => word[0]).join("").slice(0, 2).toUpperCase();
}

function MessageRow({
  role,
  name,
  content,
}: {
  role: "user" | "assistant";
  name?: string | null;
  content: string;
}) {
  const isUser = role === "user";
  // the agent's replies read as paragraphs; a blank line separates them
  const paragraphs = content.split(/\n{2,}/);
  return (
    <div className={cn("msg", isUser ? "user" : "agent")}>
      <Avatar className="size-[30px]">
        {isUser ? (
          <AvatarFallback>{initials(name)}</AvatarFallback>
        ) : (
          <AvatarFallback className="text-highlight">
            <Zap className="size-4" />
          </AvatarFallback>
        )}
      </Avatar>
      <div className="msg-body">
        <div className="msg-who">{isUser ? "You" : "Tsunagu"}</div>
        <div className="msg-bubble">
          {paragraphs.map((paragraph, index) => (
            <p key={index} className="msg-text">
              {paragraph}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [askInput, setAskInput] = useState<AskInput | null>(null);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");
  const [collapsed, setCollapsedState] = useState(false);
  const toast = useToast();

  // The INIT script already applied the stored collapse state before first
  // paint; mirror it into React for aria and the toggle handlers.
  useEffect(() => {
    const sync = () => {
      setCollapsedState(document.documentElement.classList.contains("chat-list-collapsed"));
    };
    sync();
  }, []);

  const setCollapsed = (next: boolean) => {
    document.documentElement.classList.toggle("chat-list-collapsed", next);
    try {
      localStorage.setItem(COLLAPSED_KEY, String(next));
    } catch {}
    setCollapsedState(next);
  };

  const utils = api.useUtils();
  const me = api.me.useQuery();
  const sessions = api.chat.sessions.useQuery();
  const messages = api.chat.messages.useQuery(
    activeId ? { sessionId: activeId } : skipToken,
  );
  const proposals = api.chat.proposals.useQuery();

  const approve = api.chat.approve.useMutation({
    // a failed external write still moves the row out of pending (status
    // failed), so refresh on settle, not only on success
    onSettled: () => {
      void utils.chat.proposals.invalidate();
      // 5-min staleTime would otherwise hide the new action row on /action
      void utils.action.list.invalidate();
    },
    onSuccess: (result) => {
      // refresh the view the write actually feeds
      if (result.kind.startsWith("calendar.")) {
        void utils.calendar.routine.invalidate();
        void utils.calendar.events.invalidate();
        toast("Event approved, calendar write queued");
      } else {
        void utils.inbox.list.invalidate();
        toast("Email approved and sent");
      }
    },
    onError: (e) => toast(e.message, { tone: "danger" }),
  });
  const editProposal = api.chat.editProposal.useMutation({
    onSuccess: () => {
      void utils.chat.proposals.invalidate();
    },
    onError: (e) => toast(e.message, { tone: "danger" }),
  });
  const discardProposal = api.chat.discardProposal.useMutation({
    onSuccess: () => {
      void utils.chat.proposals.invalidate();
      toast("Proposal discarded");
    },
    onError: (e) => toast(e.message, { tone: "danger" }),
  });
  const refreshMail = api.inbox.refresh.useMutation({
    onSuccess: () => void utils.inbox.list.invalidate(),
    onError: (e) => toast(e.message, { tone: "danger" }),
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

  const send = (raw: string) => {
    const content = raw.trim();
    if (!content || askInput) return;
    setPendingUser(content);
    setStreamText("");
    setAskInput({ sessionId: activeId, content });
    setInput("");
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send(input);
  };

  const resetView = (sessionId: string | null) => {
    // a running turn keeps streaming; ignore navigation until it settles
    if (askInput) return;
    setActiveId(sessionId);
    setStreamText("");
    setPendingUser(null);
  };

  const rows = messages.data ?? [];
  const pendingProposals = proposals.data ?? [];
  // optimistic user bubble hides as soon as the persisted row arrives
  const showPending =
    pendingUser !== null && !rows.some((row) => row.role === "user" && row.content === pendingUser);
  // per the prototype, the greeting owns the view until a session has messages;
  // pending proposals live inside the thread and hide with it (New chat)
  const showEmpty = rows.length === 0 && !pendingUser && !askInput;

  return (
    <div className="chat-layout">
      <div className="chat-sessions">
        <div className="chat-sessions-head">
          <Button variant="outline" size="sm" className="grow" onClick={() => resetView(null)}>
            <Plus /> New chat
          </Button>
          <IconButton
            variant="chrome"
            className="sessions-toggle"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand chat list" : "Collapse chat list"}
            title={collapsed ? "Expand chat list" : "Collapse chat list"}
            onClick={() => setCollapsed(!collapsed)}
          >
            <PanelLeftClose className="ic-close" />
            <PanelLeftOpen className="ic-open" />
          </IconButton>
        </div>
        <ul className="stack" style={{ gap: 2 }}>
          {sessions.data?.map((session) => (
            <li key={session.id}>
              <button
                type="button"
                className={cn("session-item", activeId === session.id && "is-active")}
                onClick={() => resetView(session.id)}
                title={session.title}
              >
                {session.title}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="chat-main">
        <div className="spread" style={{ marginBottom: 14 }}>
          <div className="row">
            {collapsed && (
              <IconButton
                variant="chrome"
                className="chat-restore"
                aria-label="Show chat list"
                title="Show chat list"
                onClick={() => setCollapsed(false)}
              >
                <PanelLeftOpen />
              </IconButton>
            )}
            <h1 className="page-title">Chat</h1>
          </div>
          <IconButton
            variant="chrome"
            aria-label="Sync Gmail"
            disabled={refreshMail.isPending}
            onClick={() => {
              toast("Gmail sync started");
              refreshMail.mutate();
            }}
          >
            <RefreshCw />
          </IconButton>
        </div>

        <div className="card-chai chat-scroll">
          {showEmpty && (
            <div className="chat-empty">
              {/* the name arrives with the client query, so SSR says "there" */}
              <h2 suppressHydrationWarning>
                Hello {me.data?.name?.split(" ")[0] ?? "there"}
              </h2>
              <p>
                Ask about mail, calendar or the facts in memory. Writes wait for{" "}
                <span className="highlight">your approval, every time</span>.
              </p>
              <div className="suggestion-row">
                {SUGGESTIONS.map((text) => (
                  <button key={text} type="button" className="chip" onClick={() => send(text)}>
                    {text}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!showEmpty && (
            <div>
              {rows.map((message) => (
                <MessageRow
                  key={message.id}
                  role={message.role === "user" ? "user" : "assistant"}
                  name={me.data?.name}
                  content={message.content}
                />
              ))}
              {showPending && (
                <MessageRow role="user" name={me.data?.name} content={pendingUser} />
              )}
              {askInput && <MessageRow role="assistant" content={streamText || "Thinking…"} />}
              {pendingProposals.length > 0 && (
                <div>
                  <h2 className="section-title" style={{ margin: "6px 0 10px" }}>
                    Awaiting your approval
                  </h2>
                  <div className="stack">
                    {pendingProposals.map((proposal) => (
                      <ProposalCard
                        key={proposal.id}
                        proposal={proposal}
                        onApprove={() => approve.mutate({ id: proposal.id })}
                        onApproveEdit={(patch) =>
                          editProposal.mutate(
                            { id: proposal.id, ...patch },
                            { onSuccess: () => approve.mutate({ id: proposal.id }) },
                          )
                        }
                        onDiscard={() => discardProposal.mutate({ id: proposal.id })}
                        busy={
                          approve.isPending || editProposal.isPending || discardProposal.isPending
                        }
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <form onSubmit={onSubmit} className="chat-composer">
          <div className="composer">
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask anything about your inbox..."
              aria-label="Message Tsunagu"
              disabled={askInput !== null}
              className="h-[42px]"
            />
            <Button
              type="submit"
              variant="solid"
              iconRight={null}
              disabled={askInput !== null}
              aria-label="Send message"
            >
              <Send /> Send
            </Button>
          </div>
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
            toast(eventError.message, { tone: "danger" });
            finishTurn();
          }}
        />
      )}
    </div>
  );
}

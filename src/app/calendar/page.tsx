"use client";

import { Check, ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { api } from "@/trpc/provider";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Mode = "month" | "week";

function atMidnight(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function startOfWeek(d: Date): Date {
  const x = atMidnight(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function eventDayKey(event: { start: { dateTime?: string; date?: string } }): string {
  if (event.start.dateTime) return dayKey(new Date(event.start.dateTime));
  return event.start.date ?? "";
}

function eventStartMs(event: { start: { dateTime?: string; date?: string } }): number {
  // date-only events lead the day (their UTC-midnight parse is not local)
  if (!event.start.dateTime) return 0;
  return Date.parse(event.start.dateTime) || 0;
}

// the prototype's 24h chip time; all-day events say so instead
function eventTime(event: { start: { dateTime?: string; date?: string } }): string {
  if (!event.start.dateTime) return "All day";
  return new Date(event.start.dateTime).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

type EventRow = {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  htmlLink: string;
};

export default function CalendarPage() {
  const utils = api.useUtils();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("month");
  // "now" is read only after mount: Next.js prerenders this client page and
  // rejects new Date() during prerender
  const [anchor, setAnchor] = useState<Date | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [time, setTime] = useState("10:00");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot clock init on mount; reading the clock during render would hydration-mismatch the prerendered grid
    setAnchor(new Date());
  }, []);

  const base = anchor ?? new Date(0);
  const first =
    mode === "week"
      ? startOfWeek(base)
      : startOfWeek(new Date(base.getFullYear(), base.getMonth(), 1));
  const days = Array.from({ length: mode === "week" ? 7 : 42 }, (_, i) => addDays(first, i));
  const timeMin = first.toISOString();
  const timeMax = addDays(days[days.length - 1]!, 1).toISOString();

  const eventsQuery = api.calendar.events.useQuery(
    { timeMin, timeMax },
    { enabled: anchor !== null },
  );
  const events = eventsQuery.data;

  // read failures surface as toasts too (Q3=A), once per new error
  useEffect(() => {
    if (eventsQuery.error) toast(eventsQuery.error.message, { tone: "danger" });
  }, [eventsQuery.error, toast]);

  const invalidate = () => {
    void utils.calendar.events.invalidate();
    void utils.calendar.routine.invalidate();
    // the write also lands in the action log
    void utils.action.list.invalidate();
  };
  const refresh = api.calendar.refresh.useMutation({
    onSuccess: () => {
      invalidate();
      toast("Calendar synced");
    },
    onError: (e) => toast(e.message, { tone: "danger" }),
  });
  const createEvent = api.calendar.createEvent.useMutation({
    onSuccess: () => {
      invalidate();
      setCreating(null);
      setSummary("");
      toast("Event saved to Google Calendar");
    },
    onError: (e) => toast(e.message, { tone: "danger" }),
  });

  const byDay = new Map<string, EventRow[]>();
  for (const event of events ?? []) {
    const key = eventDayKey(event);
    const list = byDay.get(key) ?? [];
    list.push(event);
    byDay.set(key, list);
  }
  for (const list of byDay.values()) list.sort((a, b) => eventStartMs(a) - eventStartMs(b));

  const step = (dir: 1 | -1) => {
    setAnchor((current) => {
      if (!current) return current;
      return mode === "month"
        ? new Date(current.getFullYear(), current.getMonth() + dir, 1)
        : addDays(current, dir * 7);
    });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!creating || !summary.trim() || !time) return;
    const start = new Date(`${creating}T${time}`);
    createEvent.mutate({ summary: summary.trim(), start: start.toISOString() });
  };

  // after every hook, before any render-time "now" read (prerender guard)
  if (!anchor) return <p className="small muted">Loading…</p>;

  const todayKey = dayKey(new Date());
  const monthLabel = anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  // the week view is ours (the prototype only toasts), so name its actual span
  const title =
    mode === "week"
      ? `${days[0]!.toLocaleDateString(undefined, { month: "short", day: "numeric" })} to ${days[6]!.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
      : monthLabel;
  const createTitle = creating
    ? `New event on ${new Date(`${creating}T12:00`).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      })}`
    : "New event";

  return (
    <div>
      <div className="spread" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        <div className="row">
          <IconButton variant="chrome" aria-label="Previous" title="Previous" onClick={() => step(-1)}>
            <ChevronLeft />
          </IconButton>
          <h1 className="page-title" style={{ minWidth: 170, textAlign: "center" }}>
            {title}
          </h1>
          <IconButton variant="chrome" aria-label="Next" title="Next" onClick={() => step(1)}>
            <ChevronRight />
          </IconButton>
          <Button variant="outline" size="sm" onClick={() => setAnchor(new Date())}>
            Today
          </Button>
        </div>
        <div className="row">
          <Segmented
            className="flex-none"
            label="Calendar mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "month", label: "Month" },
              { value: "week", label: "Week" },
            ]}
          />
          <IconButton
            variant="chrome"
            aria-label="Refresh calendar"
            title="Refresh calendar"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            <RefreshCw />
          </IconButton>
        </div>
      </div>

      {creating && (
        <form className="card-chai event-create" onSubmit={submit}>
          <h2 className="section-title" style={{ marginBottom: 12 }}>
            {createTitle}
          </h2>
          <div className="row-wrap">
            <Input
              style={{ flex: 2, minWidth: 180 }}
              placeholder="Event title"
              aria-label="Event title"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              autoFocus
            />
            <Input
              style={{ flex: 1, minWidth: 140 }}
              type="time"
              aria-label="Time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
            <Button
              type="submit"
              variant="soft"
              size="sm"
              iconRight={null}
              disabled={createEvent.isPending || !summary.trim() || !time}
            >
              <Check /> Add event
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={createEvent.isPending}
              onClick={() => setCreating(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      <div className="cal-scroll">
        <div className="cal-grid">
          {WEEKDAYS.map((label) => (
            <div key={label} className="cal-dow">
              {label}
            </div>
          ))}
          {days.map((day) => {
            const key = dayKey(day);
            const other = mode === "month" && day.getMonth() !== anchor.getMonth();
            const dayEvents = byDay.get(key) ?? [];
            return (
              <button
                key={key}
                type="button"
                aria-current={key === todayKey ? "date" : undefined}
                className={`cal-cell ${other ? "other" : ""} ${key === todayKey ? "today" : ""}`}
                onClick={() => {
                  setCreating(key);
                  setSummary("");
                  setTime("10:00");
                }}
              >
                <span className="cal-date">{day.getDate()}</span>
                <span className="cal-add" aria-hidden="true">
                  <Plus />
                </span>
                {dayEvents.map((event) => (
                  <span
                    key={event.id}
                    className={`cal-event ${event.start.dateTime ? "" : "all-day"}`}
                    title={event.summary}
                  >
                    <span className="t">{eventTime(event)}</span>
                    <span className="e">{event.summary}</span>
                  </span>
                ))}
              </button>
            );
          })}
        </div>
      </div>
      <p className="tiny muted" style={{ marginTop: 12 }}>
        Click any day to add an event. Writes go straight to Google Calendar after approval.
      </p>
    </div>
  );
}

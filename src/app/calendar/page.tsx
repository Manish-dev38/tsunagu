"use client";

import { useEffect, useState } from "react";
import { api } from "@/trpc/provider";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

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
  return Date.parse(event.start.dateTime ?? event.start.date ?? "") || 0;
}

type EventRow = {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  htmlLink: string;
};

export default function CalendarPage() {
  const utils = api.useUtils();
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
  const first = mode === "week"
    ? startOfWeek(base)
    : startOfWeek(new Date(base.getFullYear(), base.getMonth(), 1));
  const days = Array.from({ length: mode === "week" ? 7 : 42 }, (_, i) => addDays(first, i));
  const timeMin = first.toISOString();
  const timeMax = addDays(days[days.length - 1]!, 1).toISOString();

  const { data: events } = api.calendar.events.useQuery(
    { timeMin, timeMax },
    { enabled: anchor !== null },
  );

  const invalidate = () => {
    void utils.calendar.events.invalidate();
    void utils.calendar.routine.invalidate();
  };
  const refresh = api.calendar.refresh.useMutation({ onSuccess: invalidate });
  const createEvent = api.calendar.createEvent.useMutation({
    onSuccess: () => {
      invalidate();
      setCreating(null);
      setSummary("");
    },
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
    if (!creating || !summary.trim()) return;
    const start = new Date(`${creating}T${time}`);
    createEvent.mutate({ summary: summary.trim(), start: start.toISOString() });
  };

  // after every hook, before any render-time "now" read (prerender guard)
  if (!anchor) return <p className="text-sm text-neutral-400">Loading…</p>;

  const todayKey = dayKey(new Date());
  const monthLabel = anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button
            className="rounded border border-neutral-200 px-2 py-1 text-sm hover:bg-neutral-100"
            onClick={() => step(-1)}
            aria-label="Previous"
          >
            ‹
          </button>
          <span className="min-w-40 text-center text-sm font-semibold">{monthLabel}</span>
          <button
            className="rounded border border-neutral-200 px-2 py-1 text-sm hover:bg-neutral-100"
            onClick={() => step(1)}
            aria-label="Next"
          >
            ›
          </button>
        </div>
        <button
          className="rounded border border-neutral-200 px-2 py-1 text-sm hover:bg-neutral-100"
          onClick={() => setAnchor(new Date())}
        >
          Today
        </button>
        <div className="flex overflow-hidden rounded border border-neutral-200 text-sm">
          {(["month", "week"] as const).map((m) => (
            <button
              key={m}
              className={`px-3 py-1 capitalize ${mode === m ? "bg-neutral-900 text-white dark:text-neutral-950" : "hover:bg-neutral-100"}`}
              onClick={() => setMode(m)}
            >
              {m}
            </button>
          ))}
        </div>
        <button
          className="ml-auto rounded border border-neutral-200 px-2 py-1 text-sm hover:bg-neutral-100 disabled:opacity-50"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
        >
          {refresh.isPending ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {creating && (
        <form className="mb-4 flex flex-wrap items-center gap-2 rounded border border-neutral-300 p-3" onSubmit={submit}>
          <span className="text-sm text-neutral-600">
            {new Date(`${creating}T12:00`).toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </span>
          <input
            className="w-56 rounded border border-neutral-300 px-2 py-1 text-sm"
            placeholder="Event title"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            autoFocus
          />
          <input
            className="rounded border border-neutral-300 px-2 py-1 text-sm"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
          <button
            type="submit"
            className="rounded bg-neutral-900 px-3 py-1 text-sm text-white dark:text-neutral-950 disabled:opacity-50"
            disabled={createEvent.isPending || !summary.trim()}
          >
            Add
          </button>
          <button
            type="button"
            className="rounded border border-neutral-200 px-3 py-1 text-sm hover:bg-neutral-100"
            onClick={() => setCreating(null)}
          >
            Cancel
          </button>
          {createEvent.isError && (
            <span className="text-xs text-red-600">{createEvent.error?.message ?? "Couldn’t create the event."}</span>
          )}
        </form>
      )}

      <div className="grid grid-cols-7 border-l border-t border-neutral-200">
        {WEEKDAYS.map((label) => (
          <div key={label} className="border-r border-b border-neutral-200 bg-neutral-50 px-2 py-1 text-xs font-medium text-neutral-500">
            {label}
          </div>
        ))}
        {days.map((day) => {
          const key = dayKey(day);
          const inMonth = day.getMonth() === anchor.getMonth();
          const dayEvents = byDay.get(key) ?? [];
          return (
            <button
              key={key}
              type="button"
              className="group min-h-28 border-r border-b border-neutral-200 p-1.5 text-left align-top hover:bg-neutral-50"
              onClick={() => {
                setCreating(key);
                setSummary("");
                setTime("10:00");
              }}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs ${
                    key === todayKey
                      ? "rounded-full bg-neutral-900 px-1.5 py-0.5 font-semibold text-white dark:text-neutral-950"
                      : inMonth
                        ? "font-medium text-neutral-700"
                        : "text-neutral-300"
                  }`}
                >
                  {day.getDate()}
                </span>
                <span className="text-neutral-300 opacity-0 group-hover:opacity-100">＋</span>
              </div>
              {dayEvents.map((event) => (
                <div key={event.id} className="mt-1 truncate rounded bg-neutral-100 px-1 py-0.5 text-xs text-neutral-700">
                  {event.start.dateTime &&
                    `${new Date(event.start.dateTime).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} `}
                  {event.summary}
                </div>
              ))}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-neutral-400">Click a day to add an event — it goes straight to Google Calendar.</p>
    </div>
  );
}

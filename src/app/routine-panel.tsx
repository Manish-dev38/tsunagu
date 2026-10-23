"use client";

import { Fragment } from "react";
import { api } from "@/trpc/provider";

function startOf(event: { start: { dateTime?: string; date?: string } }) {
  if (event.start.dateTime) return new Date(event.start.dateTime);
  // date-only values are calendar days: parse as local, not UTC (new Date("YYYY-MM-DD") gotcha)
  const [y, m, d] = (event.start.date ?? "").split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

function whenLabel(event: { start: { dateTime?: string; date?: string } }) {
  if (event.start.dateTime) {
    const d = new Date(event.start.dateTime);
    // the day lives in the group header now, so the row only shows the clock
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return "all day";
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayKey(event: { start: { dateTime?: string; date?: string } }) {
  const d = startOf(event);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayHeader(event: { start: { dateTime?: string; date?: string } }) {
  const d = startOf(event);
  const today = new Date();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1))) return "Tomorrow";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

export function RoutinePanel() {
  const { data, isPending, isError } = api.calendar.routine.useQuery(undefined);

  if (isPending) return <p className="text-sm text-neutral-400">Loading…</p>;
  if (isError) return <p className="text-sm text-neutral-400">Couldn’t load schedule.</p>;
  if (data.length === 0) return <p className="text-sm text-neutral-400">Nothing scheduled yet.</p>;

  return (
    <ul className="space-y-4">
      {data.map((event, index) => {
        const firstOfDay = index === 0 || dayKey(data[index - 1]) !== dayKey(event);
        return (
          <Fragment key={event.id}>
            {firstOfDay && (
              <li className="border-t border-neutral-200 pt-3 text-xs font-semibold text-neutral-500">
                {dayHeader(event)}
              </li>
            )}
            <li>
              <div className="text-xs text-neutral-500">{whenLabel(event)}</div>
              <div className="text-sm font-medium text-neutral-800">{event.summary}</div>
              <div className="mt-0.5 flex gap-3 text-xs">
                {event.joinLink && (
                  <a
                    className="text-blue-600 underline underline-offset-2 hover:text-blue-800"
                    href={event.joinLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Join
                  </a>
                )}
                {event.htmlLink && (
                  <a
                    className="text-neutral-500 underline underline-offset-2 hover:text-neutral-700"
                    href={event.htmlLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in Google
                  </a>
                )}
              </div>
            </li>
          </Fragment>
        );
      })}
    </ul>
  );
}

"use client";

import { Fragment } from "react";
import { Video } from "lucide-react";
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
    // the day lives in the group header now, so the row only shows the clock;
    // hourCycle h23 keeps the prototype's 24h "15:30" rendering everywhere
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  }
  return "All day";
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayKey(event: { start: { dateTime?: string; date?: string } }) {
  const d = startOf(event);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// "Today" / "Tomorrow" / "Thu 29 Oct" (prototype format; supersedes #14's DD/MM)
function dayHeader(event: { start: { dateTime?: string; date?: string } }) {
  const d = startOf(event);
  const today = new Date();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1))) return "Tomorrow";
  const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
  const month = d.toLocaleDateString(undefined, { month: "short" });
  return `${weekday} ${d.getDate()} ${month}`;
}

export function RoutinePanel() {
  const { data, isPending, isError } = api.calendar.routine.useQuery(undefined);

  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (isError) return <p className="text-sm text-muted-foreground">Couldn’t load schedule.</p>;
  if (data.length === 0) return <p className="text-sm text-muted-foreground">Nothing scheduled yet.</p>;

  return (
    <ul>
      {data.map((event, index) => {
        const firstOfDay = index === 0 || dayKey(data[index - 1]) !== dayKey(event);
        return (
          <Fragment key={event.id}>
            {firstOfDay && (
              <li
                className={
                  // the first group sits flush; every later group gets the hairline
                  index === 0
                    ? "day-label"
                    : "day-label mt-3.5 border-t border-[var(--rail-border)] pt-3.5"
                }
              >
                {dayHeader(event)}
              </li>
            )}
            <li className="routine-item">
              <div className="time">{whenLabel(event)}</div>
              <span className="title">{event.summary}</span>
              <div className="routine-links">
                {event.joinLink && (
                  <a
                    className="join flex items-center gap-1"
                    href={event.joinLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Video className="size-3" aria-hidden="true" />
                    Join
                  </a>
                )}
                {event.htmlLink && (
                  <a href={event.htmlLink} target="_blank" rel="noreferrer">
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

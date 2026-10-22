"use client";

import { api } from "@/trpc/provider";

function whenLabel(event: { start: { dateTime?: string; date?: string } }) {
  if (event.start.dateTime) {
    const d = new Date(event.start.dateTime);
    return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  }
  const d = new Date(event.start.date ?? 0);
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · all day`;
}

export function RoutinePanel() {
  const { data, isPending, isError } = api.calendar.routine.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  if (isPending) return <p className="text-sm text-neutral-400">Loading…</p>;
  if (isError) return <p className="text-sm text-neutral-400">Couldn’t load schedule.</p>;
  if (data.length === 0) return <p className="text-sm text-neutral-400">Nothing scheduled yet.</p>;

  return (
    <ul className="space-y-4">
      {data.map((event) => (
        <li key={event.id}>
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
      ))}
    </ul>
  );
}

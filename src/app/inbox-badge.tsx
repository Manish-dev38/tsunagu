"use client";

import { api } from "@/trpc/provider";

export function InboxBadge() {
  const { data } = api.inbox.list.useQuery({ limit: 1 }, { refetchInterval: 60_000 });
  const count = data?.unreadCount ?? 0;
  if (count === 0) return null;
  return (
    <span className="ml-2 rounded-full bg-neutral-900 px-1.5 py-0.5 text-xs text-white">
      {count}
    </span>
  );
}

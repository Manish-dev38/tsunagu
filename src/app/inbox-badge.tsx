"use client";

import { api } from "@/trpc/provider";

export function InboxBadge() {
  const { data } = api.inbox.list.useQuery({ limit: 1 });
  const count = data?.unreadCount ?? 0;
  if (count === 0) return null;
  return <span className="count">{count}</span>;
}

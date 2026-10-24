"use client";

import Link from "next/link";
import { api } from "@/trpc/provider";

export function AccountBlock() {
  const me = api.me.useQuery(undefined, { retry: false });
  if (me.isPending || me.isError) return null;

  const { name, email, image } = me.data;
  const initial = (name ?? email ?? "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <Link
      className="flex flex-col items-center gap-1.5 rounded px-2 py-2 text-center hover:bg-neutral-100"
      href="/account"
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- Google avatar URL, not a route image
        <img alt="" className="h-10 w-10 rounded-full object-cover" src={image} />
      ) : (
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-200 text-sm font-semibold text-neutral-600">
          {initial}
        </span>
      )}
      <span className="w-full truncate text-xs text-neutral-600">{email}</span>
    </Link>
  );
}

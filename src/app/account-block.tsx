"use client";

import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { api } from "@/trpc/provider";

// "Manish Kumar" -> "MK", one word -> "M", else the email's first letter
function initials(name: string | null, email: string | null) {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (email ?? "?").slice(0, 1).toUpperCase();
}

export function AccountBlock() {
  const me = api.me.useQuery(undefined, { retry: false });
  if (me.isPending || me.isError) return null;

  const { name, email, image } = me.data;

  return (
    <Link
      className="account-block"
      href="/account"
      title={[name, email].filter(Boolean).join(", ") || "Account"}
    >
      <Avatar className="size-9">
        {image && <AvatarImage src={image} alt="" />}
        <AvatarFallback className="font-sans text-[13px] font-bold text-foreground">
          {initials(name, email)}
        </AvatarFallback>
      </Avatar>
      <span className="account-meta">
        {name && <span className="name">{name}{" "}</span>}
        {email && <span className="email">{email}</span>}
      </span>
    </Link>
  );
}

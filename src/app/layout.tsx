import type { Metadata } from "next";
import Link from "next/link";
import { AccountBlock } from "./account-block";
import { InboxBadge } from "./inbox-badge";
import { RoutinePanel } from "./routine-panel";
import { TRPCProvider } from "@/trpc/provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tsunagu",
  description: "AI-native Gmail and Calendar",
};

const NAV: { label: string; href?: string; badge?: boolean }[] = [
  { label: "Chat", href: "/chat" },
  { label: "Action", href: "/action" },
  { label: "Inbox", href: "/inbox", badge: true },
  { label: "Memory", href: "/memory" },
  { label: "Calendar", href: "/calendar" },
  { label: "Routine" },
  { label: "Connector", href: "/connector" },
  { label: "Account", href: "/account" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TRPCProvider>
          {/* definite viewport shell: sidebar + routine stay put, main scrolls */}
          <div className="flex h-screen overflow-hidden">
            <aside className="flex w-48 shrink-0 flex-col overflow-y-auto border-r border-neutral-200 p-4">
              <div className="mb-6 font-semibold">Tsunagu</div>
              <nav>
                <ul className="space-y-1 text-sm text-neutral-600">
                  {NAV.map((item) => (
                    <li key={item.label}>
                      {item.href ? (
                        <Link className="block rounded px-2 py-1 hover:bg-neutral-100" href={item.href}>
                          {item.label}
                          {item.badge && <InboxBadge />}
                        </Link>
                      ) : (
                        <span className="block px-2 py-1">{item.label}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
              <AccountBlock />
            </aside>
            <main className="flex-1 overflow-y-auto p-8">{children}</main>
            <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-neutral-200 p-4 lg:block">
              <div className="mb-4 text-sm font-semibold text-neutral-500">Routine</div>
              <RoutinePanel />
            </aside>
          </div>
        </TRPCProvider>
      </body>
    </html>
  );
}

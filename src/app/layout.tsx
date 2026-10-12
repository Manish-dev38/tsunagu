import type { Metadata } from "next";
import Link from "next/link";
import { TRPCProvider } from "@/trpc/provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tsunagu",
  description: "AI-native Gmail and Calendar",
};

const NAV: { label: string; href?: string }[] = [
  { label: "Chat" },
  { label: "Action" },
  { label: "Inbox" },
  { label: "Memory" },
  { label: "Calendar" },
  { label: "Routine" },
  { label: "Connector", href: "/connector" },
  { label: "Account" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TRPCProvider>
          <div className="flex min-h-screen">
            <aside className="w-48 shrink-0 border-r border-neutral-200 p-4">
              <div className="mb-6 font-semibold">Tsunagu</div>
              <nav>
                <ul className="space-y-1 text-sm text-neutral-600">
                  {NAV.map((item) => (
                    <li key={item.label}>
                      {item.href ? (
                        <Link className="block rounded px-2 py-1 hover:bg-neutral-100" href={item.href}>
                          {item.label}
                        </Link>
                      ) : (
                        <span className="block px-2 py-1">{item.label}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            </aside>
            <main className="flex-1 p-8">{children}</main>
            <aside className="hidden w-72 shrink-0 border-l border-neutral-200 p-4 lg:block">
              <div className="mb-4 text-sm font-semibold text-neutral-500">Routine</div>
              <p className="text-sm text-neutral-400">Nothing scheduled yet.</p>
            </aside>
          </div>
        </TRPCProvider>
      </body>
    </html>
  );
}

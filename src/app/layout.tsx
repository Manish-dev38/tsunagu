import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tsunagu",
  description: "AI-native Gmail and Calendar",
};

const NAV = ["Chat", "Action", "Inbox", "Memory", "Calendar", "Routine", "Connector", "Account"] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen">
          <aside className="w-48 shrink-0 border-r border-neutral-200 p-4">
            <div className="mb-6 font-semibold">Tsunagu</div>
            <nav>
              <ul className="space-y-1 text-sm text-neutral-600">
                {NAV.map((item) => (
                  <li key={item} className="rounded px-2 py-1 hover:bg-neutral-100">
                    {item}
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
      </body>
    </html>
  );
}

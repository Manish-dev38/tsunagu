"use client";

import {
  Brain,
  Calendar,
  Clock,
  Inbox,
  ListChecks,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  User,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import { AccountBlock } from "./account-block";
import { InboxBadge } from "./inbox-badge";
import { RoutinePanel } from "./routine-panel";
import { ThemeToggle } from "./theme-toggle";

const SIDEBAR_KEY = "tsunagu-sidebar-collapsed";
const COLLAPSED_CLASS = "sidebar-collapsed";
const MOBILE_QUERY = "(max-width: 860px)";

const NAV: {
  label: string;
  href: string;
  icon: typeof MessageSquare;
  badge?: boolean;
}[] = [
  { label: "Chat", href: "/chat", icon: MessageSquare },
  { label: "Action log", href: "/action", icon: ListChecks },
  { label: "Inbox", href: "/inbox", icon: Inbox, badge: true },
  { label: "Memory", href: "/memory", icon: Brain },
  { label: "Calendar", href: "/calendar", icon: Calendar },
  { label: "Connectors", href: "/connector", icon: Plug },
  { label: "Account", href: "/account", icon: User },
];

// the prototype's .btn-icon look lives in IconButton's `chrome` variant

function Wordmark() {
  return (
    <Link className="wordmark" href="/" title="Tsunagu">
      <span className="mark">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="9" cy="12" r="5" />
          <circle cx="15" cy="12" r="5" />
        </svg>
      </span>
      <span className="wordmark-text">Tsunagu</span>
    </Link>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Collapse state lives on <html>, set before first paint by the inline
  // script in the root layout, so the rail never flashes. This mirrors it
  // into React for aria, and applies the prototype's mobile reset rule.
  useEffect(() => {
    const mq = matchMedia(MOBILE_QUERY);
    const sync = () => {
      const root = document.documentElement;
      if (mq.matches) {
        root.classList.remove(COLLAPSED_CLASS);
        setCollapsed(false);
      } else {
        let stored = "false";
        try {
          stored = localStorage.getItem(SIDEBAR_KEY) ?? "false";
        } catch {}
        root.classList.toggle(COLLAPSED_CLASS, stored === "true");
        setCollapsed(stored === "true");
      }
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // prototype behavior: navigating closes the mobile drawer (renderRoute calls
  // closeDrawer there; here each nav link closes it on click)
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.documentElement.classList.toggle(COLLAPSED_CLASS, next);
    try {
      localStorage.setItem(SIDEBAR_KEY, String(next));
    } catch {}
  };

  return (
    <div className="shell-root">
      <header className="mobile-top">
        <IconButton
          variant="chrome"
          aria-label="Open navigation"
          aria-controls="sidebar"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <Menu />
        </IconButton>
        <Wordmark />
        <span aria-hidden="true" className="w-9" />
      </header>

      <div
        className={cn("scrim", drawerOpen && "is-open")}
        onClick={() => setDrawerOpen(false)}
      />

      <div className="app-shell">
        <aside
          id="sidebar"
          aria-label="Primary"
          className={cn("sidebar", drawerOpen && "is-open")}
        >
          <div className="brand-row">
            <Wordmark />
            <IconButton
              className="sidebar-toggle"
              variant="chrome"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={toggleCollapse}
            >
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </IconButton>
          </div>

          <nav>
            <ul className="nav-list">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    className={cn("nav-item", pathname === item.href && "is-active")}
                    href={item.href}
                    title={item.label}
                    onClick={() => setDrawerOpen(false)}
                  >
                    <item.icon aria-hidden="true" />
                    <span className="nav-label">{item.label}</span>
                    {item.badge && <InboxBadge />}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="sidebar-bottom">
            <ThemeToggle />
            <AccountBlock />
          </div>
        </aside>

        <main className="main">{children}</main>

        <aside className="routine" aria-label="Routine">
          <div className="routine-head">
            <h2 className="flex items-center gap-2">
              <Clock className="size-[15px]" aria-hidden="true" />
              Routine
            </h2>
            <Link
              href="/calendar"
              className="text-[11.5px] text-muted-foreground"
              title="Open calendar"
            >
              Open calendar
            </Link>
          </div>
          <RoutinePanel />
        </aside>
      </div>
    </div>
  );
}

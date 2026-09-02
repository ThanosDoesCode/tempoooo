import { Link, useLocation } from "@tanstack/react-router";
import {
  CalendarCheck,
  Dumbbell,
  Euro,
  History,
  Home,
  LineChart,
  LogOut,
  PlusCircle,
  Trophy,
  User,
  Users,
} from "lucide-react";

import type { ReactNode } from "react";
import { signOut } from "@/lib/auth";
import { useMemberships } from "@/lib/bulk-access";
import { useBulkMeta } from "@/lib/store";

const BULK_NAV = [
  { to: "/bulk", label: "Today", icon: Home, exact: true },
  { to: "/bulk/training", label: "Training", icon: Dumbbell, exact: false },
  { to: "/bulk/progress", label: "Progress", icon: LineChart, exact: false },
  { to: "/bulk/check-in", label: "Check-In", icon: CalendarCheck, exact: false },
] as const;

const OWNER_NAV = { to: "/bulk/access", label: "Sharing", icon: Users, exact: false } as const;

const CHALLENGE_NAV = [
  { to: "/challenge", label: "Week", icon: Trophy, exact: true },
  { to: "/challenge/log", label: "Add", icon: PlusCircle, exact: false },
  { to: "/challenge/history", label: "History", icon: History, exact: false },
  { to: "/challenge/payments", label: "Money", icon: Euro, exact: false },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const isChallenge = pathname.startsWith("/challenge");
  const { role } = useBulkMeta();
  const { data: memberships } = useMemberships();

  const hasBulk = (memberships?.length ?? 0) > 0;
  const bulkLabel = role === "owner" ? "My Bulk" : "Shared Bulk";
  const viewerLock = !isChallenge && role === "viewer";

  const nav = isChallenge ? CHALLENGE_NAV : role === "owner" ? [...BULK_NAV, OWNER_NAV] : BULK_NAV;

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-lg items-center gap-2 px-4 py-2">
          {hasBulk ? (
            <Link
              to="/bulk"
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                isChallenge ? "text-muted-foreground" : "bg-elevated text-foreground"
              }`}
            >
              {bulkLabel}
            </Link>
          ) : null}
          <Link
            to="/challenge"
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              isChallenge ? "bg-elevated text-foreground" : "text-muted-foreground"
            }`}
          >
            Challenge
          </Link>
          {viewerLock ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warn">
              View only
            </span>
          ) : null}
          <Link to="/profile" aria-label="Profile" className="ml-auto text-muted-foreground">
            <User className="h-4 w-4" />
          </Link>
          <button
            onClick={() => void signOut()}
            aria-label="Sign out"
            className="text-muted-foreground"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      <main className={`mx-auto w-full max-w-lg px-4 pb-28 ${isChallenge ? "pt-4" : "pt-6"}`}>
        {viewerLock ? (
          <fieldset disabled className="m-0 border-0 p-0">
            {children}
          </fieldset>
        ) : (
          children
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur">
        <div
          className="mx-auto grid max-w-lg px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2"
          style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}
        >
          {nav.map(({ to, label, icon: Icon, exact }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact }}
              className="group flex flex-col items-center gap-1 rounded-xl py-2 text-muted-foreground transition-colors data-[status=active]:text-primary"
            >
              <Icon className="h-5 w-5" strokeWidth={2} />
              <span className="text-[11px] font-medium">{label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="fade-up mb-5">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
    </header>
  );
}

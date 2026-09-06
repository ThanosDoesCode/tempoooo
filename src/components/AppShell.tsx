import { Link, useLocation, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  CalendarCheck,
  Dumbbell,
  Euro,
  History,
  Home,
  LineChart,
  MoreHorizontal,
  Utensils,
  LogOut,
  PlusCircle,
  Trophy,
  User,
} from "lucide-react";

import { useEffect, useState, type ReactNode } from "react";
import { signOut } from "@/lib/auth";
import { useMemberships } from "@/lib/bulk-access";
import { prefetchBulk, useIsPublicBulk } from "@/lib/store";
import { PullToRefresh } from "./PullToRefresh";

const LEGACY_BULK_NAV = [
  { to: "/bulk", label: "Today", icon: Home, exact: true },
  { to: "/bulk/training", label: "Training", icon: Dumbbell, exact: false },
  { to: "/bulk/meals", label: "Meals", icon: Utensils, exact: false },
  { to: "/bulk/progress", label: "Progress", icon: LineChart, exact: false },
  { to: "/bulk/check-in", label: "Check-In", icon: CalendarCheck, exact: false },
  { to: "/bulk/history", label: "History", icon: History, exact: false },
] as const;

const PUBLIC_BULK_NAV = [
  { to: "/bulk", label: "Today", icon: Home, exact: true },
  { to: "/bulk/training", label: "Training", icon: Dumbbell, exact: false },
  { to: "/bulk/meals", label: "Meals", icon: Utensils, exact: false },
  { to: "/bulk/more", label: "More", icon: MoreHorizontal, exact: false },
] as const;

const MORE_DESTINATIONS = ["/bulk/more", "/bulk/progress", "/bulk/check-in", "/bulk/history"];

const CHALLENGE_NAV = [
  { to: "/challenge", label: "Week", icon: Trophy, exact: true },
  { to: "/challenge/log", label: "Add", icon: PlusCircle, exact: false },
  { to: "/challenge/history", label: "History", icon: History, exact: false },
  { to: "/challenge/payments", label: "Money", icon: Euro, exact: false },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const navigationPending = useRouterState({ select: (router) => router.status === "pending" });
  const isChallenge = pathname.startsWith("/challenge");
  const isBulk = pathname.startsWith("/bulk");
  const { data: memberships } = useMemberships();
  const usesPublicBulk = useIsPublicBulk();
  const [pendingTo, setPendingTo] = useState<string | null>(null);

  useEffect(() => setPendingTo(null), [pathname]);

  const hasBulk = memberships?.some((membership) => membership.role === "owner") ?? false;
  const owner = memberships?.find((membership) => membership.role === "owner");
  const showingChallenge = pendingTo ? pendingTo.startsWith("/challenge") : isChallenge;

  const nav =
    isBulk && hasBulk ? (usesPublicBulk ? PUBLIC_BULK_NAV : LEGACY_BULK_NAV) : CHALLENGE_NAV;
  const prefetchDestination = (to: string) => {
    if (to.startsWith("/bulk") && owner) void prefetchBulk(owner.bulk_profile_id);
  };
  const acknowledge = (to: string) => {
    setPendingTo(to);
    prefetchDestination(to);
  };

  return (
    <div className="min-h-screen bg-background">
      <PullToRefresh />
      <div className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-lg items-center gap-2 px-4 py-2">
          <Link
            to="/challenge"
            preload="intent"
            onPointerDown={() => acknowledge("/challenge")}
            onClick={() => acknowledge("/challenge")}
            className={`min-h-11 rounded-lg px-3 py-2.5 text-sm font-semibold active:scale-95 ${
              showingChallenge ? "bg-elevated text-foreground" : "text-muted-foreground"
            }`}
          >
            Challenge
          </Link>
          {hasBulk ? (
            <Link
              to="/bulk"
              preload="intent"
              onPointerEnter={() => prefetchDestination("/bulk")}
              onFocus={() => prefetchDestination("/bulk")}
              onPointerDown={() => acknowledge("/bulk")}
              onClick={() => acknowledge("/bulk")}
              className={`min-h-11 rounded-lg px-3 py-2.5 text-sm font-medium active:scale-95 ${
                showingChallenge ? "text-muted-foreground" : "bg-elevated text-foreground"
              }`}
            >
              Bulk
            </Link>
          ) : null}
          <Link
            to="/profile"
            preload="intent"
            aria-label="Profile"
            className="ml-auto grid min-h-11 min-w-11 place-items-center rounded-xl text-muted-foreground active:bg-elevated"
          >
            <User className="h-4 w-4" />
          </Link>
          <button
            onClick={() => {
              void signOut().then((signedOut) => {
                if (signedOut) void navigate({ to: "/auth", replace: true });
              });
            }}
            aria-label="Sign out"
            className="grid min-h-11 min-w-11 place-items-center rounded-xl text-muted-foreground active:bg-elevated"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        <div
          aria-hidden="true"
          className={`absolute inset-x-0 bottom-0 h-0.5 overflow-hidden transition-opacity ${navigationPending ? "opacity-100" : "opacity-0"}`}
        >
          <span className="block h-full w-1/2 animate-pulse rounded-full bg-primary" />
        </div>
      </div>

      <main className={`mx-auto w-full max-w-lg px-4 pb-28 ${isChallenge ? "pt-4" : "pt-6"}`}>
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur">
        <div
          className="mx-auto grid max-w-lg px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2"
          style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}
        >
          {nav.map(({ to, label, icon: Icon, exact }) => {
            const moreSelected =
              to === "/bulk/more" &&
              !pendingTo &&
              MORE_DESTINATIONS.some(
                (destination) => pathname === destination || pathname.startsWith(`${destination}/`),
              );
            const selected = pendingTo === to || moreSelected;
            return (
              <Link
                key={to}
                to={to}
                preload="intent"
                activeOptions={{ exact }}
                onPointerEnter={() => prefetchDestination(to)}
                onFocus={() => prefetchDestination(to)}
                onPointerDown={() => acknowledge(to)}
                onClick={() => acknowledge(to)}
                aria-current={selected ? "page" : undefined}
                className={`group flex min-h-11 flex-col items-center gap-1 rounded-xl py-2 text-muted-foreground transition active:scale-95 active:bg-elevated data-[status=active]:text-primary ${selected ? "bg-elevated text-primary" : ""}`}
              >
                <Icon className="h-5 w-5" strokeWidth={2} />
                <span className="text-[11px] font-medium">{label}</span>
              </Link>
            );
          })}
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

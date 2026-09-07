import { Link, useLocation, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  CalendarCheck,
  Dumbbell,
  Euro,
  History,
  Home,
  LineChart,
  MoreHorizontal,
  Utensils,
  PlusCircle,
  Salad,
  Trophy,
  User,
} from "lucide-react";

import { useEffect, useState, type ReactNode } from "react";
import { useMemberships } from "@/lib/bulk-access";
import { prefetchBulk } from "@/lib/store";
import { useGoalDiscovery } from "@/lib/goal-discovery";
import { PullToRefresh } from "./PullToRefresh";

const CHALLENGE_NAV = [
  { to: "/challenge", label: "Week", icon: Trophy, exact: true },
  { to: "/challenge/log", label: "Add", icon: PlusCircle, exact: false },
  { to: "/challenge/history", label: "History", icon: History, exact: false },
  { to: "/challenge/payments", label: "Money", icon: Euro, exact: false },
] as const;

const TRAINING_NAV = [
  { to: "/bulk/training", label: "Today", icon: Dumbbell, exact: true },
  { to: "/bulk/training", hash: "plan", label: "Plan", icon: CalendarCheck, exact: true },
  { to: "/bulk/prs", label: "PRs", icon: Trophy, exact: false },
  { to: "/bulk/exercises", label: "More", icon: MoreHorizontal, exact: false },
] as const;

const MEALS_NAV = [
  { to: "/bulk/meals", label: "Today", icon: Utensils, exact: true },
  { to: "/bulk/meals", hash: "presets", label: "Presets", icon: Salad, exact: true },
  { to: "/bulk/history", label: "History", icon: History, exact: false },
  { to: "/bulk/more", label: "More", icon: MoreHorizontal, exact: false },
] as const;

const GOAL_NAV = [
  { to: "/bulk", label: "Today", icon: Home, exact: true },
  { to: "/bulk/progress", label: "Progress", icon: LineChart, exact: false },
  { to: "/bulk/check-in", label: "Check-In", icon: CalendarCheck, exact: false },
  { to: "/bulk/more", label: "More", icon: MoreHorizontal, exact: false },
] as const;

type ProductArea = "challenge" | "training" | "meals" | "goal";

function productArea(pathname: string): ProductArea {
  if (pathname.startsWith("/challenge")) return "challenge";
  if (
    pathname.startsWith("/bulk/training") ||
    pathname.startsWith("/bulk/workout") ||
    pathname.startsWith("/bulk/exercises") ||
    pathname.startsWith("/bulk/prs")
  )
    return "training";
  if (pathname.startsWith("/bulk/meals")) return "meals";
  if (pathname.startsWith("/bulk")) return "goal";
  return "challenge";
}

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname, hash } = useLocation();
  const navigationPending = useRouterState({ select: (router) => router.status === "pending" });
  const isChallenge = pathname.startsWith("/challenge");
  const { data: memberships } = useMemberships();
  const goalDiscovery = useGoalDiscovery();
  const [pendingTo, setPendingTo] = useState<string | null>(null);

  useEffect(() => setPendingTo(null), [pathname]);

  const hasBulk = memberships?.some((membership) => membership.role === "owner") ?? false;
  const owner = memberships?.find((membership) => membership.role === "owner");
  const area = pendingTo ? productArea(pendingTo) : productArea(pathname);
  const nav =
    area === "challenge"
      ? CHALLENGE_NAV
      : area === "training"
        ? TRAINING_NAV
        : area === "meals"
          ? MEALS_NAV
          : GOAL_NAV;
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
        <div className="mx-auto flex w-full max-w-lg items-center gap-1 px-2 py-2">
          {(
            [
              { to: "/challenge", label: "Challenge", icon: Trophy, area: "challenge" },
              { to: "/bulk/training", label: "Training", icon: Dumbbell, area: "training" },
              { to: "/bulk/meals", label: "Meals", icon: Utensils, area: "meals" },
              { to: "/bulk", label: "Goal", icon: LineChart, area: "goal" },
            ] as const
          ).map((item) =>
            item.area !== "challenge" && !hasBulk ? null : (
              <Link
                key={item.area}
                to={item.to}
                preload="intent"
                aria-label={item.label}
                aria-current={area === item.area ? "page" : undefined}
                onPointerEnter={() => prefetchDestination(item.to)}
                onFocus={() => prefetchDestination(item.to)}
                onPointerDown={() => acknowledge(item.to)}
                onClick={() => acknowledge(item.to)}
                className={`flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center rounded-xl px-1 text-[10px] font-semibold transition active:scale-95 ${area === item.area ? "bg-elevated text-primary" : "text-muted-foreground"}`}
              >
                <item.icon className="h-4 w-4" aria-hidden="true" />
                <span className="mt-0.5 truncate">{item.label}</span>
              </Link>
            ),
          )}
          <Link
            to="/profile"
            preload="intent"
            aria-label="Profile"
            className="relative grid min-h-11 min-w-11 place-items-center rounded-xl text-muted-foreground active:bg-elevated"
          >
            <User className="h-4 w-4" />
            {!hasBulk && goalDiscovery.isSuccess && goalDiscovery.data?.goal_seen_at == null ? (
              <span
                aria-label="New Goal feature"
                className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary ring-2 ring-background"
              />
            ) : null}
          </Link>
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
          {nav.map((item) => {
            const { to, label, icon: Icon, exact } = item;
            const itemHash = "hash" in item ? item.hash : undefined;
            const key = `${to}${itemHash ? `#${itemHash}` : ""}`;
            const selected =
              pendingTo === key || (pathname === to && (itemHash ? hash === itemHash : !hash));
            return (
              <Link
                key={key}
                to={to}
                {...(itemHash ? { hash: itemHash } : {})}
                preload="intent"
                activeOptions={{ exact }}
                onPointerEnter={() => prefetchDestination(to)}
                onFocus={() => prefetchDestination(to)}
                onPointerDown={() => acknowledge(key)}
                onClick={() => acknowledge(key)}
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

export function PageHeader({
  title,
  subtitle,
  backTo,
  backLabel = "Back",
}: {
  title: string;
  subtitle?: string;
  backTo?: "/profile" | "/challenge" | "/challenge/payments" | "/bulk/training";
  backLabel?: string;
}) {
  return (
    <header className="fade-up mb-5">
      {backTo ? (
        <Link
          to={backTo}
          className="mb-2 inline-flex min-h-11 items-center gap-2 rounded-xl pr-3 text-sm font-semibold text-muted-foreground active:bg-elevated"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {backLabel}
        </Link>
      ) : null}
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
    </header>
  );
}

import { Link, useLocation, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, Dumbbell, LineChart, Utensils, Trophy, User } from "lucide-react";

import { createContext, useContext, type ReactNode } from "react";
import { activeBulkMemberships, useMemberships } from "@/lib/bulk-access";
import { prefetchBulk } from "@/lib/store";
import { useGoalDiscovery } from "@/lib/goal-discovery";
import { PRODUCT_LANDING_ROUTES, productAreaForPath } from "@/lib/product-navigation";
import { PullToRefresh } from "./PullToRefresh";

const CHALLENGE_NAV = [
  { to: "/challenge", label: "Week", exact: true },
  { to: "/challenge/log", label: "Add", exact: false },
  { to: "/challenge/history", label: "History", exact: false },
  {
    to: "/challenge/payments",
    label: "Money",
    exact: false,
    activePrefixes: ["/challenge/targets"],
  },
] as const;

const TRAINING_NAV = [
  {
    to: "/bulk/training",
    label: "Today",
    exact: true,
    activePrefixes: ["/bulk/workout/"],
  },
  { to: "/bulk/prs", label: "PRs", exact: false },
  { to: "/bulk/training/history", label: "History", exact: false },
  {
    to: "/bulk/training/more",
    label: "More",
    exact: false,
    activePrefixes: ["/bulk/exercises"],
  },
] as const;

const MEALS_NAV = [
  { to: "/bulk/meals", label: "Today", exact: true },
  { to: "/bulk/meals/presets", label: "Presets", exact: false },
  {
    to: "/bulk/meals/history",
    label: "History",
    exact: false,
  },
  { to: "/bulk/meals/more", label: "More", exact: false },
] as const;

const GOAL_NAV = [
  { to: "/bulk", label: "Today", exact: true },
  { to: "/bulk/progress", label: "Progress", exact: false },
  { to: "/bulk/check-in", label: "Check-In", exact: false },
  {
    to: "/bulk/more",
    label: "More",
    exact: false,
    activePrefixes: ["/bulk/history", "/bulk/diagnostics"],
  },
] as const;

const PRIMARY_NAV = [
  {
    to: PRODUCT_LANDING_ROUTES.challenge,
    label: "Challenge",
    icon: Trophy,
    area: "challenge",
  },
  {
    to: PRODUCT_LANDING_ROUTES.training,
    label: "Training",
    icon: Dumbbell,
    area: "training",
  },
  {
    to: PRODUCT_LANDING_ROUTES.meals,
    label: "Meals",
    icon: Utensils,
    area: "meals",
  },
  {
    to: PRODUCT_LANDING_ROUTES.goal,
    label: "Goal",
    icon: LineChart,
    area: "goal",
  },
  {
    to: PRODUCT_LANDING_ROUTES.profile,
    label: "Profile",
    icon: User,
    area: "profile",
  },
] as const;

const AppShellMountedContext = createContext(false);

export function AppShell({ children }: { children: ReactNode }) {
  const shellMounted = useContext(AppShellMountedContext);
  if (shellMounted) return <>{children}</>;

  return (
    <AppShellMountedContext.Provider value>
      <AppChrome>{children}</AppChrome>
    </AppShellMountedContext.Provider>
  );
}

function AppChrome({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigationPending = useRouterState({ select: (router) => router.status === "pending" });
  const isChallenge = pathname.startsWith("/challenge");
  const { data: memberships } = useMemberships();
  const goalDiscovery = useGoalDiscovery();

  const activeMemberships = activeBulkMemberships(memberships);
  const hasBulk = activeMemberships.some((membership) => membership.role === "owner");
  const owner = activeMemberships.find((membership) => membership.role === "owner");
  const area = productAreaForPath(pathname);
  const nav =
    area === "challenge"
      ? CHALLENGE_NAV
      : area === "training"
        ? TRAINING_NAV
        : area === "meals"
          ? MEALS_NAV
          : area === "goal"
            ? GOAL_NAV
            : null;
  const primaryNav = PRIMARY_NAV.filter(
    (item) => item.area === "challenge" || item.area === "profile" || hasBulk,
  );
  const prefetchDestination = (to: string) => {
    if (to.startsWith("/bulk") && owner) void prefetchBulk(owner.bulk_profile_id);
  };

  return (
    <div className="min-h-screen bg-background">
      <PullToRefresh />
      <main className={`mx-auto w-full max-w-lg px-4 pb-28 ${isChallenge ? "pt-4" : "pt-6"}`}>
        {nav ? (
          <nav aria-label={`${area} sections`} className="mb-4 overflow-x-auto">
            <div className="grid min-w-max grid-cols-4 gap-1 rounded-xl bg-card p-1 sm:min-w-0">
              {nav.map((item) => {
                const { to, label, exact } = item;
                const activePrefixes = "activePrefixes" in item ? item.activePrefixes : [];
                const selected =
                  (exact ? pathname === to : pathname.startsWith(to)) ||
                  activePrefixes.some((prefix) => pathname.startsWith(prefix));
                return (
                  <Link
                    key={to}
                    to={to}
                    preload="intent"
                    activeOptions={{ exact }}
                    onPointerDown={() => prefetchDestination(to)}
                    onPointerEnter={() => prefetchDestination(to)}
                    onFocus={() => prefetchDestination(to)}
                    aria-current={selected ? "page" : undefined}
                    className={`flex min-h-11 min-w-[4.5rem] items-center justify-center rounded-lg px-2 text-xs font-semibold whitespace-nowrap transition-[color,background-color,transform,opacity] duration-150 ease-out active:scale-[0.98] active:bg-elevated active:opacity-80 ${selected ? "bg-elevated text-primary" : "text-muted-foreground"}`}
                  >
                    {label}
                  </Link>
                );
              })}
            </div>
          </nav>
        ) : null}
        <div key={pathname} className="tempo-route-content">
          {children}
        </div>
      </main>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur"
      >
        <div
          aria-hidden="true"
          className={`absolute inset-x-0 top-0 h-0.5 overflow-hidden transition-opacity ${navigationPending ? "opacity-100" : "opacity-0"}`}
        >
          <span className="block h-full w-1/2 animate-pulse rounded-full bg-primary" />
        </div>
        <div
          className="mx-auto grid max-w-lg px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2"
          style={{ gridTemplateColumns: `repeat(${primaryNav.length}, minmax(0, 1fr))` }}
        >
          {primaryNav.map((item) => {
            const Icon = item.icon;
            const selected = area === item.area;
            return (
              <Link
                key={item.area}
                to={item.to}
                preload="intent"
                aria-label={item.label}
                aria-current={selected ? "page" : undefined}
                onPointerDown={() => prefetchDestination(item.to)}
                onPointerEnter={() => prefetchDestination(item.to)}
                onFocus={() => prefetchDestination(item.to)}
                className={`relative flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-muted-foreground transition-[color,background-color,transform,opacity] duration-150 ease-out active:scale-95 active:bg-elevated active:opacity-80 ${selected ? "bg-elevated text-primary" : ""}`}
              >
                <Icon className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
                <span className="max-w-full truncate text-[10px] font-medium">{item.label}</span>
                {item.area === "profile" &&
                !hasBulk &&
                goalDiscovery.isSuccess &&
                goalDiscovery.data?.goal_seen_at == null ? (
                  <span
                    aria-label="New Goal feature"
                    className="absolute right-[28%] top-1.5 h-2 w-2 rounded-full bg-primary ring-2 ring-card"
                  />
                ) : null}
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

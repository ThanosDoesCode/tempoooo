import { Link, useLocation, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, Dumbbell, LineChart, Utensils, Trophy, User } from "lucide-react";

import { createContext, useContext, type ReactNode } from "react";
import { preferredBulkMembership, useMemberships } from "@/lib/bulk-access";
import { prefetchBulk } from "@/lib/store";
import { useGoalDiscovery } from "@/lib/goal-discovery";
import { PRODUCT_LANDING_ROUTES, productAreaForPath } from "@/lib/product-navigation";
import { PullToRefresh } from "./PullToRefresh";
import { useChallengeInvitations } from "@/lib/challenge-invitations";
import { SecondaryNavigation } from "./SecondaryNavigation";

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
    label: "Settings",
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
  const isAccountOnboarding = pathname === "/onboarding";
  const { data: memberships } = useMemberships();
  const goalDiscovery = useGoalDiscovery();
  const pendingInvitations = useChallengeInvitations();

  const owner = preferredBulkMembership(memberships);
  const hasFitnessTools = owner !== null;
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
    (item) =>
      item.area === "challenge" ||
      item.area === "goal" ||
      item.area === "profile" ||
      hasFitnessTools,
  );
  const prefetchDestination = (to: string) => {
    if (to.startsWith("/bulk") && owner) void prefetchBulk(owner.bulk_profile_id);
  };

  return (
    <div className="min-h-screen bg-background">
      <PullToRefresh>
        <main
          className={`mx-auto w-full max-w-lg px-4 ${isAccountOnboarding ? "pb-6 pt-0" : `pb-28 ${isChallenge ? "pt-4" : "pt-6"}`}`}
        >
          {nav ? (
            <SecondaryNavigation
              label={`${area} sections`}
              items={nav}
              pathname={pathname}
              onIntent={prefetchDestination}
            />
          ) : null}
          <div key={pathname} className="tempo-route-content">
            {children}
          </div>
        </main>
      </PullToRefresh>

      {!isAccountOnboarding ? (
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
              const label = item.label;
              return (
                <Link
                  key={item.area}
                  to={item.to}
                  preload="intent"
                  aria-label={label}
                  aria-current={selected ? "page" : undefined}
                  onPointerDown={() => prefetchDestination(item.to)}
                  onPointerEnter={() => prefetchDestination(item.to)}
                  onFocus={() => prefetchDestination(item.to)}
                  className={`relative flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-muted-foreground transition-[color,background-color,transform,opacity] duration-150 ease-out active:scale-95 active:bg-elevated active:opacity-80 ${selected ? "bg-elevated text-primary" : ""}`}
                >
                  <Icon className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
                  <span className="max-w-full truncate text-[10px] font-medium">{label}</span>
                  {item.area === "profile" &&
                  !hasFitnessTools &&
                  goalDiscovery.isSuccess &&
                  goalDiscovery.data?.goal_seen_at == null ? (
                    <span
                      aria-label="New Fitness tools"
                      className="absolute right-[28%] top-1.5 h-2 w-2 rounded-full bg-primary ring-2 ring-card"
                    />
                  ) : null}
                  {item.area === "profile" && (pendingInvitations.data?.length ?? 0) > 0 ? (
                    <span
                      aria-label={`${pendingInvitations.data!.length} pending Challenge invitations`}
                      className="absolute right-[24%] top-0.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9px] font-bold text-white ring-2 ring-card"
                    >
                      {pendingInvitations.data!.length > 9 ? "9+" : pendingInvitations.data!.length}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </nav>
      ) : null}
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

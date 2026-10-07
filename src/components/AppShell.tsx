import { Link, useLocation, useRouterState } from "@tanstack/react-router";
import { Home, LineChart, Plus, Trophy, User, type LucideIcon } from "lucide-react";

import { createContext, useContext, useState, type ReactNode } from "react";
import { preferredBulkMembership, useMemberships } from "@/lib/bulk-access";
import { prefetchBulk } from "@/lib/store";
import { useGoalDiscovery } from "@/lib/goal-discovery";
import { isFocusScreen, mainTabForPath, MAIN_TABS, type MainTab } from "@/lib/main-navigation";
import { PullToRefresh } from "./PullToRefresh";
import { LogSheet } from "./LogSheet";
import { HistoryBackLink } from "./HistoryBackLink";
import { NotificationBell } from "./NotificationBell";

const TAB_ICONS: Record<MainTab, LucideIcon> = {
  today: Home,
  challenge: Trophy,
  progress: LineChart,
  you: User,
};

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
  const isAccountOnboarding = pathname === "/onboarding";
  const focusScreen = isFocusScreen(pathname);
  const { data: memberships } = useMemberships();
  const goalDiscovery = useGoalDiscovery();
  const [logOpen, setLogOpen] = useState(false);

  const owner = preferredBulkMembership(memberships);
  const hasFitnessTools = owner !== null;
  const activeTab = mainTabForPath(pathname);
  const widerDailyLayout =
    pathname === "/bulk" ||
    pathname.startsWith("/bulk/training") ||
    pathname.startsWith("/bulk/workout/") ||
    pathname.startsWith("/bulk/exercises");
  const prefetchDestination = (to: string) => {
    if (to.startsWith("/bulk") && owner) void prefetchBulk(owner.bulk_profile_id);
  };

  return (
    <div className="min-h-screen bg-background">
      <PullToRefresh>
        <main
          className={`mx-auto w-full ${widerDailyLayout ? "max-w-2xl" : "max-w-lg"} px-5 ${isAccountOnboarding ? "pb-6 pt-0" : `${focusScreen ? "pb-10" : "pb-28"} pt-[max(1.5rem,env(safe-area-inset-top))]`}`}
        >
          <div key={pathname} className="tempo-route-content">
            {children}
          </div>
        </main>
      </PullToRefresh>

      {!focusScreen ? (
        <>
          <nav
            aria-label="Primary"
            className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur"
          >
            <div
              aria-hidden="true"
              className={`absolute inset-x-0 top-0 h-0.5 overflow-hidden transition-opacity ${navigationPending ? "opacity-100" : "opacity-0"}`}
            >
              <span className="block h-full w-1/2 animate-pulse rounded-full bg-primary" />
            </div>
            <div className="mx-auto grid max-w-lg grid-cols-5 items-start px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2.5">
              {MAIN_TABS.slice(0, 2).map((item) => (
                <TabLink
                  key={item.tab}
                  item={item}
                  active={activeTab === item.tab}
                  onIntent={() => prefetchDestination(item.to)}
                />
              ))}

              <div className="flex justify-center">
                <button
                  type="button"
                  aria-label="Log"
                  aria-haspopup="dialog"
                  aria-expanded={logOpen}
                  onClick={() => setLogOpen(true)}
                  className="grid h-[52px] w-[52px] place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95"
                >
                  <Plus className="h-6 w-6" strokeWidth={2.4} aria-hidden="true" />
                </button>
              </div>

              {MAIN_TABS.slice(2).map((item) => (
                <TabLink
                  key={item.tab}
                  item={item}
                  active={activeTab === item.tab}
                  onIntent={() => prefetchDestination(item.to)}
                  badge={
                    item.tab === "you" ? (
                      <>
                        {!hasFitnessTools &&
                        goalDiscovery.isSuccess &&
                        goalDiscovery.data?.goal_seen_at == null ? (
                          <span
                            aria-label="New Fitness tools"
                            className="absolute right-[28%] top-1 h-2 w-2 rounded-full bg-primary ring-2 ring-background"
                          />
                        ) : null}
                      </>
                    ) : null
                  }
                />
              ))}
            </div>
          </nav>
          <LogSheet open={logOpen} onOpenChange={setLogOpen} />
        </>
      ) : null}
    </div>
  );
}

function TabLink({
  item,
  active,
  onIntent,
  badge,
}: {
  item: { tab: MainTab; label: string; to: string };
  active: boolean;
  onIntent: () => void;
  badge?: ReactNode;
}) {
  const Icon = TAB_ICONS[item.tab];
  return (
    <Link
      to={item.to}
      preload="intent"
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      onPointerDown={onIntent}
      onPointerEnter={onIntent}
      onFocus={onIntent}
      className={`relative flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 px-1 py-1 transition-[color,transform,opacity] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-95 active:opacity-80 ${active ? "text-primary" : "text-muted-foreground"}`}
    >
      <Icon className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
      <span className="max-w-full truncate text-[10px] font-medium">{item.label}</span>
      {badge}
    </Link>
  );
}

export function PageHeader({
  title,
  subtitle,
  backTo,
  backLabel = "Back",
  backParams,
  backOriginLabels,
  backSearch,
}: {
  title: string;
  subtitle?: string;
  /** Safe direct-entry fallback; an observed in-app origin takes precedence. */
  backTo?: string;
  backLabel?: string;
  /** Path params when backTo is a parameterised route (e.g. /challenge/activity/$activityId). */
  backParams?: Record<string, string>;
  /** Compatibility prop: all PageHeader Back links now use contextual history. */
  historyBack?: boolean;
  backSearch?: Record<string, unknown>;
  /** Optional labels for known origins when this page is shared by multiple areas. */
  backOriginLabels?: Readonly<Record<string, string>>;
}) {
  return (
    <header className="fade-up mb-5">
      {backTo ? (
        <HistoryBackLink
          fallback={backTo}
          fallbackLabel={backLabel}
          {...(backParams ? { fallbackParams: backParams } : {})}
          {...(backSearch ? { fallbackSearch: backSearch } : {})}
          {...(backOriginLabels ? { originLabels: backOriginLabels } : {})}
        />
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <h1 className="min-w-0 text-3xl font-semibold tracking-tight">{title}</h1>
        <NotificationBell />
      </div>
      {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
    </header>
  );
}

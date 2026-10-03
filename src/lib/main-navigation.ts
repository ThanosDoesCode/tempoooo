// Phase 1 navigation model: one bottom bar (Today · Challenge · + · Progress · You),
// a shared Log sheet, and centralized active-tab + focus-screen mapping. The old per-area
// dropdown (SecondaryNavigation) and the Training/Meals/Goal bottom tabs are removed; those
// routes stay reachable through Today, the Log sheet, deep links and redirect aliases.

export type MainTab = "today" | "challenge" | "progress" | "you";

/** The four real destination tabs, in bar order. The center "+" is an action, not a tab. */
export const MAIN_TABS = [
  { tab: "today", label: "Today", to: "/bulk" },
  { tab: "challenge", label: "Challenge", to: "/challenge" },
  { tab: "progress", label: "Progress", to: "/bulk/progress" },
  { tab: "you", label: "You", to: "/profile" },
] as const satisfies ReadonlyArray<{ tab: MainTab; label: string; to: string }>;

/**
 * Which bottom tab owns a path. Centralizes highlighting so no screen pretends a wrong tab
 * is active. Order matters: Progress owns training/meals *history* and the weekly review, so
 * those are matched before the broader Today-owned training/meals prefixes.
 */
export function mainTabForPath(pathname: string): MainTab | null {
  if (pathname.startsWith("/challenge") || pathname.startsWith("/invite/challenge/"))
    return "challenge";

  // Progress owns weight, training and nutrition history plus the weekly review.
  if (
    pathname === "/progress" ||
    pathname.startsWith("/progress/") ||
    pathname.startsWith("/bulk/progress") ||
    pathname.startsWith("/bulk/prs") ||
    pathname.startsWith("/bulk/check-in") ||
    pathname.startsWith("/bulk/training/history") ||
    pathname.startsWith("/bulk/training_/history") ||
    pathname.startsWith("/bulk/meals/history") ||
    pathname.startsWith("/bulk/meals_/history") ||
    pathname.startsWith("/bulk/history")
  )
    return "progress";

  // You owns the profile, goal settings, fitness setup and diagnostics.
  if (
    pathname === "/you" ||
    pathname.startsWith("/you/") ||
    pathname === "/profile" ||
    pathname.startsWith("/profile/") ||
    pathname.startsWith("/bulk/more") ||
    pathname.startsWith("/bulk/diagnostics") ||
    pathname === "/bulk-onboarding" ||
    pathname === "/bulk-access-denied" ||
    pathname.startsWith("/setup/")
  )
    return "you";

  // Today owns the daily screen plus Training and Meals (opened from Today / the Log sheet).
  if (
    pathname === "/today" ||
    pathname === "/bulk" ||
    pathname === "/bulk/morning" ||
    pathname === "/bulk/daily-log" ||
    pathname.startsWith("/bulk/training") ||
    pathname.startsWith("/bulk/meals") ||
    pathname.startsWith("/bulk/exercises") ||
    pathname.startsWith("/bulk/workout")
  )
    return "today";

  return null;
}

/**
 * Focus screens render without the bottom bar: landing/auth, account + fitness onboarding,
 * the create-challenge flow, and an active workout session. Delete account is a sheet, not a
 * route, so it is handled by its own component.
 */
export function isFocusScreen(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/auth" ||
    pathname === "/onboarding" ||
    pathname === "/bulk-onboarding" ||
    pathname === "/bulk-access-denied" ||
    pathname.startsWith("/setup/") ||
    pathname === "/challenge/new" ||
    pathname.startsWith("/challenge/new/") ||
    pathname.startsWith("/bulk/workout/")
  );
}

export type LogAction = {
  key: string;
  label: string;
  description: string;
  to: string;
  /** Search params to carry into the destination, e.g. preselecting Run vs Ride on Add activity. */
  search?: { type: "run" | "cycle" };
  group: "challenge" | "day";
};

/**
 * The shared Log sheet actions. Targets are the existing functional routes: Run/Ride -> the
 * Challenge "Add run or ride" screen (/challenge/add), the rest -> the current day flows.
 */
export const LOG_ACTIONS: readonly LogAction[] = [
  {
    key: "run",
    label: "Run",
    description: "1 km = 1 km",
    to: "/challenge/add",
    search: { type: "run" },
    group: "challenge",
  },
  {
    key: "ride",
    label: "Ride",
    description: "3 km = 1 km",
    to: "/challenge/add",
    search: { type: "cycle" },
    group: "challenge",
  },
  {
    key: "weigh-in",
    label: "Weigh-in & sleep",
    description: "Morning check-in, 30 seconds",
    to: "/bulk/morning",
    group: "day",
  },
  {
    key: "meal",
    label: "Meal",
    description: "From saved meals or a one-off",
    to: "/bulk/meals/add",
    group: "day",
  },
  {
    key: "workout",
    label: "Workout",
    description: "Sets, reps and weight",
    to: "/bulk/training",
    group: "day",
  },
] as const;

import type { HistoryLocation, RouterHistory } from "@tanstack/history";

type InAppLocation = Pick<HistoryLocation, "pathname" | "search" | "hash">;
const trails = new WeakMap<RouterHistory, Map<number, InAppLocation>>();

/** Only go back to entries observed by this app instance, never an external referrer. */
export function trackInAppHistory(history: RouterHistory) {
  if (trails.has(history)) return;
  const entries = new Map<number, InAppLocation>();
  trails.set(history, entries);
  const remember = () => {
    const { pathname, search, hash, state } = history.location;
    if (
      pathname.startsWith("/") &&
      !pathname.startsWith("//") &&
      Number.isInteger(state.__TSR_index)
    )
      entries.set(state.__TSR_index, { pathname, search, hash });
  };
  remember();
  history.subscribe(({ action }) => {
    if (action.type === "PUSH") {
      for (const index of entries.keys()) {
        if (index >= history.location.state.__TSR_index) entries.delete(index);
      }
    }
    remember();
  });
}

/** Query/hash are retained for link affordances as well as normal browser Back. */
export function inAppBackLocation(
  history: RouterHistory | undefined,
  parentPath?: string,
): InAppLocation | undefined {
  if (!history) return undefined;
  const previous = trails.get(history)?.get(history.location.state.__TSR_index - 1);
  if (!previous || (parentPath && previous.pathname !== parentPath)) return undefined;
  const path = previous.pathname;
  if (
    path === "/" ||
    path === "/auth" ||
    path.startsWith("/onboarding") ||
    path === "/bulk-onboarding" ||
    path.startsWith("/setup/")
  )
    return undefined;
  return previous;
}

/** Read the same safe origin used by Back, so shared pages can label their parent. */
export function inAppBackPath(
  history: RouterHistory | undefined,
  parentPath?: string,
): string | undefined {
  return inAppBackLocation(history, parentPath)?.pathname;
}

export function backWithinApp(history: RouterHistory | undefined, parentPath?: string): boolean {
  if (!history || !inAppBackLocation(history, parentPath)) return false;
  history.back();
  return true;
}

/** Labels for real route destinations, shared by every contextual Back control. */
export function inAppBackLabel(path: string): string | undefined {
  const labels: Readonly<Record<string, string>> = {
    "/bulk": "Today",
    "/today": "Today",
    "/profile": "You",
    "/you": "You",
    "/notifications": "Notifications",
    "/bulk/morning": "Morning check-in",
    "/bulk/training": "Training",
    "/bulk/training/more": "Your plan",
    "/bulk/training/history": "History",
    "/bulk/prs": "Personal records",
    "/bulk/exercises": "Exercise library",
    "/bulk/meals": "Meals",
    "/bulk/meals/add": "Add meal",
    "/bulk/meals/presets": "Meal presets",
    "/bulk/meals/history": "Nutrition history",
    "/bulk/progress": "Progress",
    "/progress": "Progress",
    "/bulk/progress/strength": "Strength",
    "/bulk/progress/endurance": "Endurance",
    "/bulk/progress/body": "Body & food",
    "/bulk/progress/body/food": "Food details",
    "/bulk/progress/photos": "Progress photos",
    "/bulk/check-in": "Weekly review",
    "/bulk/more": "Goal settings",
    "/bulk/history": "History",
    "/bulk/daily-log": "Today",
    "/bulk/diagnostics": "Diagnostics",
    "/challenge": "Challenge",
    "/challenge/terms": "Terms",
    "/challenge/rules": "Rules",
    "/challenge/targets": "Targets",
    "/challenge/money": "Money",
    "/challenge/payments": "Payments",
    "/challenge/history": "History",
    "/challenge/add": "Activity",
    "/challenge/terms/pause": "Travel pause",
    "/challenge/terms/override": "Weekly target",
  };
  if (labels[path]) return labels[path];
  if (path.startsWith("/challenge/activity/")) return "Activity";
  if (path.startsWith("/challenge/history/week/")) return "Finalized week";
  if (path.startsWith("/bulk/workout/")) return "Workout";
  if (path.startsWith("/bulk/progress/strength/")) return "Lift details";
  return undefined;
}

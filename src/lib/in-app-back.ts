import type { HistoryLocation, RouterHistory } from "@tanstack/history";

type InAppLocation = Pick<HistoryLocation, "pathname" | "search" | "hash">;
type Entry = { location: InAppLocation; key: string; revision: number; overlay: boolean };
const trails = new WeakMap<RouterHistory, Map<number, Entry>>();
const rememberedTrails = new Set<WeakRef<Map<number, Entry>>>();
const backHandlers = new WeakMap<
  RouterHistory,
  { dismiss: () => boolean; release?: () => Promise<void> }
>();
const pendingPops = new WeakMap<RouterHistory, string>();
const retiredPaths = new WeakMap<
  RouterHistory,
  Map<string, { revision: number; fallback: string }>
>();
let account: string | null | undefined;
let revision = 0;

declare module "@tanstack/history" {
  interface HistoryState {
    tempoOverlay?: string;
  }
}

/** Navigation origins belong to a document and identity, never to a subsequent account. */
export function observeNavigationIdentity(userId: string | null) {
  if (account !== undefined && account !== userId) {
    revision += 1;
    for (const reference of rememberedTrails) {
      const entries = reference.deref();
      if (entries) entries.clear();
      else rememberedTrails.delete(reference);
    }
  }
  account = userId;
}

export const navigationRevision = () => revision;
export const homeFallback = (fitness: boolean) => (fitness ? "/bulk" : "/challenge");

/** A successfully deleted screen is terminal for this document/account, including Forward. */
export function isRetiredInAppPath(history: RouterHistory | undefined, pathname: string): boolean {
  return !!history && retiredPaths.get(history)?.get(pathname)?.revision === revision;
}

/** Overlay/local-step ownership uses the same history, not a second route stack. */
export function registerBackHandler(
  history: RouterHistory,
  handler: () => boolean,
  release?: () => Promise<void>,
) {
  const owner = { dismiss: handler, ...(release ? { release } : {}) };
  backHandlers.set(history, owner);
  return () => {
    if (backHandlers.get(history) === owner) backHandlers.delete(history);
  };
}

/** Only go back to entries observed by this app instance, never an external referrer. */
export function trackInAppHistory(history: RouterHistory) {
  if (trails.has(history)) return;
  const entries = new Map<number, Entry>();
  let previousIndex = history.location.state.__TSR_index;
  trails.set(history, entries);
  rememberedTrails.add(new WeakRef(entries));
  const remember = () => {
    const { pathname, search, hash, state } = history.location;
    const key = state.__TSR_key ?? state.key;
    // A blocker can report the unchanged location after Keep editing. That also finishes the
    // attempted pop; the next explicit Back must be allowed to ask again.
    pendingPops.delete(history);
    if (
      pathname.startsWith("/") &&
      !pathname.startsWith("//") &&
      Number.isInteger(state.__TSR_index) &&
      key
    )
      entries.set(state.__TSR_index, {
        location: { pathname, search, hash },
        key,
        revision,
        overlay: !!state.tempoOverlay,
      });
  };
  remember();
  history.subscribe(({ action }) => {
    const fromIndex = previousIndex;
    previousIndex = history.location.state.__TSR_index;
    if (action.type === "PUSH") {
      for (const index of entries.keys()) {
        if (index >= history.location.state.__TSR_index) entries.delete(index);
      }
    }
    remember();
    if (
      (action.type === "BACK" || action.type === "FORWARD" || action.type === "GO") &&
      isRetiredInAppPath(history, history.location.pathname)
    ) {
      const currentIndex = history.location.state.__TSR_index;
      const direction = currentIndex > fromIndex ? 1 : -1;
      let index = currentIndex + direction;
      let target = entries.get(index);
      while (target?.revision === revision && isRetiredInAppPath(history, target.location.pathname))
        target = entries.get((index += direction));
      if (target?.revision === revision) history.go(index - currentIndex);
      else {
        const previous = entries.get(fromIndex);
        if (
          previous?.revision === revision &&
          !isRetiredInAppPath(history, previous.location.pathname)
        )
          history.go(fromIndex - currentIndex);
        else history.replace(retiredPaths.get(history)!.get(history.location.pathname)!.fallback);
      }
    }
  });
}

/** Query/hash are retained for link affordances as well as normal browser Back. */
function backEntry(
  history: RouterHistory | undefined,
  parentPath?: string,
): { location: InAppLocation; index: number } | undefined {
  if (!history) return undefined;
  const entries = trails.get(history);
  const state = history.location.state;
  const current = entries?.get(state.__TSR_index);
  if (!current || current.revision !== revision || current.key !== (state.__TSR_key ?? state.key))
    return undefined;
  // An overlay frame's immediate predecessor is its own underlying page, not that page's origin.
  let index = state.__TSR_index - (current.overlay ? 2 : 1);
  let previous = entries?.get(index);
  while (
    previous?.revision === revision &&
    (previous.overlay || isRetiredInAppPath(history, previous.location.pathname))
  )
    previous = entries?.get(--index);
  if (
    !previous ||
    previous.revision !== revision ||
    previous.key === current.key ||
    (parentPath && previous.location.pathname !== parentPath)
  )
    return undefined;
  const path = previous.location.pathname;
  if (
    path === "/" ||
    path === "/auth" ||
    path.startsWith("/onboarding") ||
    path === "/bulk-onboarding" ||
    path.startsWith("/setup/")
  )
    return undefined;
  return { location: previous.location, index };
}

export function inAppBackLocation(history: RouterHistory | undefined, parentPath?: string) {
  return backEntry(history, parentPath)?.location;
}

/** Read the same safe origin used by Back, so shared pages can label their parent. */
export function inAppBackPath(
  history: RouterHistory | undefined,
  parentPath?: string,
): string | undefined {
  return inAppBackLocation(history, parentPath)?.pathname;
}

export function backWithinApp(history: RouterHistory | undefined, parentPath?: string): boolean {
  if (!history) return false;
  if (backHandlers.get(history)?.dismiss()) return true;
  return popToOrigin(history, parentPath);
}

function popToOrigin(history: RouterHistory, parentPath?: string): boolean {
  if (pendingPops.get(history) === (history.location.state.__TSR_key ?? history.location.state.key))
    return true;
  const target = backEntry(history, parentPath);
  if (!target) return false;
  pendingPops.set(history, history.location.state.__TSR_key ?? history.location.state.key!);
  const delta = target.index - history.location.state.__TSR_index;
  if (delta === -1) history.back();
  else history.go(delta);
  return true;
}

type BackRouter = {
  history?: RouterHistory;
  navigate: (options: { href: string; replace: true }) => Promise<unknown>;
};

/** The imperative counterpart of HistoryBackLink. Completion skips transient overlay owners. */
export async function safeBack(
  router: BackRouter,
  fallback: string,
  {
    parentPath,
    completed = false,
    terminalPath,
  }: { parentPath?: string; completed?: boolean; terminalPath?: string } = {},
) {
  const history = router.history;
  const onTerminalScreen = history?.location.pathname === terminalPath;
  const origin = onTerminalScreen ? inAppBackLocation(history, parentPath) : undefined;
  if (completed && history && (!terminalPath || onTerminalScreen))
    await backHandlers.get(history)?.release?.();
  if (terminalPath && history) {
    const paths = retiredPaths.get(history) ?? new Map();
    paths.set(terminalPath, {
      revision,
      fallback: origin ? `${origin.pathname}${origin.search}${origin.hash}` : fallback,
    });
    retiredPaths.set(history, paths);
    // An overlay pop may already have left the screen. Never pop that destination again.
    if (history.location.pathname !== terminalPath) return;
  }
  if (
    history &&
    (completed ? popToOrigin(history, parentPath) : backWithinApp(history, parentPath))
  )
    return;
  await router.navigate({ href: fallback, replace: true });
}

/** Labels for real route destinations, shared by every contextual Back control. */
export function inAppBackLabel(path: string): string | undefined {
  const labels: Readonly<Record<string, string>> = {
    "/bulk": "Today",
    "/today": "Today",
    "/profile": "You",
    "/you": "You",
    "/community": "Community",
    "/notifications": "Notifications",
    "/bulk/morning": "Morning check-in",
    "/bulk/training": "Training",
    "/bulk/training/more": "Plan and setup",
    "/bulk/training/workouts": "My workouts",
    "/planner": "Planner",
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

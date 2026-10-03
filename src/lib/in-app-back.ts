import type { RouterHistory } from "@tanstack/history";

const trails = new WeakMap<RouterHistory, Map<number, string>>();

/** Only go back to entries observed by this app instance, never an external referrer. */
export function trackInAppHistory(history: RouterHistory) {
  if (trails.has(history)) return;
  const entries = new Map<number, string>();
  trails.set(history, entries);
  const remember = () => {
    const { pathname, state } = history.location;
    if (pathname.startsWith("/")) entries.set(state.__TSR_index, pathname);
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

export function backWithinApp(history: RouterHistory): boolean {
  const previous = trails.get(history)?.get(history.location.state.__TSR_index - 1);
  if (!previous || previous === "/auth" || previous.startsWith("/onboarding")) return false;
  history.back();
  return true;
}

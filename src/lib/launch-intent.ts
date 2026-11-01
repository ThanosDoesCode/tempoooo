/**
 * Home-screen launches open the start_url captured at install time: "/challenge" for installs made
 * before 2026-10-07 and for any build whose manifest still says so. The URL alone can't separate
 * that from a deliberate visit, so intent is explicit instead: notification URLs carry
 * `?from=notification`, other external links may carry any `from` marker, and invitations use
 * /invite/. Any other first route of a fresh installed-app session is a generic launch and goes to
 * /today (Today for full fitness, Challenge for core).
 *
 * A fresh session has no sessionStorage marker: it survives reloads and in-app navigation, but not
 * an app relaunch. Navigation Timing's type is not trusted for this; WebKit may report a relaunch
 * as a reload.
 */
export type LaunchKind =
  | "generic"
  | "notification"
  | "deep-link"
  | "reload"
  | "restore"
  | "in-app"
  | "browser"
  | "unknown";

const SESSION_KEY = "tempo:app-session";
/** Opt-in diagnostics: set localStorage["tempo:debug-launch"] = "1", relaunch, read "tempo:last-launch". */
export const LAUNCH_DEBUG_KEY = "tempo:debug-launch";
export const LAUNCH_RECORD_KEY = "tempo:last-launch";

let evaluated = false;

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function classify(url: URL, entry: PerformanceNavigationTiming | undefined): LaunchKind {
  if (!isStandalone()) return "browser";
  let returning: boolean;
  try {
    returning = sessionStorage.getItem(SESSION_KEY) !== null;
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    return "unknown";
  }
  const from = url.searchParams.get("from");
  if (from) return from === "notification" ? "notification" : "deep-link";
  if (url.pathname.startsWith("/invite/")) return "deep-link";
  if (entry?.type === "back_forward") return "restore";
  // The document opened elsewhere (/ or /auth) and the router then navigated here.
  if (entry && entry.name) {
    const initial = new URL(entry.name, url);
    if (initial.pathname + initial.search !== url.pathname + url.search) return "in-app";
  }
  return returning ? "reload" : "generic";
}

/** Classifies the document's first authenticated route; every later call is in-app navigation. */
export function classifyLaunch(href: string): LaunchKind {
  if (typeof window === "undefined") return "unknown";
  if (evaluated) return "in-app";
  evaluated = true;
  const url = new URL(href, window.location.origin);
  const entry = performance.getEntriesByType?.("navigation")[0] as
    PerformanceNavigationTiming | undefined;
  const kind = classify(url, entry);
  recordLaunch(() => ({
    // Paths, param names and origins only: no invite tokens, ids, auth fragments or referrer paths.
    pathname: url.pathname.replace(/^\/invite\/challenge\/[^/]+/, "/invite/challenge/:token"),
    searchKeys: [...url.searchParams.keys()].join(",") || "none",
    hash: url.hash !== "",
    referrer: document.referrer ? new URL(document.referrer).origin : "none",
    displayModeStandalone: window.matchMedia?.("(display-mode: standalone)").matches === true,
    navigatorStandalone: String((navigator as Navigator & { standalone?: boolean }).standalone),
    navigationType: entry?.type ?? "unavailable",
    historyStateKeys: Object.keys(window.history.state ?? {}).join(",") || "none",
    classification: kind,
    decision: normalizes(kind, url) ? "redirect /today" : "none",
  }));
  return kind;
}

const normalizes = (kind: LaunchKind, url: URL) => kind === "generic" && url.pathname !== "/today";

/** True only when the first route of a fresh installed-app session must be normalized to /today. */
export function isGenericLaunch(href: string) {
  return normalizes(classifyLaunch(href), new URL(href, "https://tempo.invalid"));
}

/** Debug-flag only. A record with `classification` starts a new launch; others (mode) merge in. */
export function recordLaunch(details: () => Record<string, string | boolean>) {
  try {
    if (localStorage.getItem(LAUNCH_DEBUG_KEY) !== "1") return;
    const next = details();
    const record =
      "classification" in next
        ? { ...next, at: new Date().toISOString() }
        : { ...JSON.parse(localStorage.getItem(LAUNCH_RECORD_KEY) ?? "{}"), ...next };
    localStorage.setItem(LAUNCH_RECORD_KEY, JSON.stringify(record));
    console.info("[tempo-launch]", record);
  } catch {
    // Diagnostics must never affect startup.
  }
}

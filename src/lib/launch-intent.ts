/**
 * The manifest start_url was "/challenge" from 2026-09-01 to 2026-10-07. Home-screen installs keep
 * the start_url captured at install time, so those installs still open exactly "/challenge" on a
 * cold launch. That launch is a generic "open the app", not a request for Challenge.
 *
 * Only this exact case is treated as generic: the document's first navigation (Navigation Timing
 * type "navigate" — not a reload or back/forward restore), in standalone display mode, whose
 * initial URL is exactly "/challenge" with no query or hash. Notification taps carry
 * `?from=notification`, invitations use their own paths/params, and in-app navigation never
 * reaches this check twice, so none of those are affected.
 */
export const LEGACY_START_URL = "/challenge";

let evaluated = false;

export function isLegacyGenericLaunch(href: string): boolean {
  if (evaluated || typeof window === "undefined") return false;
  evaluated = true; // only the document's first route resolution can be a launch
  if (href !== LEGACY_START_URL) return false;
  const entry = performance.getEntriesByType?.("navigation")[0] as
    PerformanceNavigationTiming | undefined;
  if (entry?.type !== "navigate") return false;
  let initial: URL;
  try {
    initial = new URL(entry.name);
  } catch {
    return false;
  }
  if (`${initial.pathname}${initial.search}${initial.hash}` !== LEGACY_START_URL) return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

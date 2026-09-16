/**
 * Keeps the page a signed-out visitor was trying to reach (an invitation link, above all)
 * across sign-up, sign-in, email confirmation and account onboarding.
 *
 * Stored in localStorage rather than sessionStorage so the destination survives a refresh,
 * an OAuth round trip and an email-confirmation link opened in a fresh tab.
 */
const KEY = "tempo:pending-destination";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Only same-origin absolute paths are ever stored or returned. */
export function sanitizeDestination(value: string | null | undefined): string | null {
  if (!value || value.length > 512) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, "http://tempo.local");
    const path = `${url.pathname}${url.search}${url.hash}`;
    if (path === "/" || path.startsWith("/auth") || path.startsWith("/onboarding")) return null;
    return path;
  } catch {
    return null;
  }
}

export function rememberDestination(value: string | null | undefined) {
  const path = sanitizeDestination(value);
  if (!path) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ path, savedAt: Date.now() }));
  } catch {
    /* storage unavailable: the ?redirect search param still carries the destination */
  }
}

export function readDestination(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { path?: unknown; savedAt?: unknown };
    if (typeof parsed.savedAt !== "number" || Date.now() - parsed.savedAt > MAX_AGE_MS) {
      clearDestination();
      return null;
    }
    return sanitizeDestination(typeof parsed.path === "string" ? parsed.path : null);
  } catch {
    return null;
  }
}

export function clearDestination() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clean up */
  }
}

/** Resolves where to send the user after authentication, preferring an explicit search param. */
export function takeDestination(fromSearch?: string | null): string | null {
  const path = sanitizeDestination(fromSearch) ?? readDestination();
  if (path) clearDestination();
  return path;
}

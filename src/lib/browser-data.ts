type BrowserStorage = Pick<Storage, "key" | "length" | "removeItem">;

const ACCOUNT_SCOPED_LOCAL_PREFIXES = ["tempo:bulk-workout-draft:", "training-draft:"];
const ACCOUNT_SCOPED_SESSION_PREFIXES = ["challenge-activity-draft:"];

function removeByPrefix(storage: BrowserStorage | null | undefined, prefixes: string[]) {
  if (!storage) return;
  try {
    const matches: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && prefixes.some((prefix) => key.startsWith(prefix))) matches.push(key);
    }
    matches.forEach((key) => storage.removeItem(key));
  } catch {
    // Browser storage may be unavailable in restrictive/private modes.
  }
}

/** Remove private drafts on a real account change without touching Supabase auth storage. */
export function clearAccountScopedBrowserData(
  local: BrowserStorage | null | undefined = typeof window === "undefined"
    ? null
    : window.localStorage,
  session: BrowserStorage | null | undefined = typeof window === "undefined"
    ? null
    : window.sessionStorage,
) {
  removeByPrefix(local, ACCOUNT_SCOPED_LOCAL_PREFIXES);
  removeByPrefix(session, ACCOUNT_SCOPED_SESSION_PREFIXES);
  try {
    local?.removeItem("saved-credentials");
  } catch {
    // This obsolete credential key is best-effort cleanup only.
  }
}

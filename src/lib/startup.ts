export type StartupReadiness = {
  sessionRestored: boolean;
  routePending: boolean;
  pathname: string;
  sessionUserId: string | null;
};

/** Keeps the launch cover up until auth and the initial protected route agree. */
export function canDismissStartupScreen({
  sessionRestored,
  routePending,
  pathname,
  sessionUserId,
}: StartupReadiness) {
  if (!sessionRestored || routePending) return false;

  // The auth route redirects an already signed-in user after syncing their profile.
  // Keeping the cover mounted avoids briefly exposing the sign-in form during that handoff.
  return !(pathname === "/auth" && sessionUserId !== null);
}

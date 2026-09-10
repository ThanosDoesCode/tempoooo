export const STARTUP_DEADLINE_MS = 12_000;
export const STARTUP_READ_DEADLINE_MS = 10_000;

export type StartupPhase = "restoring" | "ready" | "recoverable-error" | "signed-out";

export type StartupReadiness = {
  sessionRestored: boolean;
  routePending: boolean;
  pathname: string;
  sessionUserId: string | null;
  recoverableError?: boolean;
};

export function resolveStartupPhase({
  sessionRestored,
  routePending,
  pathname,
  sessionUserId,
  recoverableError = false,
}: StartupReadiness): StartupPhase {
  if (recoverableError) return "recoverable-error";
  if (!sessionRestored || routePending) return "restoring";

  // The auth route redirects an already signed-in user after syncing their profile.
  // The startup deadline makes this handoff finite if its reads never settle.
  if (pathname === "/auth" && sessionUserId !== null) return "restoring";
  return sessionUserId === null ? "signed-out" : "ready";
}

/** Backwards-compatible predicate used by launch-cover consumers. */
export function canDismissStartupScreen(readiness: StartupReadiness) {
  return resolveStartupPhase(readiness) !== "restoring";
}

export class StartupTimeoutError extends Error {
  readonly phase: string;

  constructor(phase: string) {
    super(`Tempo startup timed out while restoring ${phase}`);
    this.name = "StartupTimeoutError";
    this.phase = phase;
  }
}

/** Prevents a single SDK/network promise from holding a route beforeLoad forever. */
export function withStartupDeadline<T>(
  promise: Promise<T>,
  phase: string,
  onTimeout?: () => void,
  timeoutMs = STARTUP_READ_DEADLINE_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const deadline = setTimeout(() => {
      if (settled) return;
      settled = true;
      onTimeout?.();
      reject(new StartupTimeoutError(phase));
    }, timeoutMs);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        reject(error);
      },
    );
  });
}

export function startupDiagnostic(
  phase:
    | "auth_resolved"
    | "profile_resolved"
    | "memberships_resolved"
    | "mode_resolved"
    | "onboarding_resolved"
    | "startup_cover_hidden",
  details: Record<string, boolean | string> = {},
) {
  if (import.meta.env?.DEV) console.info("[tempo-startup]", { phase, ...details });
}

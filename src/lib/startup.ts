export const STARTUP_DEADLINE_MS = 12_000;
export const STARTUP_READ_DEADLINE_MS = 10_000;

export type StartupPhase = "restoring" | "ready" | "recoverable-error" | "signed-out";

export type StartupDeadlineState = {
  startupComplete: boolean;
  sessionRestored: boolean;
  recoverableError: boolean;
};

/** Local session restoration is not route readiness. Cover the entire cold attempt. */
export function shouldArmStartupDeadline({
  startupComplete,
  recoverableError,
}: StartupDeadlineState) {
  return !startupComplete && !recoverableError;
}

export type StartupReadiness = {
  startupComplete?: boolean;
  sessionRestored: boolean;
  routePending: boolean;
  pathname: string;
  sessionUserId: string | null;
  recoverableError?: boolean;
};

export function resolveStartupPhase({
  startupComplete = false,
  sessionRestored,
  routePending,
  pathname,
  sessionUserId,
  recoverableError = false,
}: StartupReadiness): StartupPhase {
  // Startup is a one-way lifecycle for the current document. Once the first
  // route has resolved, later route transitions and query refetches must not
  // put the app back behind the cold-launch cover.
  if (startupComplete) return sessionUserId === null ? "signed-out" : "ready";
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
      // A failing cancellation callback must never strand the wrapper promise.
      try {
        onTimeout?.();
      } catch {
        // Recovery still belongs to the caller, even if cleanup itself failed.
      }
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

type StartupDiagnosticPhase =
  | "auth_resolved"
  | "profile_resolved"
  | "memberships_resolved"
  | "mode_resolved"
  | "onboarding_resolved"
  | "startup_begin"
  | "session_restored"
  | "auth_validation_begin"
  | "profile_begin"
  | "route_handoff_recovered"
  | "route_ready"
  | "startup_ready"
  | "startup_error"
  | "startup_timeout"
  | "startup_retry";

let diagnosticAttempt = 0;
let diagnosticStart = Date.now();

export function startupDiagnostic(
  phase: StartupDiagnosticPhase,
  details: Record<string, boolean | string | number> = {},
) {
  // Reuse the explicit launch-debug opt-in, including production iPhone PWAs.
  try {
    if (typeof window === "undefined" || window.localStorage.getItem("tempo:debug-launch") !== "1")
      return;
    console.info("[tempo-startup]", {
      phase,
      attempt: diagnosticAttempt,
      elapsedMs: Math.max(0, Date.now() - diagnosticStart),
      ...details,
    });
  } catch {
    // Diagnostics/storage availability must never affect startup.
  }
}

export type StartupSnapshot = {
  attempt: number;
  phase: StartupPhase | "recoverable-timeout";
  sessionRestored: boolean;
  sessionUserId: string | null;
};

type StartupClock = {
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
};

/** One terminal result per cold attempt. Owned by the shell, outside route Suspense/errors. */
export class StartupLifecycle {
  private snapshot: StartupSnapshot = {
    attempt: 0,
    phase: "restoring",
    sessionRestored: false,
    sessionUserId: null,
  };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private expiresAt = 0;
  private active = false;
  private clock: StartupClock;
  constructor(
    clock: StartupClock = {
      now: Date.now,
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (timer) => clearTimeout(timer),
    },
  ) {
    this.clock = clock;
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(snapshot: StartupSnapshot) {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }
  private clearDeadline() {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }
  begin() {
    this.clearDeadline();
    this.active = true;
    const attempt = this.snapshot.attempt + 1;
    diagnosticAttempt = attempt;
    diagnosticStart = Date.now();
    this.expiresAt = this.clock.now() + STARTUP_DEADLINE_MS;
    this.publish({ attempt, phase: "restoring", sessionRestored: false, sessionUserId: null });
    this.timer = this.clock.setTimeout(this.checkDeadline, STARTUP_DEADLINE_MS);
    startupDiagnostic("startup_begin", { state: "restoring" });
    return attempt;
  }
  retry() {
    if (!this.snapshot.phase.startsWith("recoverable-")) return null;
    const attempt = this.begin();
    startupDiagnostic("startup_retry", { state: "restoring" });
    return attempt;
  }
  isCurrent(attempt: number) {
    this.checkDeadline();
    return this.active && attempt === this.snapshot.attempt && this.snapshot.phase === "restoring";
  }
  session(attempt: number, userId: string | null) {
    this.checkDeadline();
    if (!this.isCurrent(attempt)) return;
    this.publish({ ...this.snapshot, sessionRestored: true, sessionUserId: userId });
    startupDiagnostic("session_restored", { signedIn: userId !== null });
  }
  route(attempt: number, routePending: boolean, pathname: string) {
    this.checkDeadline();
    if (!this.isCurrent(attempt)) return;
    const phase = resolveStartupPhase({ ...this.snapshot, routePending, pathname });
    if (phase === "restoring") return;
    this.clearDeadline();
    this.publish({ ...this.snapshot, phase });
    startupDiagnostic("route_ready");
    startupDiagnostic("startup_ready", { state: phase });
  }
  fail(attempt: number) {
    this.checkDeadline();
    if (!this.isCurrent(attempt)) return;
    this.clearDeadline();
    this.publish({ ...this.snapshot, phase: "recoverable-error" });
    startupDiagnostic("startup_error", { state: "recoverable-error" });
  }
  checkDeadline = () => {
    if (!this.active || this.snapshot.phase !== "restoring" || this.clock.now() < this.expiresAt)
      return;
    this.clearDeadline();
    this.publish({ ...this.snapshot, phase: "recoverable-timeout" });
    startupDiagnostic("startup_timeout", { state: "recoverable-timeout" });
  };
  stop() {
    this.active = false;
    this.clearDeadline();
  }
}

type StartupRouter = {
  history: {
    location: { href: string };
    subscribe: (listener: () => void) => () => void;
  };
  state: { location: { publicHref: string } };
  load: () => Promise<unknown>;
};

/**
 * Start can redirect an ssr:false guard before Transitioner subscribes to history.
 * The URL changes but no destination load starts. Reconcile only a missed cold
 * handoff, after normal router subscribers have had their turn. Never choose a URL.
 */
export function watchStartupRedirects(router: StartupRouter, startup: StartupLifecycle) {
  let active = true;
  let repaired = "";
  const check = () => {
    queueMicrotask(() => {
      const attempt = startup.getSnapshot().attempt;
      if (!active || !startup.isCurrent(attempt)) return;
      const href = router.history.location.href;
      if (href === router.state.location.publicHref) return;
      const key = `${attempt}:${href}`;
      if (key === repaired) return;
      repaired = key;
      startupDiagnostic("route_handoff_recovered");
      void router.load().catch(() => startup.fail(attempt));
    });
  };
  const unsubscribe = router.history.subscribe(check);
  check();
  return () => {
    active = false;
    unsubscribe();
  };
}

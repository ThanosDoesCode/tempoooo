import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { ChallengePushSession } from "../components/ChallengePushSession";
import { Toaster } from "../components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { observeAuthIdentity, readStartupSession } from "@/lib/auth";
import { clearBulk } from "@/lib/store";
import { AppCrashBoundary } from "@/components/AppCrashBoundary";
import { QueryCancellationRecovery } from "@/components/QueryCancellationRecovery";
import {
  authenticatedUserChanged,
  isExpectedQueryCancellation,
  recoverChallengeRoute,
  resetUserScopedQueries,
} from "@/lib/query-cancellation";
import { clearAccountScopedBrowserData } from "@/lib/browser-data";
import { isOffline } from "@/lib/network-errors";
import { StartupLifecycle, watchStartupRedirects } from "@/lib/startup";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const cancelled = isExpectedQueryCancellation(error);
  useEffect(() => {
    if (!cancelled) {
      console.error(error);
      reportLovableError(error, { boundary: "tanstack_root_error_component" });
    }
  }, [cancelled, error]);

  if (cancelled) {
    return (
      <QueryCancellationRecovery
        onRecover={() => {
          reset();
          void router.invalidate();
        }}
      />
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Tempo" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Tempo" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      {
        name: "description",
        content:
          "A focused two-person 52-week running and cycling challenge with weekly targets and penalties.",
      },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "Tempo" },
      {
        property: "og:description",
        content:
          "A focused two-person 52-week running and cycling challenge with weekly targets and penalties.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "Tempo" },
      {
        name: "twitter:description",
        content:
          "A focused two-person 52-week running and cycling challenge with weekly targets and penalties.",
      },
      {
        property: "og:image",
        content: "https://trexavlaka.lovable.app/icons/challenge-512.png",
      },
      {
        name: "twitter:image",
        content: "https://trexavlaka.lovable.app/icons/challenge-512.png",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: "/icons/apple-touch-icon.png",
      },
    ],
  }),
  shellComponent: RootShell,
  // Keep root suspension inside the persistent shell (and its cold-start watchdog).
  wrapInSuspense: true,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { queryClient } = router.options.context;
  const [startup] = useState(() => new StartupLifecycle());
  const snapshot = useSyncExternalStore(
    startup.subscribe,
    startup.getSnapshot,
    startup.getSnapshot,
  );
  const authEventRevision = useRef(0);
  const previousUserId = useRef<string | null | undefined>(undefined);
  const route = useRouterState({
    select: (state) => ({
      pending: state.status === "pending" || state.isLoading,
      pathname: state.location.pathname,
      failed: state.matches.some(
        (match) => match.status === "error" && !isExpectedQueryCancellation(match.error),
      ),
    }),
  });
  const startupCoverVisible = snapshot.phase === "restoring";
  const startupFailed = snapshot.phase.startsWith("recoverable-");

  const restoreSession = useCallback(
    (attempt: number) => {
      const revision = authEventRevision.current;
      void readStartupSession()
        .then(({ data }) => {
          if (revision !== authEventRevision.current || !startup.isCurrent(attempt)) return;
          const userId = data.session?.user.id ?? null;
          observeAuthIdentity(userId);
          previousUserId.current = userId;
          startup.session(attempt, userId);
        })
        .catch(() => {
          if (revision === authEventRevision.current) startup.fail(attempt);
        });
    },
    [startup],
  );

  useEffect(() => {
    // The shell survives route pending/error boundaries. A route must not own its own watchdog.
    const attempt = startup.begin();
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      authEventRevision.current += 1;
      const nextUserId = session?.user.id ?? null;
      observeAuthIdentity(nextUserId);
      startup.session(startup.getSnapshot().attempt, nextUserId);
      if (!authenticatedUserChanged(previousUserId.current, nextUserId)) {
        previousUserId.current = nextUserId;
        return;
      }
      previousUserId.current = nextUserId;
      clearAccountScopedBrowserData();
      clearBulk();
      const eventRevision = authEventRevision.current;
      const eventAttempt = startup.getSnapshot().attempt;
      void resetUserScopedQueries(queryClient).catch(() => {
        if (eventRevision === authEventRevision.current) startup.fail(eventAttempt);
      });
    });
    restoreSession(attempt);
    // WebKit may suspend timers in the background. Check the absolute deadline on return.
    document.addEventListener("visibilitychange", startup.checkDeadline);
    window.addEventListener("pageshow", startup.checkDeadline);
    return () => {
      data.subscription.unsubscribe();
      startup.stop();
      document.removeEventListener("visibilitychange", startup.checkDeadline);
      window.removeEventListener("pageshow", startup.checkDeadline);
    };
  }, [queryClient, restoreSession, startup]);

  useEffect(() => {
    if (route.failed) startup.fail(snapshot.attempt);
    else startup.route(snapshot.attempt, route.pending, route.pathname);
  }, [
    startup,
    snapshot.attempt,
    snapshot.sessionRestored,
    snapshot.sessionUserId,
    route.failed,
    route.pending,
    route.pathname,
  ]);

  const retryStartup = () => {
    // Synchronous generation change makes rapid double taps a single retry.
    const attempt = startup.retry();
    if (attempt === null) return;
    restoreSession(attempt);
    void router.invalidate().catch(() => startup.fail(attempt));
  };

  return (
    <StartupContext.Provider value={startup}>
      <html lang="en" data-tempo-ready={startupCoverVisible ? undefined : "true"}>
        <head>
          <HeadContent />
        </head>
        <body>
          <div className="tempo-startup" role="status" aria-label="Loading Tempo">
            <div className="tempo-startup-content">
              <div className="tempo-startup-ring" aria-hidden="true">
                <span className="tempo-startup-mark">T</span>
              </div>
              <span className="tempo-startup-label">Loading Tempo</span>
            </div>
          </div>
          {startupFailed ? (
            <main className="fixed inset-0 z-[101] grid place-items-center bg-background px-6 text-center">
              <div className="w-full max-w-sm" role="alert">
                <div className="mx-auto grid size-16 place-items-center rounded-full border border-primary/30 text-3xl font-extrabold italic text-primary">
                  T
                </div>
                <h1 className="mt-5 text-xl font-semibold text-foreground">
                  Tempo couldn&apos;t start
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {isOffline()
                    ? "You're offline. Reconnect and retry. Your session and saved data are unchanged."
                    : "Check your connection and retry. Your session and saved data are unchanged."}
                </p>
                <button
                  type="button"
                  onClick={retryStartup}
                  className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground active:opacity-80"
                >
                  Retry
                </button>
              </div>
            </main>
          ) : (
            children
          )}
          <Scripts />
        </body>
      </html>
    </StartupContext.Provider>
  );
}

const StartupContext = createContext<StartupLifecycle | null>(null);

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const startup = useContext(StartupContext);
  useEffect(() => {
    // Wait for the root content's hydration commit before repairing an early redirect.
    return startup ? watchStartupRedirects(router, startup) : undefined;
  }, [router, startup]);
  return (
    <QueryClientProvider client={queryClient}>
      <AppCrashBoundary
        onRetry={() => {
          void queryClient.refetchQueries({ type: "active" });
        }}
        onChallengeHome={() =>
          recoverChallengeRoute(
            (options) => router.navigate(options),
            () => router.invalidate(),
          )
        }
      >
        <ChallengePushSession />
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
        <Toaster position="bottom-center" />
      </AppCrashBoundary>
    </QueryClientProvider>
  );
}

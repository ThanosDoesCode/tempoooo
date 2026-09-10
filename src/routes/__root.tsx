import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { ChallengePushSession } from "../components/ChallengePushSession";
import { Toaster } from "../components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
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
import { resolveStartupPhase, STARTUP_DEADLINE_MS, startupDiagnostic } from "@/lib/startup";

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

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
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
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
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
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const routePending = useRouterState({ select: (state) => state.status === "pending" });
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const previousUserId = useRef<string | null | undefined>(undefined);
  const startupDismissed = useRef(false);
  const [startupAttempt, setStartupAttempt] = useState(0);
  const [startupError, setStartupError] = useState<Error | null>(null);
  const [startupSession, setStartupSession] = useState<{
    restored: boolean;
    userId: string | null;
  }>({ restored: false, userId: null });

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user.id ?? null;
      setStartupSession({ restored: true, userId: nextUserId });
      if (!authenticatedUserChanged(previousUserId.current, nextUserId)) {
        previousUserId.current = nextUserId;
        return;
      }
      previousUserId.current = nextUserId;
      clearAccountScopedBrowserData();
      clearBulk();
      void resetUserScopedQueries(queryClient);
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  useEffect(() => {
    let active = true;
    setStartupSession({ restored: false, userId: null });
    void supabase.auth
      .getSession()
      .then(({ data: sessionData, error }) => {
        if (!active) return;
        if (error) throw error;
        setStartupSession({ restored: true, userId: sessionData.session?.user.id ?? null });
        startupDiagnostic("auth_resolved", { signedIn: !!sessionData.session?.user });
      })
      .catch((error: unknown) => {
        if (active) setStartupError(error instanceof Error ? error : new Error("Session failed"));
      });
    return () => {
      active = false;
    };
  }, [startupAttempt]);

  const startupPhase = resolveStartupPhase({
    sessionRestored: startupSession.restored,
    sessionUserId: startupSession.userId,
    routePending,
    pathname,
    recoverableError: startupError !== null,
  });

  useEffect(() => {
    if (startupPhase !== "restoring") return;
    const deadline = window.setTimeout(() => {
      void queryClient.cancelQueries({
        predicate: ({ queryKey }) =>
          queryKey[0] === "authenticated-user" ||
          queryKey[0] === "account-profile" ||
          queryKey[0] === "bulk-memberships" ||
          queryKey[0] === "goal-discovery",
      });
      setStartupError(new Error("Tempo startup timed out"));
    }, STARTUP_DEADLINE_MS);
    return () => window.clearTimeout(deadline);
  }, [queryClient, startupAttempt, startupPhase]);

  useEffect(() => {
    if (startupDismissed.current || startupPhase === "restoring") return;

    const frame = window.requestAnimationFrame(() => {
      document.documentElement.dataset["tempoReady"] = "true";
      startupDismissed.current = true;
      startupDiagnostic("startup_cover_hidden", { state: startupPhase });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [startupPhase]);

  const retryStartup = () => {
    startupDismissed.current = false;
    delete document.documentElement.dataset["tempoReady"];
    setStartupError(null);
    setStartupAttempt((attempt) => attempt + 1);
    void router.invalidate();
  };

  return (
    <QueryClientProvider client={queryClient}>
      {startupPhase === "recoverable-error" ? (
        <main className="fixed inset-0 z-[101] grid place-items-center bg-background px-6 text-center">
          <div className="w-full max-w-sm" role="alert">
            <div className="mx-auto grid size-16 place-items-center rounded-full border border-primary/30 text-3xl font-extrabold italic text-primary">
              T
            </div>
            <h1 className="mt-5 text-xl font-semibold text-foreground">
              Tempo couldn&apos;t start
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Check your connection and retry. Your session and saved data are unchanged.
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
      )}
    </QueryClientProvider>
  );
}

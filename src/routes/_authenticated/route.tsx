import {
  createFileRoute,
  Outlet,
  redirect,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { authenticatedUserQueryOptions, syncProfile } from "@/lib/auth";
import { accountProfileQueryOptions } from "@/lib/account-profile";
import { DataError } from "@/components/ui-kit";
import { isNetworkError, userFacingError } from "@/lib/network-errors";
import { reportLovableError } from "@/lib/lovable-error-reporting";
import { useEffect } from "react";
import { accountProductMode, bulkOwnerQueryOptions } from "@/lib/bulk-access";
import { isExpectedQueryCancellation } from "@/lib/query-cancellation";
import { QueryCancellationRecovery } from "@/components/QueryCancellationRecovery";
import { startupDiagnostic, withStartupDeadline } from "@/lib/startup";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ context, location }) => {
    const user = await withStartupDeadline(
      context.queryClient.ensureQueryData(authenticatedUserQueryOptions()),
      "authentication",
      () => {
        void context.queryClient.cancelQueries({ queryKey: ["authenticated-user"], exact: true });
      },
    );
    if (!user) throw redirect({ to: "/auth" });
    startupDiagnostic("auth_resolved", { signedIn: true });
    const [initialProfile, memberships] = await Promise.all([
      withStartupDeadline(
        context.queryClient.ensureQueryData(accountProfileQueryOptions(user.id)),
        "profile",
        () => {
          void context.queryClient.cancelQueries({
            queryKey: ["account-profile", user.id],
            exact: true,
          });
        },
      ),
      withStartupDeadline(
        context.queryClient.ensureQueryData(bulkOwnerQueryOptions()),
        "memberships",
        () => {
          void context.queryClient.cancelQueries({ queryKey: ["bulk-memberships"], exact: true });
        },
      ),
    ]);
    startupDiagnostic("profile_resolved", { present: initialProfile !== null });
    startupDiagnostic("memberships_resolved", { present: memberships.length > 0 });
    startupDiagnostic("mode_resolved", { mode: accountProductMode(memberships) });
    let profile = initialProfile;
    if (!profile) {
      await withStartupDeadline(syncProfile(user), "profile sync");
      await context.queryClient.invalidateQueries({ queryKey: ["account-profile", user.id] });
      profile = await withStartupDeadline(
        context.queryClient.fetchQuery(accountProfileQueryOptions(user.id)),
        "profile refresh",
        () => {
          void context.queryClient.cancelQueries({
            queryKey: ["account-profile", user.id],
            exact: true,
          });
        },
      );
      startupDiagnostic("profile_resolved", { present: profile !== null });
    }
    const onboardingRequired = !profile?.account_onboarded_at || !profile.username;
    startupDiagnostic("onboarding_resolved", { required: onboardingRequired });
    if (onboardingRequired && location.pathname !== "/onboarding") {
      throw redirect({ to: "/onboarding" });
    }
    return { user };
  },
  component: AuthenticatedLayout,
  errorComponent: AuthenticatedRouteError,
});

function AuthenticatedRouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const cancelled = isExpectedQueryCancellation(error);
  useEffect(() => {
    if (!cancelled && !isNetworkError(error)) {
      console.error(error);
      reportLovableError(error, { boundary: "authenticated_startup_route" });
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
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <DataError
          message={userFacingError(error, "restore your Tempo session")}
          onRetry={() => {
            reset();
            void router.invalidate();
          }}
        />
      </div>
    </main>
  );
}

function AuthenticatedLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

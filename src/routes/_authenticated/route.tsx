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
import { bulkOwnerQueryOptions } from "@/lib/bulk-access";
import { isExpectedQueryCancellation } from "@/lib/query-cancellation";
import { QueryCancellationRecovery } from "@/components/QueryCancellationRecovery";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ context, location }) => {
    const user = await context.queryClient.ensureQueryData(authenticatedUserQueryOptions());
    if (!user) throw redirect({ to: "/auth" });
    const [initialProfile] = await Promise.all([
      context.queryClient.ensureQueryData(accountProfileQueryOptions(user.id)),
      context.queryClient.ensureQueryData(bulkOwnerQueryOptions()),
    ]);
    let profile = initialProfile;
    if (!profile) {
      await syncProfile(user);
      await context.queryClient.invalidateQueries({ queryKey: ["account-profile", user.id] });
      profile = await context.queryClient.fetchQuery(accountProfileQueryOptions(user.id));
    }
    const onboardingRequired = !profile?.account_onboarded_at || !profile.username;
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

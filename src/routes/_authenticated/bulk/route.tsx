import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { bulkOwnerQueryOptions, preferredBulkMembership, useMemberships } from "@/lib/bulk-access";
import { clearBulk, loadBulk, prefetchBulk, useBulkMeta } from "@/lib/store";
import { AppShell, PageHeader } from "@/components/AppShell";
import { DataError } from "@/components/ui-kit";
import { userFacingError } from "@/lib/network-errors";
import { isExpectedQueryCancellation } from "@/lib/query-cancellation";
import { QueryCancellationRecovery } from "@/components/QueryCancellationRecovery";

export const Route = createFileRoute("/_authenticated/bulk")({
  beforeLoad: async ({ context }) => {
    const preferred = preferredBulkMembership(
      await context.queryClient.ensureQueryData(bulkOwnerQueryOptions()),
    );
    if (!preferred) throw redirect({ to: "/bulk-onboarding", replace: true });
    await prefetchBulk(preferred.bulk_profile_id);
  },
  component: BulkLayout,
  errorComponent: BulkRouteError,
});

function BulkRouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  if (isExpectedQueryCancellation(error)) {
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
    <AppShell>
      <PageHeader title="Plan unavailable" />
      <DataError
        message={userFacingError(error, "load your plan")}
        onRetry={() => {
          reset();
          void router.invalidate();
        }}
      />
    </AppShell>
  );
}

function BulkLayout() {
  const navigate = useNavigate();
  const { data: memberships, isLoading } = useMemberships();
  const { bulkId } = useBulkMeta();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!memberships) return;
    const preferred = preferredBulkMembership(memberships);
    if (!preferred) {
      clearBulk();
      void navigate({ to: "/bulk-onboarding", replace: true });
      return;
    }
    if (preferred.bulk_profile_id !== bulkId) {
      loadBulk(preferred.bulk_profile_id, preferred.role).catch((e: Error) =>
        setError(userFacingError(e, "load your plan")),
      );
    }
  }, [memberships, bulkId, navigate]);

  if (error) {
    return (
      <AppShell>
        <PageHeader title="Plan unavailable" />
        <DataError
          message={error}
          onRetry={() => {
            setError(null);
            const preferred = preferredBulkMembership(memberships);
            if (preferred)
              void loadBulk(preferred.bulk_profile_id, preferred.role).catch((e: Error) =>
                setError(userFacingError(e, "load your plan")),
              );
          }}
        />
      </AppShell>
    );
  }
  const preferred = preferredBulkMembership(memberships);
  if (memberships && !preferred) return null;
  if (
    isLoading ||
    (!memberships && !error) ||
    (preferred && bulkId !== preferred.bulk_profile_id)
  ) {
    return (
      <div className="space-y-3" aria-label="Loading plan">
        <div className="h-24 animate-pulse rounded-2xl bg-card" />
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      </div>
    );
  }
  return <Outlet />;
}

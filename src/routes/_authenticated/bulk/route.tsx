import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { bulkOwnerQueryOptions, useMemberships } from "@/lib/bulk-access";
import { clearBulk, loadBulk, prefetchBulk, useBulkMeta } from "@/lib/store";
import { AppShell, PageHeader } from "@/components/AppShell";
import { DataError } from "@/components/ui-kit";
import { userFacingError } from "@/lib/network-errors";
import { isExpectedQueryCancellation } from "@/lib/query-cancellation";
import { QueryCancellationRecovery } from "@/components/QueryCancellationRecovery";

export const Route = createFileRoute("/_authenticated/bulk")({
  beforeLoad: async ({ context }) => {
    const owners = await context.queryClient.ensureQueryData(bulkOwnerQueryOptions());
    if (!owners.length) throw redirect({ to: "/bulk-onboarding", replace: true });
    await prefetchBulk(owners[0]!.bulk_profile_id);
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
    if (memberships.length === 0) {
      clearBulk();
      void navigate({ to: "/bulk-onboarding", replace: true });
      return;
    }
    const preferred = memberships[0]!;
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
            if (memberships?.[0])
              void loadBulk(memberships[0].bulk_profile_id, memberships[0].role).catch((e: Error) =>
                setError(userFacingError(e, "load your plan")),
              );
          }}
        />
      </AppShell>
    );
  }
  if (memberships?.length === 0) return null;
  if (isLoading || (!memberships && !error) || (!!memberships?.length && !bulkId)) {
    return (
      <div className="mx-auto w-full max-w-lg space-y-3 p-4">
        <div className="h-24 animate-pulse rounded-2xl bg-card" />
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      </div>
    );
  }
  return <Outlet />;
}

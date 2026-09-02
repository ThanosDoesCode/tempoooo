import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { bulkOwnerQueryOptions, useMemberships } from "@/lib/bulk-access";
import { loadBulk, useBulkMeta } from "@/lib/store";

export const Route = createFileRoute("/_authenticated/bulk")({
  beforeLoad: async ({ context }) => {
    const owners = await context.queryClient.fetchQuery({
      ...bulkOwnerQueryOptions(),
      staleTime: 0,
    });
    if (!owners.length) throw redirect({ to: "/bulk-access-denied", replace: true });
  },
  component: BulkLayout,
});

function BulkLayout() {
  const { data: memberships, isLoading } = useMemberships();
  const { bulkId } = useBulkMeta();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!memberships) return;
    if (memberships.length === 0) return;
    const preferred = memberships[0]!;
    if (preferred.bulk_profile_id !== bulkId) {
      loadBulk(preferred.bulk_profile_id, preferred.role).catch((e: Error) => setError(e.message));
    }
  }, [memberships, bulkId]);

  if (error) {
    return <div className="p-6 text-sm text-danger">{error}</div>;
  }
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

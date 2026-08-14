import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMemberships } from "@/lib/bulk-access";
import { loadBulk, useBulkMeta } from "@/lib/store";

export const Route = createFileRoute("/_authenticated/bulk")({
  component: BulkLayout,
});

function BulkLayout() {
  const navigate = useNavigate();
  const { data: memberships, isLoading } = useMemberships();
  const { bulkId } = useBulkMeta();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!memberships) return;
    if (memberships.length === 0) {
      void navigate({ to: "/challenge" });
      return;
    }
    const preferred =
      memberships.find((m) => m.role === "owner") ?? (memberships[0] as (typeof memberships)[0]);
    if (preferred.bulk_profile_id !== bulkId) {
      loadBulk(preferred.bulk_profile_id, preferred.role).catch((e: Error) =>
        setError(e.message),
      );
    }
  }, [memberships, bulkId, navigate]);

  if (error) {
    return <div className="p-6 text-sm text-danger">{error}</div>;
  }
  if (isLoading || !bulkId) {
    return (
      <div className="mx-auto w-full max-w-lg space-y-3 p-4">
        <div className="h-24 animate-pulse rounded-2xl bg-card" />
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      </div>
    );
  }
  return <Outlet />;
}

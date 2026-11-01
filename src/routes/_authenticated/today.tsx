import { createFileRoute, redirect } from "@tanstack/react-router";
import { accountProductMode, bulkOwnerQueryOptions } from "@/lib/bulk-access";

import { withStartupDeadline } from "@/lib/startup";

// Canonical home URL. Goal accounts land on the daily screen at /bulk; Challenge-only
// accounts have no daily screen yet, so they land on the Challenge instead of Goal setup.
export const Route = createFileRoute("/_authenticated/today")({
  beforeLoad: async ({ context }) => {
    const memberships = await withStartupDeadline(
      context.queryClient.ensureQueryData(bulkOwnerQueryOptions()),
      "memberships",
    );
    if (accountProductMode(memberships) === "core") {
      throw redirect({ to: "/challenge", replace: true });
    }
    throw redirect({ to: "/bulk", replace: true });
  },
});

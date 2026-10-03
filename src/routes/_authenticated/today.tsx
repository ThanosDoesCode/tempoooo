import { createFileRoute, redirect } from "@tanstack/react-router";

// New canonical Today URL. Phase 1 reuses the existing daily screen at /bulk.
export const Route = createFileRoute("/_authenticated/today")({
  beforeLoad: () => {
    throw redirect({ to: "/bulk", replace: true });
  },
});

import { createFileRoute, redirect } from "@tanstack/react-router";

// New canonical Progress URL. Phase 1 reuses the existing progress screen.
export const Route = createFileRoute("/_authenticated/progress")({
  beforeLoad: () => {
    throw redirect({ to: "/bulk/progress", replace: true });
  },
});

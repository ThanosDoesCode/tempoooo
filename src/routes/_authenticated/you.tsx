import { createFileRoute, redirect } from "@tanstack/react-router";

// New canonical You URL. Phase 1 reuses the existing profile screen.
export const Route = createFileRoute("/_authenticated/you")({
  beforeLoad: () => {
    throw redirect({ to: "/profile", replace: true });
  },
});

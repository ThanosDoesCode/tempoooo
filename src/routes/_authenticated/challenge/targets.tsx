import { createFileRoute, redirect } from "@tanstack/react-router";

// Targets merged into Terms. Changing a single week now lives at /challenge/terms/override.
export const Route = createFileRoute("/_authenticated/challenge/targets")({
  beforeLoad: () => {
    throw redirect({ to: "/challenge/terms/override", replace: true });
  },
});

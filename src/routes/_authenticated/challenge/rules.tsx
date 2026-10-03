import { createFileRoute, redirect } from "@tanstack/react-router";

// There is one canonical rules screen now: Terms. Keep the old /challenge/rules deep link working.
export const Route = createFileRoute("/_authenticated/challenge/rules")({
  beforeLoad: () => {
    throw redirect({ to: "/challenge/terms", replace: true });
  },
});

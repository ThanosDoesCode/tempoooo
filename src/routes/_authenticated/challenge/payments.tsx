import { createFileRoute, redirect } from "@tanstack/react-router";

// Money is canonical at /challenge/money. Keep the old /challenge/payments deep link working.
export const Route = createFileRoute("/_authenticated/challenge/payments")({
  beforeLoad: () => {
    throw redirect({ to: "/challenge/money", replace: true });
  },
});

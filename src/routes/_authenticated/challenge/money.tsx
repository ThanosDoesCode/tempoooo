import { createFileRoute, redirect } from "@tanstack/react-router";

// "Money" is the Phase 1 name for Payments. Keep the canonical page at /challenge/payments.
export const Route = createFileRoute("/_authenticated/challenge/money")({
  beforeLoad: () => {
    throw redirect({ to: "/challenge/payments", replace: true });
  },
});

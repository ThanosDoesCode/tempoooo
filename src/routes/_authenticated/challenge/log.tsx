import { createFileRoute, redirect } from "@tanstack/react-router";

// "Add a run or ride" is canonical at /challenge/add. Keep the old /challenge/log deep link working.
export const Route = createFileRoute("/_authenticated/challenge/log")({
  beforeLoad: () => {
    throw redirect({ to: "/challenge/add", replace: true });
  },
});

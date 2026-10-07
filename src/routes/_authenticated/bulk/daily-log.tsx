import { createFileRoute, redirect } from "@tanstack/react-router";

// Preserve old bookmarks without exposing the obsolete daily editor.
export const Route = createFileRoute("/_authenticated/bulk/daily-log")({
  beforeLoad: () => {
    throw redirect({ to: "/bulk", replace: true });
  },
});

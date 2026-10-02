import { createFileRoute, redirect } from "@tanstack/react-router";

// Preserve old bookmarks while removing the empty Meal tools destination.
export const Route = createFileRoute("/_authenticated/bulk/meals_/more")({
  beforeLoad: () => {
    throw redirect({ to: "/bulk/meals/presets", replace: true });
  },
});

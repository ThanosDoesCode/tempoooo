import { createFileRoute } from "@tanstack/react-router";
import { CommunityPage } from "@/components/Community";

export const Route = createFileRoute("/_authenticated/community")({
  validateSearch: (search: Record<string, unknown>): { q: string | undefined } => ({
    q: typeof search["q"] === "string" ? search["q"].slice(0, 21) : undefined,
  }),
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: CommunityScreen,
});
function CommunityScreen() {
  const { q } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <CommunityPage
      search={q ?? ""}
      onSearchChange={(value) => {
        // Typing updates local screen context, never adds a browser Back destination.
        void navigate({ search: { q: value || undefined }, replace: true, resetScroll: false });
      }}
    />
  );
}

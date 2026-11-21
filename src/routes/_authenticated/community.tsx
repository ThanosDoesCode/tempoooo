import { createFileRoute } from "@tanstack/react-router";
import { CommunityPage } from "@/components/Community";

export const Route = createFileRoute("/_authenticated/community")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { q: string | undefined; section?: "plans" | undefined } => ({
    q: typeof search["q"] === "string" ? search["q"].slice(0, 21) : undefined,
    ...(search["section"] === "plans" ? { section: "plans" as const } : {}),
  }),
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: CommunityScreen,
});
function CommunityScreen() {
  const { q, section } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <CommunityPage
      search={q ?? ""}
      section={section ?? "friends"}
      onSectionChange={(value) =>
        void navigate({
          search: (previous) => ({ ...previous, section: value === "plans" ? "plans" : undefined }),
          replace: true,
          resetScroll: false,
        })
      }
      onSearchChange={(value) => {
        // Typing updates local screen context, never adds a browser Back destination.
        void navigate({
          search: (previous) => ({ ...previous, q: value || undefined }),
          replace: true,
          resetScroll: false,
        });
      }}
    />
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { CommunityProfilePage } from "@/components/Community";

export const Route = createFileRoute("/_authenticated/community_/$userId")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: CommunityProfileScreen,
});
function CommunityProfileScreen() {
  return <CommunityProfilePage userId={Route.useParams().userId} />;
}

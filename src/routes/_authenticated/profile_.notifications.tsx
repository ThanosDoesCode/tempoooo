import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/AppShell";
import { ChallengeNotifications } from "@/components/ChallengeNotifications";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/profile_/notifications")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const { user } = useAuth();
  return (
    <AppShell>
      <PageHeader title="Notifications" backTo="/profile" backLabel="Profile" />
      {user ? <ChallengeNotifications key={user.id} userId={user.id} /> : null}
    </AppShell>
  );
}

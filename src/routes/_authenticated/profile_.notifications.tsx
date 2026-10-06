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
      <PageHeader title="Notifications" backTo="/profile" backLabel="You" />
      {user ? <ChallengeNotifications userId={user.id} expanded /> : null}
      <p className="mt-4 text-[13px] leading-5 text-muted-foreground">
        Tempo only asks for browser permission when you choose Enable notifications. Disable on all
        devices turns off Challenge notifications for your account.
      </p>
    </AppShell>
  );
}

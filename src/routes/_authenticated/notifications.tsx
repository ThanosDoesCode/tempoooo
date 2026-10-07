import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/AppShell";
import { AccountNotificationInbox } from "@/components/AccountNotificationInbox";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: NotificationInbox,
});

function NotificationInbox() {
  return (
    <AppShell>
      <PageHeader title="Notifications" backTo="/bulk" backLabel="Today" />
      <AccountNotificationInbox />
    </AppShell>
  );
}

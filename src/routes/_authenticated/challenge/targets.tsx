import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, Note, SectionTitle } from "@/components/ui-kit";
import { useMyChallenge } from "@/lib/challenge";

export const Route = createFileRoute("/_authenticated/challenge/targets")({
  head: () => ({
    meta: [
      { title: "Weekly target — Tempo" },
      {
        name: "description",
        content: "The Challenge weekly target is fixed at 15 qualifying challenge kilometres.",
      },
    ],
  }),
  component: Targets,
});

function Targets() {
  const { data: challenge } = useMyChallenge();

  return (
    <AppShell>
      <PageHeader title="Weekly target" subtitle="The target is fixed by the Challenge rules." />
      {!challenge ? (
        <Note>You are not part of a challenge yet.</Note>
      ) : (
        <Card>
          <SectionTitle>15 challenge km</SectionTitle>
          <p className="text-sm text-muted-foreground">
            Every active week uses the same 15 km target and fixed penalty tiers. Extra kilometres
            never carry into the next week.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            If you travel outside Greece or Sweden, you can pause your own challenge week from the
            Money page. That week is penalty-free for you; your opponent stays active.
          </p>
          <Link
            to="/challenge/payments"
            className="mt-4 block w-full rounded-xl bg-primary py-2.5 text-center text-sm font-semibold text-primary-foreground"
          >
            Open Money and travel settings
          </Link>
        </Card>
      )}
    </AppShell>
  );
}

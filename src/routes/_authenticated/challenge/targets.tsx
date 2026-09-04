import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/AppShell";
import { ChallengeTermsSummary } from "@/components/challenge-rules";
import { Card, Note, SectionTitle } from "@/components/ui-kit";
import { useMyChallenge } from "@/lib/challenge";

export const Route = createFileRoute("/_authenticated/challenge/targets")({
  head: () => ({
    meta: [
      { title: "Tempo" },
      {
        name: "description",
        content:
          "The Challenge weekly target and penalty consequences are fixed when it is created.",
      },
    ],
  }),
  component: Targets,
});

function Targets() {
  const { data: challenge } = useMyChallenge();

  return (
    <AppShell>
      <PageHeader
        title="Weekly target"
        subtitle="The agreed terms are locked for this Challenge."
      />
      {!challenge ? (
        <Note>You are not part of a challenge yet.</Note>
      ) : (
        <Card>
          <SectionTitle>{Number(challenge.weekly_target_km)} challenge km</SectionTitle>
          <p className="text-sm text-muted-foreground">
            Every active week uses this target and the consequences agreed when the Challenge was
            created. Extra kilometres never carry into the next week.
          </p>
          <div className="mt-3">
            <ChallengeTermsSummary terms={challenge} />
          </div>
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

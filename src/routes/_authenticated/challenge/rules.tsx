import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/AppShell";
import { RulesCard } from "@/components/challenge-rules";
import { DataError, Note } from "@/components/ui-kit";
import { useMyChallenge } from "@/lib/challenge";

export const Route = createFileRoute("/_authenticated/challenge/rules")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: ChallengeRulesPage,
});

function ChallengeRulesPage() {
  const query = useMyChallenge();
  return (
    <AppShell>
      <PageHeader title="Challenge rules" backTo="/challenge" backLabel="Challenge" />
      {query.isLoading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-card" aria-label="Loading rules" />
      ) : query.error ? (
        <DataError
          message="Challenge rules could not be loaded."
          onRetry={() => void query.refetch()}
        />
      ) : query.data ? (
        <RulesCard terms={query.data} />
      ) : (
        <Note>Join or create a Challenge to see its agreed rules.</Note>
      )}
    </AppShell>
  );
}

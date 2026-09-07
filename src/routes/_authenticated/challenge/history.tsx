import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, DataError, Note, SectionTitle } from "@/components/ui-kit";
import { useAuth } from "@/lib/auth";
import { owedText, useChallengeMembers, useMyChallenge, useWeeks } from "@/lib/challenge";
import { countryName } from "@/lib/countries";

export const Route = createFileRoute("/_authenticated/challenge/history")({
  head: () => ({
    meta: [
      { title: "Tempo" },
      {
        name: "description",
        content:
          "Locked weekly results for both athletes: equivalent kilometres, completion and penalties, calculated on the server.",
      },
      { property: "og:title", content: "Tempo" },
      { property: "og:description", content: "Immutable finalized weeks and penalties." },
    ],
  }),
  component: History,
});

function History() {
  const { user } = useAuth();
  const challengeQuery = useMyChallenge();
  const { data: challenge, isLoading: challengeLoading, error: challengeError } = challengeQuery;
  const membersQuery = useChallengeMembers(challenge?.id);
  const { data: members, error: membersError } = membersQuery;
  const weeksQuery = useWeeks(challenge?.id);
  const { data: weeks, isLoading: weeksLoading, error: weeksError } = weeksQuery;

  const byWeek = new Map<number, typeof weeks>();
  (weeks ?? []).forEach((w) => {
    const list = byWeek.get(w.week_number) ?? [];
    byWeek.set(w.week_number, [...(list ?? []), w]);
  });
  const numbers = [...byWeek.keys()].sort((a, b) => b - a);

  const name = (id: string) =>
    id === user?.id ? "Me" : (members?.find((m) => m.userId === id)?.name ?? "Athlete");

  return (
    <AppShell>
      <PageHeader title="History" subtitle="Finalized weeks are locked and cannot be edited." />
      {challengeLoading || (challenge && weeksLoading) ? (
        <div className="space-y-3" aria-label="Loading weekly history">
          <div className="h-28 animate-pulse rounded-2xl bg-card" />
          <div className="h-28 animate-pulse rounded-2xl bg-card" />
        </div>
      ) : null}
      {challengeError || membersError || weeksError ? (
        <DataError
          message="Your finalized results are unchanged. Check your connection and try again."
          onRetry={() => {
            void Promise.all(
              challenge
                ? [challengeQuery.refetch(), membersQuery.refetch(), weeksQuery.refetch()]
                : [challengeQuery.refetch()],
            );
          }}
        />
      ) : null}
      {!challengeLoading && !challengeError && !challenge ? (
        <Note>Join or create a challenge before weekly history can appear.</Note>
      ) : null}
      {challenge && !weeksLoading && !weeksError && numbers.length === 0 ? (
        <Note>
          No finalized weeks yet. Results and penalties appear here after the first Sunday closes.
        </Note>
      ) : null}
      <div className="space-y-3">
        {numbers.map((n) => (
          <Link
            key={n}
            to="/challenge/history/week/$weekNumber"
            params={{ weekNumber: String(n) }}
            preload="intent"
            resetScroll={false}
            className="block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Card>
              <SectionTitle
                right={
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    {byWeek.get(n)?.[0]?.week_start} to {byWeek.get(n)?.[0]?.week_end} · target{" "}
                    {formatTarget(byWeek.get(n)?.[0]?.target_km ?? challenge?.weekly_target_km)} km
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </span>
                }
              >
                Week {n}
              </SectionTitle>
              <div className="space-y-2">
                {(byWeek.get(n) ?? []).map((w) => (
                  <div
                    key={w.id}
                    className="flex items-center justify-between rounded-xl border border-border bg-elevated px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{name(w.user_id)}</span>
                    <span className="num text-muted-foreground">
                      {w.paused
                        ? `Paused · ${w.pause_country ? countryName(w.pause_country) : "travel"}`
                        : `${Number(w.equivalent_km).toFixed(1)} / ${Number(w.target_km).toFixed(0)} km`}
                    </span>
                    <span className={w.completed || w.paused ? "text-good" : "text-warn"}>
                      {w.paused
                        ? "No penalty"
                        : w.completed
                          ? "Completed"
                          : w.penalty_mode === "custom"
                            ? (w.penalty_consequence ?? "Custom consequence")
                            : owedText(Number(w.penalty_eur), challenge?.legacy_photo_owed)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}

function formatTarget(value: number | string | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(Number(value));
}

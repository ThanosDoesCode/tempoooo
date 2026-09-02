import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, Note, SectionTitle } from "@/components/ui-kit";
import { useAuth } from "@/lib/auth";
import { owedText, useChallengeMembers, useMyChallenge, useWeeks } from "@/lib/challenge";

export const Route = createFileRoute("/_authenticated/challenge/history")({
  head: () => ({
    meta: [
      { title: "Weekly history — Tempo" },
      {
        name: "description",
        content:
          "Locked weekly results for both athletes: equivalent kilometres, completion and penalties, calculated on the server.",
      },
      { property: "og:title", content: "Weekly history — Tempo" },
      { property: "og:description", content: "Immutable finalized weeks and penalties." },
    ],
  }),
  component: History,
});

function History() {
  const { user } = useAuth();
  const { data: challenge } = useMyChallenge();
  const { data: members } = useChallengeMembers(challenge?.id);
  const { data: weeks } = useWeeks(challenge?.id);

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
      {numbers.length === 0 ? <Note>No weeks have closed yet.</Note> : null}
      <div className="space-y-3">
        {numbers.map((n) => (
          <Card key={n}>
            <SectionTitle
              right={
                <span className="text-xs text-muted-foreground">
                  {byWeek.get(n)?.[0]?.week_start} to {byWeek.get(n)?.[0]?.week_end} · target{" "}
                  {Number(byWeek.get(n)?.[0]?.target_km ?? 15).toFixed(0)} km
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
                      ? `Paused · ${w.pause_country ?? "travel"}`
                      : `${Number(w.equivalent_km).toFixed(1)} / ${Number(w.target_km).toFixed(0)} km`}
                  </span>
                  <span className={w.completed || w.paused ? "text-good" : "text-warn"}>
                    {w.paused ? "€0" : w.completed ? "Completed" : owedText(Number(w.penalty_eur))}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}

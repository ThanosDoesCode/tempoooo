import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, Note, SectionTitle } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

import { finalizeChallenge } from "@/lib/privileged-rpcs.functions";
import {
  eur,
  hoursLeft,
  km,
  penaltyFor,
  sumWeek,
  todayIn,
  useActivities,
  useChallengeMembers,
  useMyChallenge,
  weekBounds,
  weekNumberOf,
} from "@/lib/challenge";
import { RulesCard } from "@/components/challenge-rules";
import { ChallengeInviteCard } from "@/components/ChallengeInvite";


export const Route = createFileRoute("/_authenticated/challenge/")({
  head: () => ({
    meta: [
      { title: "This week — Challenge" },
      {
        name: "description",
        content:
          "Track this week's equivalent kilometres, live penalty and remaining distance in your private two-person endurance challenge.",
      },
      { property: "og:title", content: "This week — Challenge" },
      {
        property: "og:description",
        content: "15 equivalent km per week, running and cycling, tiered penalties.",
      },
    ],
  }),
  component: ChallengeHome,
});

function ChallengeHome() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: challenge, isLoading } = useMyChallenge();
  const { data: members } = useChallengeMembers(challenge?.id);
  const { data: activities } = useActivities(challenge?.id);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const removeActivity = async (id: string) => {
    setConfirmId(null);
    setDeleteError(null);
    const { error } = await supabase.from("challenge_activities").delete().eq("id", id);
    if (error) setDeleteError(error.message);
    await qc.invalidateQueries({ queryKey: ["challenge-activities"] });
  };


  // Lazy, deterministic server-side finalization of any closed weeks.
  useEffect(() => {
    if (challenge) void finalizeChallenge({ data: { challenge: challenge.id } });
  }, [challenge]);

  const week = useMemo(() => {
    if (!challenge) return null;
    const n = weekNumberOf(challenge, todayIn(challenge.timezone));
    return { n, ...weekBounds(challenge, n), hours: hoursLeft(challenge, n) };
  }, [challenge]);

  if (isLoading) {
    return (
      <AppShell>
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      </AppShell>
    );
  }

  if (!challenge) {
    return (
      <AppShell>
        <PageHeader title="Challenge" subtitle="A private two-person endurance bet." />
        <RulesCard />
        <div className="mt-4 grid gap-2">
          <Link
            to="/challenge/new"
            className="rounded-xl bg-primary py-3 text-center text-sm font-semibold text-primary-foreground"
          >
            Create a challenge
          </Link>
          <Note>
            Joining is invite-only. If a friend invited you, open the invitation link they sent.
          </Note>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title={challenge.name}
        subtitle={`Week ${week?.n} of ${challenge.duration_weeks} · ${challenge.timezone}`}
      />

      <Card>
        <SectionTitle right={<span className="text-xs text-muted-foreground">Mon to Sun</span>}>
          This week
        </SectionTitle>
        <p className="num text-3xl font-semibold">
          {week ? Math.floor(week.hours / 24) : 0}d {week ? Math.floor(week.hours % 24) : 0}h
        </p>
        <p className="text-xs text-muted-foreground">
          remaining · closes Sunday 23:59 {challenge.timezone}
        </p>
      </Card>

      <div className="mt-3 space-y-3">
        {(members ?? []).map((m) => {
          const totals = week
            ? sumWeek(activities ?? [], m.userId, week.start, week.end)
            : { running: 0, cycling: 0, equivalent: 0, rows: [] };
          const pct = Math.min(100, (totals.equivalent / 15) * 100);
          const done = totals.equivalent >= 15;
          const tone = done ? "bg-good" : "bg-warn";
          return (
            <Card key={m.userId}>
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-semibold">
                  {m.userId === user?.id ? "Me" : m.name}
                </h3>
                <span className="num text-sm">
                  {totals.equivalent.toFixed(1)} / 15 km
                </span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-elevated">
                <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className={done ? "text-good" : "text-muted-foreground"}>
                  {done ? "Completed ✓" : `${(15 - totals.equivalent).toFixed(1)} km remaining`}
                </span>
                <span className={done ? "text-good" : "text-warn"}>
                  Current penalty: {eur(penaltyFor(totals.equivalent))}
                </span>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Run {km(totals.running)} · Cycle {km(totals.cycling)}
              </p>
            </Card>
          );
        })}
        {(members?.length ?? 0) < 2 ? (
          <>
            <Note>Waiting for your opponent to accept the invitation.</Note>
            {challenge.created_by === user?.id ? (
              <ChallengeInviteCard challengeId={challenge.id} />
            ) : null}
          </>
        ) : null}

      </div>

      <div className="mt-4">
        <Link
          to="/challenge/log"
          className="block rounded-xl bg-primary py-3 text-center text-sm font-semibold text-primary-foreground"
        >
          Add activity
        </Link>
      </div>

      <div className="mt-5">
        <SectionTitle>Recent activity</SectionTitle>
        <div className="space-y-2">
          {(activities ?? []).slice(0, 12).map((a) => {
            const who = members?.find((m) => m.userId === a.user_id);
            return (
              <Card key={a.id} className="p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm">
                    <span className="font-semibold">
                      {a.user_id === user?.id ? "Me" : (who?.name ?? "Athlete")}
                    </span>{" "}
                    {a.activity_type === "run" ? "ran" : "cycled"} {Number(a.distance_km).toFixed(1)}{" "}
                    km
                  </p>
                  <span className="num text-xs text-muted-foreground">{a.activity_date}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    Equivalent {Number(a.equivalent_km).toFixed(2)} km · Evidence attached
                    {a.edited ? " · Edited" : ""}
                  </p>
                  {a.user_id === user?.id &&
                  week &&
                  a.activity_date >= week.start &&
                  a.activity_date <= week.end ? (
                    <button
                      onClick={() => {
                        if (confirmId === a.id) void removeActivity(a.id);
                        else setConfirmId(a.id);
                      }}
                      className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium ${
                        confirmId === a.id
                          ? "bg-danger text-primary-foreground"
                          : "text-danger hover:bg-danger/10"
                      }`}
                    >
                      {confirmId === a.id ? "Confirm delete" : "Delete"}
                    </button>
                  ) : null}
                </div>
              </Card>

            );
          })}
          {deleteError ? <p className="text-xs text-danger">{deleteError}</p> : null}
          {(activities?.length ?? 0) === 0 ? <Note>No activities logged yet.</Note> : null}

        </div>
      </div>
    </AppShell>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Bike, Footprints, Link as LinkIcon } from "lucide-react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, Note, SectionTitle } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

import { finalizeChallenge } from "@/lib/privileged-rpcs.functions";
import {
  eur,
  hoursLeft,
  leaveChallenge,
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
  const [leaveArmed, setLeaveArmed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const groupedActivities = useMemo(() => {
    const map = new Map<string, typeof activities>();
    for (const a of (activities ?? []).slice(0, 20)) {
      const list = map.get(a.activity_date) ?? [];
      list.push(a);
      map.set(a.activity_date, list);
    }
    return [...map.entries()] as [string, NonNullable<typeof activities>][];
  }, [activities]);



  const doLeave = async () => {
    if (!challenge) return;
    setLeaving(true);
    setLeaveError(null);
    try {
      await leaveChallenge(challenge.id);
      await qc.invalidateQueries();
      setLeaveArmed(false);
    } catch (e) {
      setLeaveError((e as Error).message);
    } finally {
      setLeaving(false);
    }
  };

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
        {(members?.length ?? 0) < (challenge.max_members ?? 2) ? (
          <>
            <Note>
              There is still a free spot. Send an invitation link to add another person.
            </Note>
            <ChallengeInviteCard challengeId={challenge.id} />

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
        <div className="space-y-4">
          {groupedActivities.map(([day, rows]) => (
            <div key={day}>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {formatDay(day)}
              </p>
              <div className="space-y-2">
                {rows.map((a) => {
                  const who = members?.find((m) => m.userId === a.user_id);
                  const mine = a.user_id === user?.id;
                  const canDelete =
                    mine && week && a.activity_date >= week.start && a.activity_date <= week.end;
                  return (
                    <Card key={a.id} className="p-3">
                      <div className="flex items-start gap-3">
                        <span
                          className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
                            a.activity_type === "run"
                              ? "bg-primary/15 text-primary"
                              : "bg-chart-2/15 text-[color:var(--chart-2)]"
                          }`}
                        >
                          {a.activity_type === "run" ? (
                            <Footprints className="h-4 w-4" />
                          ) : (
                            <Bike className="h-4 w-4" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="num text-base font-semibold">
                              {Number(a.distance_km).toFixed(1)} km
                              <span className="ml-1.5 text-xs font-normal capitalize text-muted-foreground">
                                {a.activity_type === "run" ? "run" : "ride"}
                              </span>
                            </p>
                            <span className="num shrink-0 text-xs font-medium text-muted-foreground">
                              = {Number(a.equivalent_km).toFixed(2)} eq
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {mine ? "Me" : (who?.name ?? "Athlete")}
                            {a.duration_seconds
                              ? ` · ${Math.round(a.duration_seconds / 60)} min`
                              : ""}
                            {a.edited ? " · Edited" : ""}
                          </p>
                          {a.note ? (
                            <p className="mt-2 rounded-lg bg-elevated px-2.5 py-1.5 text-xs leading-relaxed text-foreground/90">
                              {a.note}
                            </p>
                          ) : null}
                          <div className="mt-2 flex items-center justify-between gap-2">
                            {a.external_activity_url ? (
                              <a
                                href={a.external_activity_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary"
                              >
                                <LinkIcon className="h-3 w-3" /> Strava
                              </a>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">
                                Evidence attached
                              </span>
                            )}
                            {canDelete ? (
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
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
          {deleteError ? <p className="text-xs text-danger">{deleteError}</p> : null}
          {(activities?.length ?? 0) === 0 ? <Note>No activities logged yet.</Note> : null}
        </div>
      </div>


      <div className="mt-6">
        <SectionTitle>Leave challenge</SectionTitle>
        <Card>
          <p className="text-xs text-muted-foreground">
            Leaving removes you from {challenge.name}. Your logged activities stay in the record and
            you can create a brand new challenge with someone else straight away.
          </p>
          <button
            onClick={() => {
              if (!leaveArmed) {
                setLeaveArmed(true);
                return;
              }
              void doLeave();
            }}
            disabled={leaving}
            className={`mt-3 w-full rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60 ${
              leaveArmed
                ? "bg-danger text-primary-foreground"
                : "border border-danger/40 text-danger"
            }`}
          >
            {leaving ? "Leaving…" : leaveArmed ? "Confirm and leave" : "Leave this challenge"}
          </button>
          {leaveError ? <p className="mt-2 text-xs text-danger">{leaveError}</p> : null}
        </Card>
      </div>
    </AppShell>

  );
}

function formatDay(day: string) {
  return format(parseISO(day), "EEEE d MMM");
}

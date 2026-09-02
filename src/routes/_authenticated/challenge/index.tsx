import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import {
  Bike,
  ChevronRight,
  Footprints,
  Image as ImageIcon,
  Link as LinkIcon,
  MoreHorizontal,
  Plus,
  Trash2,
  Trophy,
} from "lucide-react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, DataError, Note, PendingLabel, SectionTitle } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

import { finalizeChallenge } from "@/lib/privileged-rpcs.functions";
import {
  activityMetrics,
  DEFAULT_TARGET_KM,
  formatPace,
  hoursLeft,
  leaveChallenge,
  km,
  owedText,
  paymentsQueryOptions,
  penaltyFor,
  qualifiedEquivalentKm,
  sumWeek,
  todayIn,
  useActivities,
  useChallengeMembers,
  useMyChallenge,
  useTravelPauses,
  weeksQueryOptions,
  weekPaused,
  weekBounds,
  weekNumberOf,
} from "@/lib/challenge";
import { ChallengePrimer } from "@/components/challenge-rules";
import { ChallengeInviteCard } from "@/components/ChallengeInvite";
import { ChallengeNotifications } from "@/components/ChallengeNotifications";

export const Route = createFileRoute("/_authenticated/challenge/")({
  head: () => ({
    meta: [
      { title: "This week — Tempo" },
      {
        name: "description",
        content:
          "Track this week's equivalent kilometres, live penalty and remaining distance in your private two-person endurance challenge.",
      },
      { property: "og:title", content: "This week — Tempo" },
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
  const challengeQuery = useMyChallenge();
  const { data: challenge, isLoading, error: challengeError } = challengeQuery;
  const membersQuery = useChallengeMembers(challenge?.id);
  const { data: members, isLoading: membersLoading, error: membersError } = membersQuery;
  const activitiesQuery = useActivities(challenge?.id);
  const {
    data: activities,
    isLoading: activitiesLoading,
    error: activitiesError,
  } = activitiesQuery;
  const pausesQuery = useTravelPauses(challenge?.id);
  const { data: travelPauses, isLoading: pausesLoading, error: pausesError } = pausesQuery;
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [activityMessage, setActivityMessage] = useState<string | null>(null);
  const [leaveArmed, setLeaveArmed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const doLeave = async () => {
    if (!challenge) return;
    setLeaving(true);
    setLeaveError(null);
    try {
      await leaveChallenge(challenge.id);
      await qc.invalidateQueries({
        predicate: (query) => String(query.queryKey[0]).startsWith("challenge"),
      });
      setLeaveArmed(false);
    } catch (e) {
      setLeaveError(`Could not leave the challenge. ${(e as Error).message}`);
    } finally {
      setLeaving(false);
    }
  };

  const removeActivity = async (id: string) => {
    setDeletingId(id);
    setDeleteError(null);
    setActivityMessage(null);
    try {
      const { error } = await supabase.from("challenge_activities").delete().eq("id", id);
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["challenge-activities"] });
      setConfirmId(null);
      setActivityMessage("Activity deleted.");
    } catch (error) {
      setDeleteError(`Could not delete activity. ${(error as Error).message}`);
    } finally {
      setDeletingId(null);
    }
  };

  // Lazy, deterministic server-side finalization of any closed weeks.
  useEffect(() => {
    if (challenge) void finalizeChallenge({ data: { challenge: challenge.id } });
  }, [challenge]);

  // The default screen warms the two small secondary datasets used by History and Money.
  useEffect(() => {
    if (!challenge) return;
    void qc.prefetchQuery(weeksQueryOptions(challenge.id));
    void qc.prefetchQuery(paymentsQueryOptions(challenge.id));
  }, [challenge, qc]);

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

  if (challengeError && !challenge) {
    return (
      <AppShell>
        <PageHeader title="Tempo Challenge" subtitle="Your weekly challenge." />
        <DataError
          message="Check your connection and try loading your challenge again."
          onRetry={() => void challengeQuery.refetch()}
        />
      </AppShell>
    );
  }

  if (!challenge) {
    return (
      <AppShell>
        <PageHeader title="Tempo" subtitle="A private two-person endurance bet." />
        <ChallengePrimer />
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

  const today = todayIn(challenge.timezone);
  const target = DEFAULT_TARGET_KM;
  const me = members?.find((member) => member.userId === user?.id);
  const opponent = members?.find((member) => member.userId !== user?.id);
  const meTotals =
    week && user
      ? sumWeek(activities ?? [], user.id, week.start, week.end)
      : { running: 0, cycling: 0, equivalent: 0, rows: [] };
  const opponentTotals =
    week && opponent ? sumWeek(activities ?? [], opponent.userId, week.start, week.end) : null;
  const mePaused = !!(week && user && weekPaused(travelPauses, user.id, week.n));
  const opponentPaused = !!(week && opponent && weekPaused(travelPauses, opponent.userId, week.n));
  const recent = (activities ?? []).slice(0, 20);
  const needsOpponent = !membersLoading && (members?.length ?? 0) < (challenge.max_members ?? 2);
  const progressLoading = membersLoading || activitiesLoading || pausesLoading;

  return (
    <AppShell>
      <header className="fade-up mb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
          {challenge.duration_weeks}-week challenge
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{challenge.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Week {week?.n} of {challenge.duration_weeks} · {formatTimeLeft(week?.hours ?? 0)} left
        </p>
      </header>

      {membersError || activitiesError || pausesError ? (
        <div className="mb-3">
          <DataError
            title="Some challenge data did not load"
            message="Your saved data is unchanged. Retry to refresh progress, activities, and travel pauses."
            onRetry={() => {
              void Promise.all([
                membersQuery.refetch(),
                activitiesQuery.refetch(),
                pausesQuery.refetch(),
              ]);
            }}
          />
        </div>
      ) : null}

      <Card className="p-0">
        <div className="flex items-center justify-between px-3.5 pb-2 pt-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            This week
          </h2>
          <span className="text-[10px] text-muted-foreground">Ends Sun · {challenge.timezone}</span>
        </div>
        <div className="grid grid-cols-2 border-t border-border">
          <ParticipantProgress
            label={me ? "Me" : "You"}
            totals={meTotals}
            target={target}
            paused={mePaused}
            barClass="bg-primary"
            loading={progressLoading}
          />
          <ParticipantProgress
            label={opponent?.name ?? "Opponent"}
            totals={opponentTotals}
            target={target}
            paused={opponentPaused}
            barClass="bg-chart-2"
            bordered
            loading={progressLoading}
          />
        </div>
      </Card>

      <Link
        to="/challenge/log"
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-[0_8px_28px_-12px_var(--color-primary)] active:scale-[0.99]"
      >
        <Plus className="h-4 w-4" aria-hidden="true" /> Add activity
      </Link>

      <section className="mt-5">
        <SectionTitle right={<span className="text-[11px] text-muted-foreground">Latest 20</span>}>
          Recent activity
        </SectionTitle>
        <div className="space-y-2">
          {activitiesLoading ? (
            <>
              <div className="h-20 animate-pulse rounded-2xl bg-card" />
              <div className="h-20 animate-pulse rounded-2xl bg-card" />
            </>
          ) : null}
          {!activitiesLoading &&
            recent.map((activity) => {
              const metrics = activityMetrics(activity);
              const who = members?.find((member) => member.userId === activity.user_id);
              const mine = activity.user_id === user?.id;
              const canDelete =
                mine &&
                week &&
                activity.activity_date >= week.start &&
                activity.activity_date <= week.end;
              const evidencePaths = [
                activity.evidence_path,
                ...(activity.extra_evidence_paths ?? []),
              ];
              return (
                <Card key={activity.id} className="overflow-hidden p-0">
                  <div className="px-3 py-2.5">
                    <div className="flex items-start gap-2.5">
                      <span
                        className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                          activity.activity_type === "run"
                            ? "bg-primary/15 text-primary"
                            : "bg-chart-2/15 text-chart-2"
                        }`}
                      >
                        {activity.activity_type === "run" ? (
                          <Footprints className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <Bike className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="num truncate text-sm font-semibold">
                            {Number(activity.distance_km).toFixed(1)} km
                            <span className="ml-1.5 font-normal text-muted-foreground">
                              {activity.activity_type === "run" ? "Run" : "Ride"}
                            </span>
                          </p>
                          <span className="num shrink-0 text-xs font-medium text-muted-foreground">
                            {qualifiedEquivalentKm(activity).toFixed(2)} eq
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {mine ? "You" : (who?.name ?? "Athlete")}
                          {activity.duration_seconds
                            ? ` · ${Math.round(activity.duration_seconds / 60)} min`
                            : ""}
                          {activity.duration_seconds
                            ? activity.activity_type === "run"
                              ? ` · ${formatPace(metrics.averagePace)}`
                              : ` · ${metrics.averageSpeed?.toFixed(1)} km/h`
                            : ""}
                          {` · ${formatActivityDay(activity.activity_date, today)}`}
                          {activity.edited ? " · Edited" : ""}
                        </p>
                        {!metrics.qualified ? (
                          <p className="mt-0.5 text-[11px] font-medium text-danger">
                            Does not count toward the weekly target
                          </p>
                        ) : null}
                        {activity.note ? (
                          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-foreground/80">
                            “{activity.note}”
                          </p>
                        ) : null}
                        <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
                          <EvidenceViewer paths={evidencePaths} />
                          {activity.external_activity_url ? (
                            <a
                              href={activity.external_activity_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-medium text-primary"
                            >
                              <LinkIcon className="h-3 w-3" aria-hidden="true" /> Strava
                            </a>
                          ) : null}
                          {canDelete ? (
                            <details className="group/menu ml-auto open:basis-full">
                              <summary
                                aria-label="Activity actions"
                                className="ml-auto grid h-7 w-7 cursor-pointer list-none place-items-center rounded-lg text-muted-foreground hover:bg-elevated [&::-webkit-details-marker]:hidden"
                              >
                                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                              </summary>
                              <div className="mt-1 flex justify-end border-t border-border pt-1.5">
                                <button
                                  type="button"
                                  disabled={deletingId !== null}
                                  onClick={(event) => {
                                    event.currentTarget.closest("details")?.removeAttribute("open");
                                    setDeleteError(null);
                                    setActivityMessage(null);
                                    setConfirmId(activity.id);
                                  }}
                                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete
                                  activity
                                </button>
                              </div>
                            </details>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                  {confirmId === activity.id ? (
                    <div className="flex items-center gap-2 border-t border-danger/25 bg-danger/5 px-3 py-2">
                      <p className="mr-auto text-[11px] text-danger">Delete this activity?</p>
                      <button
                        type="button"
                        disabled={deletingId !== null}
                        onClick={() => setConfirmId(null)}
                        className="min-h-11 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={deletingId !== null}
                        onClick={() => void removeActivity(activity.id)}
                        className="min-h-11 rounded-lg bg-danger px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                      >
                        {deletingId === activity.id ? (
                          <PendingLabel>Deleting…</PendingLabel>
                        ) : (
                          "Delete"
                        )}
                      </button>
                    </div>
                  ) : null}
                </Card>
              );
            })}
          {deleteError ? (
            <p role="alert" className="text-xs text-danger">
              {deleteError}
            </p>
          ) : null}
          {activityMessage ? (
            <p role="status" className="text-xs text-good">
              {activityMessage}
            </p>
          ) : null}
          {!activitiesLoading && !activitiesError && recent.length === 0 ? (
            <Note>
              No activity yet. Add a run or ride when you have its duration and evidence screenshot.
            </Note>
          ) : null}
        </div>
      </section>

      <section className="mt-5">
        <SectionTitle>Challenge settings</SectionTitle>
        <div className="space-y-2">
          <div className="card-surface flex items-center gap-3 px-3 py-2.5 text-sm">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-elevated text-primary">
              <Trophy className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="font-medium">Weekly target</span>
            <span className="ml-auto text-xs text-muted-foreground">15 challenge km</span>
          </div>
          {user ? <ChallengeNotifications userId={user.id} /> : null}
        </div>
      </section>

      {needsOpponent ? (
        <section className="mt-5">
          <Note>
            Your opponent has not joined yet. Your progress is saved; send them a fresh invitation
            link when they are ready.
          </Note>
          <div className="mt-2">
            <ChallengeInviteCard challengeId={challenge.id} />
          </div>
        </section>
      ) : null}

      <details className="group card-surface mt-5 overflow-hidden">
        <summary className="flex cursor-pointer list-none items-center px-3 py-2.5 text-xs font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
          Challenge membership
          <ChevronRight className="ml-auto h-4 w-4 transition-transform group-open:rotate-90" />
        </summary>
        <div className="border-t border-border p-3">
          <p className="text-xs text-muted-foreground">
            Leaving removes you from {challenge.name}. Your logged activities stay in the record.
          </p>
          <button
            type="button"
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
            {leaving ? (
              <PendingLabel>Leaving challenge…</PendingLabel>
            ) : leaveArmed ? (
              "Confirm and leave"
            ) : (
              "Leave this challenge"
            )}
          </button>
          {leaveArmed && !leaving ? (
            <button
              type="button"
              onClick={() => setLeaveArmed(false)}
              className="mt-2 min-h-11 w-full rounded-xl border border-border px-3 py-2 text-sm font-medium text-muted-foreground"
            >
              Cancel
            </button>
          ) : null}
          {leaveError ? (
            <p role="alert" className="mt-2 text-xs text-danger">
              {leaveError}
            </p>
          ) : null}
        </div>
      </details>
    </AppShell>
  );
}

type ProgressTotals = ReturnType<typeof sumWeek>;

function ParticipantProgress({
  label,
  totals,
  target,
  barClass,
  bordered = false,
  loading = false,
  paused = false,
}: {
  label: string;
  totals: ProgressTotals | null;
  target: number;
  barClass: string;
  bordered?: boolean;
  loading?: boolean;
  paused?: boolean;
}) {
  const equivalent = totals?.equivalent ?? 0;
  const complete = totals ? equivalent >= target : false;
  const pct = totals && target > 0 ? Math.min(100, (equivalent / target) * 100) : 0;

  return (
    <div className={`min-w-0 px-3 py-3 ${bordered ? "border-l border-border" : ""}`}>
      <p className="truncate text-xs font-semibold">{label}</p>
      {loading ? (
        <div className="mt-2 space-y-2 animate-pulse">
          <div className="h-5 w-24 rounded-md bg-elevated" />
          <div className="h-1.5 rounded-full bg-elevated" />
          <div className="h-8 w-20 rounded-md bg-elevated" />
        </div>
      ) : totals ? (
        <>
          <p className="num mt-1 text-lg font-semibold leading-none">
            {paused ? (
              <span className="text-good">Travel pause</span>
            ) : (
              <>
                {equivalent.toFixed(1)}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  / {target.toFixed(target % 1 === 0 ? 0 : 1)} km
                </span>
              </>
            )}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-elevated">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barClass}`}
              style={{ width: `${paused ? 100 : pct}%` }}
            />
          </div>
          <div className="mt-2 space-y-0.5 text-[11px]">
            <p className={complete || paused ? "text-good" : "text-muted-foreground"}>
              {paused
                ? "Week is penalty-free"
                : complete
                  ? "Target complete"
                  : `${Math.max(0, target - equivalent).toFixed(1)} km left`}
            </p>
            <p className={complete || paused ? "text-good" : "text-warn"}>
              Penalty {owedText(paused ? 0 : penaltyFor(equivalent, target))}
            </p>
            <p className="truncate text-[10px] text-muted-foreground/80">
              Run {km(totals.running)} · Ride {km(totals.cycling)}
            </p>
          </div>
        </>
      ) : (
        <div className="mt-3">
          <div className="h-1.5 rounded-full bg-elevated" />
          <p className="mt-2 text-[11px] text-muted-foreground">Opponent has not joined yet</p>
        </div>
      )}
    </div>
  );
}

function formatTimeLeft(hours: number) {
  const days = Math.max(0, Math.floor(hours / 24));
  const remainingHours = Math.max(0, Math.floor(hours % 24));
  return `${days}d ${remainingHours}h`;
}

function formatActivityDay(day: string, today: string) {
  const difference = differenceInCalendarDays(parseISO(today), parseISO(day));
  if (difference === 0) return "Today";
  if (difference === 1) return "Yesterday";
  return format(parseISO(day), "d MMM");
}

/** Evidence screenshots are visible to both members so neither can cheat. */
function EvidenceViewer({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = async () => {
    setOpen(true);
    if (urls) return;
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase.storage
      .from("challenge-evidence")
      .createSignedUrls(paths, 300);
    if (e) setError(e.message);
    else setUrls((data ?? []).map((item) => item.signedUrl).filter(Boolean) as string[]);
    setLoading(false);
  };

  if (paths.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => void show()}
        aria-label={`View ${paths.length} evidence screenshot${paths.length > 1 ? "s" : ""}`}
        className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 py-2 font-medium text-muted-foreground hover:bg-elevated"
      >
        <ImageIcon className="h-3 w-3" aria-hidden="true" /> Evidence
        {paths.length > 1 ? ` ${paths.length}` : ""}
      </button>
    );
  }

  return (
    <div className="order-last mt-1 basis-full">
      {error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 text-[11px] text-danger"
        >
          <span>Could not load evidence. {error}</span>
          <button
            type="button"
            onClick={() => {
              setUrls(null);
              void show();
            }}
            className="min-h-11 shrink-0 rounded-lg border border-danger/40 px-3 py-2 font-semibold"
          >
            Retry
          </button>
        </div>
      ) : loading ? (
        <p role="status" className="text-[11px] text-muted-foreground">
          Loading evidence…
        </p>
      ) : urls ? (
        <div className="space-y-2">
          {urls.map((url, index) => (
            <a key={url} href={url} target="_blank" rel="noreferrer">
              <img
                src={url}
                alt={`Activity evidence screenshot ${index + 1}`}
                className="max-h-72 w-full rounded-xl border border-border bg-elevated object-contain"
              />
            </a>
          ))}
        </div>
      ) : (
        <div className="h-20 animate-pulse rounded-xl bg-elevated" />
      )}
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="mt-1 min-h-11 rounded-lg px-2 text-[11px] font-medium text-muted-foreground"
      >
        Hide evidence
      </button>
    </div>
  );
}

import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Bike, Footprints } from "lucide-react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { ChallengeEvidenceViewer } from "@/components/ChallengeEvidenceViewer";
import { Card, DataError, Note, SectionTitle } from "@/components/ui-kit";
import { useAuth } from "@/lib/auth";
import {
  activityMetrics,
  formatPace,
  owedText,
  qualifiedEquivalentKm,
  useActivities,
  useChallengeMembers,
  useMyChallenge,
  useWeeks,
  type Activity,
  type WeekRow,
} from "@/lib/challenge";
import { countryName } from "@/lib/countries";

export const Route = createFileRoute("/_authenticated/challenge/history_/week/$weekNumber")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: FinalizedWeekDetail,
});

function FinalizedWeekDetail() {
  const { weekNumber: weekParam } = Route.useParams();
  const router = useRouter();
  const { user } = useAuth();
  const weekNumber = Number(weekParam);
  const challengeQuery = useMyChallenge();
  const challenge = challengeQuery.data;
  const membersQuery = useChallengeMembers(challenge?.id);
  const weeksQuery = useWeeks(challenge?.id);
  const activitiesQuery = useActivities(challenge?.id);
  const weekRows = (weeksQuery.data ?? []).filter((week) => week.week_number === weekNumber);
  const reference = weekRows[0];
  const activities = reference
    ? (activitiesQuery.data ?? []).filter(
        (activity) =>
          activity.activity_date >= reference.week_start &&
          activity.activity_date <= reference.week_end,
      )
    : [];
  const loading =
    challengeQuery.isLoading ||
    membersQuery.isLoading ||
    weeksQuery.isLoading ||
    activitiesQuery.isLoading;
  const error =
    challengeQuery.error || membersQuery.error || weeksQuery.error || activitiesQuery.error;
  const participantName = (id: string) =>
    id === user?.id
      ? "Me"
      : (membersQuery.data?.find((member) => member.userId === id)?.name ?? "Athlete");

  return (
    <AppShell>
      <button
        type="button"
        onClick={() => router.history.back()}
        className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-medium text-primary"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to History
      </button>
      <PageHeader
        title={Number.isInteger(weekNumber) ? `Week ${weekNumber}` : "Finalized week"}
        subtitle={
          reference
            ? `${reference.week_start} to ${reference.week_end} · Finalized and read-only`
            : "Finalized and read-only"
        }
      />
      {loading ? <div className="h-48 animate-pulse rounded-2xl bg-card" /> : null}
      {error ? (
        <DataError
          message="This finalized week could not be loaded. Its saved result is unchanged."
          onRetry={() =>
            void Promise.all([
              challengeQuery.refetch(),
              membersQuery.refetch(),
              weeksQuery.refetch(),
              activitiesQuery.refetch(),
            ])
          }
        />
      ) : null}
      {!loading && !error && (!challenge || !reference || !Number.isInteger(weekNumber)) ? (
        <Note>This finalized week is unavailable or does not belong to your Challenge.</Note>
      ) : null}
      {!loading && !error && challenge && reference ? (
        <div className="space-y-4">
          {weekRows.map((week) => (
            <ParticipantWeek
              key={week.id}
              week={week}
              name={participantName(week.user_id)}
              legacyPhotoOwed={challenge.legacy_photo_owed}
              activities={activities.filter((activity) => activity.user_id === week.user_id)}
            />
          ))}
        </div>
      ) : null}
    </AppShell>
  );
}

function ParticipantWeek({
  week,
  name,
  legacyPhotoOwed,
  activities,
}: {
  week: WeekRow;
  name: string;
  legacyPhotoOwed: boolean;
  activities: Activity[];
}) {
  const result = week.paused
    ? "No penalty"
    : week.completed
      ? "Completed · No penalty"
      : week.penalty_mode === "custom"
        ? (week.penalty_consequence ?? "Custom consequence")
        : owedText(Number(week.penalty_eur), legacyPhotoOwed);
  return (
    <Card>
      <SectionTitle
        right={
          <span className={week.completed || week.paused ? "text-good" : "text-warn"}>
            {result}
          </span>
        }
      >
        {name}
      </SectionTitle>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <Metric label="Target" value={`${formatNumber(week.target_km)} km`} />
        <Metric label="Qualifying" value={`${formatNumber(week.equivalent_km)} km`} />
        <Metric label="Result" value={week.completed ? "Completed" : "Not completed"} />
        <Metric
          label="Travel"
          value={
            week.paused
              ? `Paused · ${week.pause_country ? countryName(week.pause_country) : "travel"}`
              : "Active"
          }
        />
      </dl>
      <div className="mt-4 border-t border-border pt-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Activities
        </p>
        {activities.length ? (
          <div className="space-y-2">
            {activities.map((activity) => (
              <ReadOnlyActivity key={activity.id} activity={activity} />
            ))}
          </div>
        ) : (
          <Note>No activities were logged for this participant in this week.</Note>
        )}
      </div>
    </Card>
  );
}

function ReadOnlyActivity({ activity }: { activity: Activity }) {
  const metrics = activityMetrics(activity);
  const evidencePaths = [activity.evidence_path, ...(activity.extra_evidence_paths ?? [])].filter(
    Boolean,
  );
  return (
    <article className="rounded-xl border border-border bg-elevated p-3">
      <div className="flex items-start gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          {activity.activity_type === "run" ? (
            <Footprints className="h-4 w-4" />
          ) : (
            <Bike className="h-4 w-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex justify-between gap-2 text-sm">
            <p className="font-semibold">
              {formatNumber(activity.distance_km)} km{" "}
              {activity.activity_type === "run" ? "Run" : "Cycle"}
            </p>
            <p className="num shrink-0">{qualifiedEquivalentKm(activity).toFixed(2)} eq</p>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {activity.activity_date} ·{" "}
            {activity.duration_seconds
              ? `${Math.round(activity.duration_seconds / 60)} min`
              : "No duration"}{" "}
            ·{" "}
            {activity.activity_type === "run"
              ? formatPace(metrics.averagePace)
              : metrics.averageSpeed == null
                ? "—"
                : `${metrics.averageSpeed.toFixed(1)} km/h`}
          </p>
          <p
            className={`mt-1 text-[11px] font-medium ${activity.is_qualified ? "text-good" : "text-danger"}`}
          >
            {activity.is_qualified ? "Qualified" : "Not qualified"}
          </p>
          {activity.evidence_expired_at ? (
            <p className="mt-1 min-h-11 py-2 text-[11px] font-medium text-muted-foreground">
              Evidence expired after finalization
            </p>
          ) : evidencePaths.length ? (
            <ChallengeEvidenceViewer paths={evidencePaths} expired={false} />
          ) : (
            <p className="mt-1 min-h-11 py-2 text-[11px] text-muted-foreground">
              Evidence unavailable
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-elevated p-2.5">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-semibold">{value}</dd>
    </div>
  );
}

function formatNumber(value: number | string) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(Number(value));
}

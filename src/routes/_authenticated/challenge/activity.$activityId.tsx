import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { format, parseISO } from "date-fns";
import { Link as LinkIcon } from "lucide-react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { ChallengeEvidenceViewer } from "@/components/ChallengeEvidenceViewer";
import { Card, DataError, Note, PendingLabel } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { userFacingError } from "@/lib/network-errors";
import { safeStravaUrl } from "@/lib/safe-url";
import { evidenceWeekFinalized } from "@/lib/challenge-evidence";
import {
  activityMetrics,
  formatPace,
  isActivityEditable,
  qualifiedEquivalentKm,
  useActivity,
  useMyChallenge,
  useWeeks,
} from "@/lib/challenge";

export const Route = createFileRoute("/_authenticated/challenge/activity/$activityId")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: ActivityDetail,
});

function ActivityDetail() {
  const { activityId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const challengeQuery = useMyChallenge();
  const challenge = challengeQuery.data;
  const activityQuery = useActivity(activityId);
  const activity = activityQuery.data;
  const weeksQuery = useWeeks(challenge?.id);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loading = challengeQuery.isLoading || activityQuery.isLoading;
  const error = challengeQuery.error || activityQuery.error;

  const remove = async () => {
    if (!activity) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const { error: e } = await supabase
        .from("challenge_activities")
        .delete()
        .eq("id", activity.id);
      if (e) throw e;
      await qc.invalidateQueries({ queryKey: ["challenge-activities"] });
      await qc.invalidateQueries({ queryKey: ["challenge-activity", activity.id] });
      void navigate({ to: "/challenge" });
    } catch (e) {
      setDeleteError(userFacingError(e, "delete the activity"));
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <PageHeader title="Activity" backTo="/challenge" backLabel="This week" />
        <div className="h-48 animate-pulse rounded-2xl bg-card" />
      </AppShell>
    );
  }

  if (error && !activity) {
    return (
      <AppShell>
        <PageHeader title="Activity" backTo="/challenge" backLabel="This week" />
        <DataError
          message="This activity could not be loaded. Its saved record is unchanged."
          onRetry={() => void Promise.all([challengeQuery.refetch(), activityQuery.refetch()])}
        />
      </AppShell>
    );
  }

  if (!activity || !challenge) {
    return (
      <AppShell>
        <PageHeader title="Activity" backTo="/challenge" backLabel="This week" />
        <Note>This activity is unavailable or does not belong to your Challenge.</Note>
      </AppShell>
    );
  }

  const metrics = activityMetrics(activity);
  const run = activity.activity_type === "run";
  const editable = isActivityEditable(challenge, activity, user?.id);
  const evidencePaths = [activity.evidence_path, ...(activity.extra_evidence_paths ?? [])].filter(
    Boolean,
  );
  const evidenceExpired = evidenceWeekFinalized(activity, weeksQuery.data ?? []);
  const external = safeStravaUrl(activity.external_activity_url);

  return (
    <AppShell>
      <PageHeader
        title={`${run ? "Run" : "Ride"} · ${Number(activity.distance_km).toFixed(1)} km`}
        backTo="/challenge"
        backLabel="This week"
      />
      <p className="-mt-3 mb-4 text-[15px] text-muted-foreground">
        {format(parseISO(activity.activity_date), "EEEE d MMM")}
        {activity.created_at ? `, ${format(parseISO(activity.created_at), "HH:mm")}` : ""}
        {activity.edited ? " · Edited" : ""}
      </p>

      <div className="space-y-3.5">
        <Card className="num grid grid-cols-3 gap-2 p-[18px]">
          <Metric label="Time" value={durationLabel(activity.duration_seconds)} />
          <Metric
            label={run ? "Pace" : "Speed"}
            value={
              run
                ? formatPace(metrics.averagePace).replace(" min/km", "")
                : metrics.averageSpeed == null
                  ? "—"
                  : metrics.averageSpeed.toFixed(1)
            }
          />
          <Metric
            label="Counts as"
            value={`${qualifiedEquivalentKm(activity).toFixed(1)} km`}
            accent
          />
        </Card>

        {!metrics.qualified ? (
          <p className="text-[13px] font-medium text-warn">
            {run
              ? "This run is slower than the 7:00 /km limit, so it doesn’t count."
              : "This ride is under the 18 km/h limit, so it doesn’t count."}
          </p>
        ) : null}

        {evidencePaths.length ? (
          <ChallengeEvidenceViewer
            paths={evidencePaths}
            expired={evidenceExpired}
            variant="panel"
          />
        ) : null}

        {external ? (
          <a
            href={external}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 items-center gap-2 text-[15px] font-medium text-primary"
          >
            <LinkIcon className="h-4 w-4" aria-hidden="true" /> Open on Strava
          </a>
        ) : null}

        {activity.note ? (
          <Card className="p-[18px]">
            <p className="text-[15px] leading-relaxed text-foreground/90">“{activity.note}”</p>
          </Card>
        ) : null}

        {editable ? (
          <>
            {deleteArmed ? (
              <div className="rounded-[14px] border border-danger/30 bg-danger/5 p-3">
                <p className="text-[13px] text-danger">
                  Delete this activity? Its evidence is removed too.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={() => setDeleteArmed(false)}
                    className="h-12 rounded-[14px] bg-elevated text-[15px] font-semibold disabled:opacity-60"
                  >
                    Keep it
                  </button>
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={() => void remove()}
                    className="h-12 rounded-[14px] bg-danger text-[15px] font-semibold text-white disabled:opacity-60"
                  >
                    {deleting ? <PendingLabel>Deleting…</PendingLabel> : "Delete"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                <Link
                  to="/challenge/add"
                  search={{ edit: activity.id, type: activity.activity_type }}
                  className="flex h-12 items-center justify-center rounded-[14px] bg-elevated text-[15px] font-semibold"
                >
                  Edit
                </Link>
                <button
                  type="button"
                  onClick={() => setDeleteArmed(true)}
                  className="h-12 rounded-[14px] bg-elevated text-[15px] font-semibold text-danger"
                >
                  Delete
                </button>
              </div>
            )}
            {deleteError ? (
              <p role="alert" className="text-[13px] text-danger">
                {deleteError}
              </p>
            ) : null}
            <p className="text-center text-[13px] text-muted-foreground">
              You can change this until the week closes on Sunday 23:59.
            </p>
          </>
        ) : (
          <p className="text-center text-[13px] text-muted-foreground">
            This week is finalized, so the activity is locked.
          </p>
        )}
      </div>
    </AppShell>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold ${accent ? "text-primary" : ""}`}>{value}</p>
    </div>
  );
}

function durationLabel(seconds: number | null) {
  if (!seconds || seconds <= 0) return "—";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

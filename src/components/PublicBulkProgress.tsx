import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, format, parseISO } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Pencil, Trash2 } from "lucide-react";
import { Card, DataError, PendingLabel, SectionTitle } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { optimizeBulkPhoto } from "@/lib/challenge-evidence";
import { userFacingError } from "@/lib/network-errors";
import {
  bulkWeek,
  goalProgress,
  localDay,
  validateWeight,
  weeklyProgressSummary,
  type BulkProgressPhoto,
  type BulkWeeklyProgressSummary,
} from "@/lib/bulk-progress";
import {
  applyBulkCalorieRecommendation,
  bulkPhotoQueryKey,
  bulkProgressNutritionQueryKey,
  bulkWeightQueryKey,
  deleteBulkProgressPhoto,
  deleteBulkWeight,
  saveBulkWeight,
  uploadBulkProgressPhoto,
  useBulkProgressNutrition,
  useBulkProgressPhotos,
  useBulkWeights,
} from "@/lib/bulk-progress-query";
import { useCompletedBulkTrainingSessions } from "@/lib/bulk-training-sessions";
import { useActiveTrainingPlan } from "@/lib/training-plans-query";
import type { Targets } from "@/lib/types";
import { refreshBulk } from "@/lib/store";
import {
  recommendBulkCalories,
  type BulkWeeklyRecommendation,
} from "@/lib/bulk-weekly-recommendation";

export function PublicBulkProgress({
  bulkProfileId,
  targets,
}: {
  bulkProfileId: string;
  targets: Targets;
}) {
  const today = localDay(new Date());
  const currentWeek = bulkWeek(today);
  const from = localDay(addDays(parseISO(currentWeek.start), -84));
  const lastCompletedEnd = localDay(addDays(parseISO(currentWeek.start), -1));
  const previousCompletedEnd = localDay(addDays(parseISO(currentWeek.start), -8));
  const recommendationFrom = localDay(addDays(parseISO(currentWeek.start), -21));
  const queryClient = useQueryClient();
  const weights = useBulkWeights(bulkProfileId, from);
  const nutrition = useBulkProgressNutrition(bulkProfileId, recommendationFrom, currentWeek.end);
  const sessions = useCompletedBulkTrainingSessions(
    bulkProfileId,
    `${recommendationFrom}T00:00:00`,
    `${localDay(addDays(parseISO(currentWeek.end), 1))}T00:00:00`,
  );
  const plan = useActiveTrainingPlan(bulkProfileId);
  const photos = useBulkProgressPhotos(bulkProfileId);
  const [editingWeightId, setEditingWeightId] = useState<string | null>(null);
  const summary = useMemo(
    () =>
      weeklyProgressSummary({
        selectedDay: today,
        weights: weights.data ?? [],
        nutritionDays: nutrition.data ?? [],
        completedWorkoutDates: (sessions.data ?? []).map((session) =>
          localDay(new Date(session.completedAt!)),
        ),
        plannedWorkouts: plan.data?.trainingDaysPerWeek ?? null,
        targetWeeklyGainKg: targets.targetWeeklyGainKg ?? null,
        currentTargetCalories: targets.calories,
      }),
    [
      today,
      weights.data,
      nutrition.data,
      sessions.data,
      plan.data,
      targets.targetWeeklyGainKg,
      targets.calories,
    ],
  );
  const completedSummary = useMemo(
    () =>
      weeklyProgressSummary({
        selectedDay: lastCompletedEnd,
        weights: weights.data ?? [],
        nutritionDays: nutrition.data ?? [],
        completedWorkoutDates: (sessions.data ?? []).map((session) =>
          localDay(new Date(session.completedAt!)),
        ),
        plannedWorkouts: plan.data?.trainingDaysPerWeek ?? null,
        targetWeeklyGainKg: targets.targetWeeklyGainKg ?? null,
        currentTargetCalories: targets.calories,
      }),
    [
      lastCompletedEnd,
      weights.data,
      nutrition.data,
      sessions.data,
      plan.data,
      targets.targetWeeklyGainKg,
      targets.calories,
    ],
  );
  const priorSummary = useMemo(
    () =>
      weeklyProgressSummary({
        selectedDay: previousCompletedEnd,
        weights: weights.data ?? [],
        nutritionDays: nutrition.data ?? [],
        completedWorkoutDates: (sessions.data ?? []).map((session) =>
          localDay(new Date(session.completedAt!)),
        ),
        plannedWorkouts: plan.data?.trainingDaysPerWeek ?? null,
        targetWeeklyGainKg: targets.targetWeeklyGainKg ?? null,
        currentTargetCalories: targets.calories,
      }),
    [
      previousCompletedEnd,
      weights.data,
      nutrition.data,
      sessions.data,
      plan.data,
      targets.targetWeeklyGainKg,
      targets.calories,
    ],
  );
  const goal = goalProgress(
    weights.data ?? [],
    summary.weightAverageKg,
    targets.startWeight,
    targets.targetWeight,
  );
  const recommendation = useMemo(
    () =>
      recommendBulkCalories({
        summary: completedSummary,
        previousTrendChangeKg: priorSummary.weightChangeKg,
        previousTrendComparable:
          priorSummary.weightEntryCount >= 3 && priorSummary.previousWeightEntryCount >= 3,
        targetWeightReached:
          goal.currentWeightKg != null && goal.currentWeightKg >= targets.targetWeight,
      }),
    [completedSummary, priorSummary, goal.currentWeightKg, targets.targetWeight],
  );
  const invalidateWeights = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: bulkWeightQueryKey(bulkProfileId) }),
      queryClient.invalidateQueries({ queryKey: ["bulk-progress-summary"] }),
    ]);
  };

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle>Goal progress</SectionTitle>
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="num text-3xl font-bold">
              {goal.currentWeightKg == null ? "—" : `${goal.currentWeightKg.toFixed(2)} kg`}
            </p>
            <p className="text-xs text-muted-foreground">
              {goal.source === "weekly_average"
                ? "Current weekly average"
                : goal.source === "latest_weight"
                  ? "Latest weigh-in"
                  : "Log a weight to begin"}
            </p>
          </div>
          <p className="text-right text-xs text-muted-foreground">
            Goal
            <br />
            <span className="num text-base font-semibold text-foreground">
              {targets.targetWeight} kg
            </span>
          </p>
        </div>
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-elevated"
          role="progressbar"
          aria-label="Weight goal progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(goal.percent)}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none"
            style={{ width: `${goal.percent}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between text-xs text-muted-foreground">
          <span>Start {targets.startWeight} kg</span>
          <span>
            {goal.gainedKg == null
              ? "No progress data"
              : `${goal.gainedKg >= 0 ? "+" : ""}${goal.gainedKg} kg · ${goal.remainingKg! > 0 ? `${goal.remainingKg} kg remaining` : `${Math.abs(goal.remainingKg!)} kg beyond goal`}`}
          </span>
        </div>
      </Card>

      <WeightEditor
        profileId={bulkProfileId}
        today={today}
        entries={weights.data ?? []}
        editEntryId={editingWeightId}
        onSaved={async () => {
          setEditingWeightId(null);
          await invalidateWeights();
        }}
      />

      <Card>
        <SectionTitle>This week</SectionTitle>
        <p className="text-xs text-muted-foreground">
          {format(parseISO(summary.weekStart), "d MMM")}–
          {format(parseISO(summary.weekEnd), "d MMM")} · current week is still in progress
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Metric
            label="Average weight"
            value={
              summary.weightAverageKg == null
                ? "Unavailable"
                : `${summary.weightAverageKg.toFixed(2)} kg`
            }
            hint={`${summary.weightEntryCount} weigh-in${summary.weightEntryCount === 1 ? "" : "s"}`}
          />
          <Metric
            label="Weekly change"
            value={
              summary.weightChangeKg == null
                ? "Unavailable"
                : `${summary.weightChangeKg >= 0 ? "+" : ""}${summary.weightChangeKg.toFixed(2)} kg`
            }
            hint={
              summary.previousWeightEntryCount
                ? `vs ${summary.previousWeightEntryCount} previous weigh-in${summary.previousWeightEntryCount === 1 ? "" : "s"}`
                : "No previous-week weight"
            }
          />
          <Metric
            label="Training"
            value={
              sessions.error
                ? "Unavailable"
                : summary.plannedWorkouts == null
                  ? `${summary.completedWorkouts} completed`
                  : `${summary.completedWorkouts} / ${summary.plannedWorkouts}`
            }
            hint={summary.plannedWorkouts == null ? "No active plan target" : "workouts this week"}
          />
          <Metric
            label="Target gain"
            value={
              summary.targetWeeklyGainKg == null
                ? "Unavailable"
                : `+${summary.targetWeeklyGainKg} kg`
            }
            hint="per week"
          />
        </div>
        {summary.weightEntryCount === 1 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Only one weigh-in this week. More weigh-ins make the trend more useful.
          </p>
        ) : null}
        {sessions.error || plan.error ? (
          <div className="mt-3">
            <DataError
              message="Training progress could not be loaded. Your other progress is still available."
              onRetry={() => void Promise.all([sessions.refetch(), plan.refetch()])}
            />
          </div>
        ) : sessions.isLoading || plan.isLoading ? (
          <p role="status" className="mt-3 text-xs text-muted-foreground">
            Loading training progress…
          </p>
        ) : null}
      </Card>

      <WeeklyCheckIn
        recommendation={recommendation}
        summary={completedSummary}
        profileId={bulkProfileId}
      />

      <Card>
        <SectionTitle>Nutrition this week</SectionTitle>
        {nutrition.isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading nutrition summary…
          </p>
        ) : nutrition.error ? (
          <DataError
            message={userFacingError(nutrition.error, "load nutrition progress")}
            onRetry={() => void nutrition.refetch()}
          />
        ) : summary.nutritionLoggedDays ? (
          <div className="grid grid-cols-2 gap-2">
            <Metric
              label="Days logged"
              value={String(summary.nutritionLoggedDays)}
              hint="this week"
            />
            <Metric
              label="Average calories"
              value={`${Math.round(summary.averageCalories!)} kcal`}
              hint={`target avg ${Math.round(summary.targetCalories!)} kcal`}
            />
            <Metric
              label="Average protein"
              value={`${Math.round(summary.averageProtein!)} g`}
              hint="on logged days"
            />
            <Metric
              label="Within ±10%"
              value={`${summary.calorieAdherentDays} / ${summary.nutritionLoggedDays}`}
              hint="logged days"
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No nutrition logged this week.</p>
        )}
      </Card>

      <ProgressPhotos profileId={bulkProfileId} today={today} query={photos} />

      <Card>
        <SectionTitle>Recent weight</SectionTitle>
        {weights.error ? (
          <DataError
            message={userFacingError(weights.error, "load weight history")}
            onRetry={() => void weights.refetch()}
          />
        ) : weights.data?.length ? (
          <div className="divide-y divide-border">
            {weights.data.slice(0, 12).map((entry) => (
              <div key={entry.id} className="flex min-h-14 items-center justify-between gap-3 py-2">
                <div>
                  <p className="num font-semibold">{entry.weightKg.toFixed(2)} kg</p>
                  <p className="text-xs text-muted-foreground">
                    {format(parseISO(entry.logDate), "d MMM yyyy")}
                    {entry.note ? ` · ${entry.note}` : ""}
                  </p>
                </div>
                <div className="flex">
                  <button
                    type="button"
                    aria-label={`Edit weight from ${entry.logDate}`}
                    className="grid min-h-11 min-w-11 place-items-center rounded-lg text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
                    onClick={() => setEditingWeightId(entry.id)}
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete weight from ${entry.logDate}`}
                    className="grid min-h-11 min-w-11 place-items-center rounded-lg text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
                    onClick={async () => {
                      if (!window.confirm("Delete this weigh-in?")) return;
                      try {
                        await deleteBulkWeight(entry.id);
                        await invalidateWeights();
                      } catch (error) {
                        const { toast } = await import("sonner");
                        toast.error(userFacingError(error, "delete the weigh-in"));
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No weigh-ins yet. Log your first weight above.
          </p>
        )}
      </Card>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl bg-elevated p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="num mt-1 font-semibold">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function WeeklyCheckIn({
  recommendation,
  summary,
  profileId,
}: {
  recommendation: BulkWeeklyRecommendation;
  summary: BulkWeeklyProgressSummary;
  profileId: string;
}) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canApply =
    recommendation.decision === "increase_calories" ||
    recommendation.decision === "decrease_calories";

  const apply = async () => {
    if (
      !canApply ||
      recommendation.currentTargetCalories == null ||
      recommendation.recommendedCalories == null ||
      pending
    )
      return;
    if (
      !window.confirm(
        `Change daily calories from ${Math.round(recommendation.currentTargetCalories).toLocaleString()} to ${recommendation.recommendedCalories.toLocaleString()}? Protein, carbs and fat will stay unchanged.`,
      )
    )
      return;
    setPending(true);
    setError(null);
    try {
      await applyBulkCalorieRecommendation(
        recommendation.currentTargetCalories,
        recommendation.recommendedCalories,
      );
      await refreshBulk();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["bulk-progress-summary"] }),
        queryClient.invalidateQueries({ queryKey: ["bulk-weekly-recommendation", profileId] }),
      ]);
      const { toast } = await import("sonner");
      toast.success(`Daily calorie target updated to ${recommendation.recommendedCalories} kcal.`);
    } catch (cause) {
      setError(userFacingError(cause, "apply the calorie recommendation"));
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <SectionTitle>Weekly Check-in</SectionTitle>
      <p className="text-xs text-muted-foreground">
        Based on the completed week {format(parseISO(summary.weekStart), "d MMM")}–
        {format(parseISO(summary.weekEnd), "d MMM")}.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Metric
          label="Target gain"
          value={
            summary.targetWeeklyGainKg == null ? "Unavailable" : `+${summary.targetWeeklyGainKg} kg`
          }
          hint="per week"
        />
        <Metric
          label="Actual change"
          value={
            summary.weightChangeKg == null
              ? "Unavailable"
              : `${summary.weightChangeKg >= 0 ? "+" : ""}${summary.weightChangeKg.toFixed(2)} kg`
          }
          hint={`${summary.weightEntryCount} + ${summary.previousWeightEntryCount} weigh-ins`}
        />
        <Metric
          label="Calories"
          value={
            summary.averageCalories == null
              ? "Unavailable"
              : `${Math.round(summary.averageCalories).toLocaleString()} avg`
          }
          hint={
            summary.targetCalories == null
              ? "No target"
              : `${Math.round(summary.targetCalories).toLocaleString()} target`
          }
        />
        <Metric
          label="Training"
          value={
            summary.plannedWorkouts == null
              ? `${summary.completedWorkouts} completed`
              : `${summary.completedWorkouts} / ${summary.plannedWorkouts}`
          }
          hint="completed week"
        />
      </div>
      <div className="mt-3 rounded-xl border border-border bg-elevated p-3" role="status">
        <p className="text-sm font-semibold">{recommendation.headline}</p>
        {recommendation.recommendedCalories != null ? (
          <p className="num mt-1 text-lg font-bold text-primary">
            {recommendation.recommendedCalories.toLocaleString()} kcal/day
          </p>
        ) : null}
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {recommendation.reasonText}
        </p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {recommendation.dataQuality === "strong"
            ? `Based on ${summary.weightEntryCount} recent weigh-ins and ${summary.nutritionLoggedDays} logged nutrition days.`
            : "Not enough complete data for a normal calorie adjustment yet."}
        </p>
      </div>
      {canApply ? (
        <Button
          type="button"
          disabled={pending}
          className="mt-3 min-h-11 w-full"
          onClick={() => void apply()}
        >
          {pending ? <PendingLabel>Applying recommendation…</PendingLabel> : "Apply Recommendation"}
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error} Check your current target and try again.
        </p>
      ) : null}
    </Card>
  );
}

function WeightEditor({
  profileId,
  today,
  entries,
  editEntryId,
  onSaved,
}: {
  profileId: string;
  today: string;
  entries: NonNullable<ReturnType<typeof useBulkWeights>["data"]>;
  editEntryId: string | null;
  onSaved: () => Promise<void>;
}) {
  const existingToday = entries.find((entry) => entry.logDate === today);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [weight, setWeight] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const begin = () => {
    setDate(today);
    setWeight(existingToday?.weightKg.toString() ?? "");
    setNote(existingToday?.note ?? "");
    setError(null);
    setOpen(true);
  };
  useEffect(() => {
    const entry = entries.find((item) => item.id === editEntryId);
    if (!entry) return;
    setDate(entry.logDate);
    setWeight(entry.weightKg.toString());
    setNote(entry.note ?? "");
    setError(null);
    setOpen(true);
  }, [editEntryId, entries]);
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div>
          <SectionTitle>{existingToday ? "Today's weight" : "Track your weight"}</SectionTitle>
          <p className="text-sm text-muted-foreground">
            {existingToday
              ? `${existingToday.weightKg.toFixed(2)} kg logged today`
              : "Weekly averages smooth out daily changes."}
          </p>
        </div>
        <Button type="button" onClick={begin} className="min-h-11">
          {existingToday ? (
            <>
              <Pencil className="size-4" /> Edit Weight
            </>
          ) : (
            "Log Weight"
          )}
        </Button>
      </div>
      {open ? (
        <form
          className="mt-4 space-y-3 border-t border-border pt-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const parsed = Number(weight.replace(",", "."));
            const validation = validateWeight(parsed, date, today, note);
            if (validation) {
              setError(validation);
              return;
            }
            setPending(true);
            setError(null);
            try {
              await saveBulkWeight(profileId, {
                logDate: date,
                weightKg: parsed,
                note: note.trim() || null,
              });
              await onSaved();
              setOpen(false);
            } catch (cause) {
              setError(userFacingError(cause, "save your weight"));
            } finally {
              setPending(false);
            }
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted-foreground">
              Weight kg
              <input
                inputMode="decimal"
                value={weight}
                onChange={(event) => setWeight(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-input bg-elevated px-3 text-base text-foreground outline-none focus:border-ring"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Date
              <input
                type="date"
                max={today}
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-input bg-elevated px-3 text-base text-foreground outline-none focus:border-ring"
              />
            </label>
          </div>
          <label className="text-xs text-muted-foreground">
            Note, optional
            <input
              maxLength={240}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-xl border border-input bg-elevated px-3 text-base text-foreground outline-none focus:border-ring"
            />
          </label>
          {error ? (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button disabled={pending} className="min-h-11 flex-1">
              {pending ? <PendingLabel>Saving weight…</PendingLabel> : "Save Weight"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              className="min-h-11"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}

function ProgressPhotos({
  profileId,
  today,
  query,
}: {
  profileId: string;
  today: string;
  query: ReturnType<typeof useBulkProgressPhotos>;
}) {
  const client = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState(today);
  const [view, setView] = useState<BulkProgressPhoto["viewType"]>("other");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = async () => {
    if (!file || pending) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 15 * 1024 * 1024
    ) {
      setError("Choose a JPG, PNG or WebP image up to 15 MB.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const optimized = await optimizeBulkPhoto(file);
      await uploadBulkProgressPhoto(profileId, {
        file: optimized,
        logDate: date,
        viewType: view,
        note: note.trim() || null,
      });
      await client.invalidateQueries({ queryKey: bulkPhotoQueryKey(profileId) });
      setFile(null);
      setNote("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (cause) {
      setError(userFacingError(cause, "upload your progress photo"));
    } finally {
      setPending(false);
    }
  };
  return (
    <Card>
      <SectionTitle>Progress photos</SectionTitle>
      <p className="text-xs text-muted-foreground">
        Private to your Bulk account. Use similar lighting and positioning for useful comparisons.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="col-span-2 min-h-11 text-sm file:mr-2 file:min-h-11 file:rounded-lg file:border-0 file:bg-elevated file:px-3 file:text-foreground"
        />
        <input
          aria-label="Photo date"
          type="date"
          max={today}
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="min-h-11 rounded-xl border border-input bg-elevated px-2 text-base"
        />
        <select
          aria-label="Photo view"
          value={view}
          onChange={(event) => setView(event.target.value as BulkProgressPhoto["viewType"])}
          className="min-h-11 rounded-xl border border-input bg-elevated px-2 text-base"
        >
          <option value="other">Other</option>
          <option value="front">Front</option>
          <option value="side">Side</option>
          <option value="back">Back</option>
        </select>
        <input
          aria-label="Photo note"
          placeholder="Optional note"
          maxLength={240}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className="col-span-2 min-h-11 rounded-xl border border-input bg-elevated px-3 text-base"
        />
        <Button
          type="button"
          disabled={!file || pending || date > today}
          onClick={() => void upload()}
          className="col-span-2 min-h-11"
        >
          <Camera className="size-4" />
          {pending ? <PendingLabel>Uploading photo…</PendingLabel> : "Upload Photo"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
      {query.error ? (
        <div className="mt-3">
          <DataError
            message={userFacingError(query.error, "load progress photos")}
            onRetry={() => void query.refetch()}
          />
        </div>
      ) : query.data?.length ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {query.data.map((photo) => (
            <div key={photo.id} className="overflow-hidden rounded-xl border border-border">
              {photo.signedUrl ? (
                <img
                  src={photo.signedUrl}
                  alt={`${photo.viewType} progress from ${photo.logDate}`}
                  className="aspect-[3/4] w-full object-cover"
                />
              ) : (
                <div className="grid aspect-[3/4] place-items-center bg-elevated p-3 text-center text-xs text-muted-foreground">
                  Photo unavailable
                </div>
              )}
              <div className="flex items-center justify-between gap-2 p-2">
                <p className="min-w-0 text-xs text-muted-foreground">
                  <span className="capitalize">{photo.viewType}</span> ·{" "}
                  {format(parseISO(photo.logDate), "d MMM yy")}
                </p>
                <button
                  aria-label={`Delete photo from ${photo.logDate}`}
                  className="grid min-h-11 min-w-11 place-items-center"
                  onClick={async () => {
                    if (!window.confirm("Delete this progress photo?")) return;
                    try {
                      await deleteBulkProgressPhoto(photo);
                      await client.invalidateQueries({ queryKey: bulkPhotoQueryKey(profileId) });
                    } catch (cause) {
                      setError(userFacingError(cause, "delete the progress photo"));
                    }
                  }}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              {photo.note ? (
                <p className="px-2 pb-2 text-xs text-muted-foreground">{photo.note}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">No progress photos yet.</p>
      )}
    </Card>
  );
}

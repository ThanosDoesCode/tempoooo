import { createFileRoute, Navigate } from "@tanstack/react-router";
import { addDays, format, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { CompletedWorkout } from "@/components/BulkWorkoutSession";
import { Card, DataError, SectionTitle } from "@/components/ui-kit";
import { iso } from "@/lib/calc";
import { mealPlan } from "@/lib/meals";
import { useAppData, useBulkMeta } from "@/lib/store";
import { exerciseLabel, splitLabel } from "@/lib/types";
import {
  bodyweightMode,
  entryLoadLabel,
  metricNumber,
  workoutDuration,
  workoutMetrics,
} from "@/lib/training";
import { useCompletedBulkTrainingSessions } from "@/lib/bulk-training-sessions";
import { userFacingError } from "@/lib/network-errors";
import { bulkPlanModeFor, useMemberships } from "@/lib/bulk-access";

export const Route = createFileRoute("/_authenticated/bulk/history")({
  head: () => ({
    meta: [
      { title: "Tempo" },
      { name: "description", content: "Review a saved day of nutrition and training." },
    ],
  }),
  component: BulkHistoryPage,
});

function BulkHistoryPage() {
  const data = useAppData();
  const { bulkId } = useBulkMeta();
  const memberships = useMemberships();
  const planMode = bulkPlanModeFor(memberships.data, bulkId);
  const today = iso(new Date());
  const [date, setDate] = useState(today);
  const from = new Date(`${date}T00:00:00`).toISOString();
  const to = new Date(`${iso(addDays(parseISO(date), 1))}T00:00:00`).toISOString();
  const publicSessions = useCompletedBulkTrainingSessions(bulkId, from, to);

  if (!data || planMode === "none") {
    return (
      <AppShell>
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      </AppShell>
    );
  }

  if (planMode === "public") {
    return <Navigate to="/bulk/training/history" replace />;
  }

  const day = data.days[date];
  const workout = data.workouts[date];
  const metrics = workout ? workoutMetrics(workout) : null;
  const duration = workout ? workoutDuration(workout) : null;
  const workoutPerformed = (metrics?.workingSets ?? 0) > 0;
  const workoutName = workout
    ? splitLabel(workout.type)
    : day?.workoutType === "Rest"
      ? "Rest"
      : day?.workoutType
        ? splitLabel(day.workoutType)
        : "—";
  const configuredPlan = mealPlan(day?.mealPlan);
  const nutrition = day?.mealSnapshot ?? configuredPlan;
  const hasNutrition =
    !!day?.mealPlan ||
    [day?.calories, day?.protein, day?.carbs, day?.fat].some((value) => value != null);
  const move = (days: number) => {
    const next = iso(addDays(parseISO(date), days));
    if (next <= today) setDate(next);
  };

  return (
    <AppShell>
      <PageHeader title="History" subtitle={format(parseISO(date), "EEEE, d MMMM yyyy")} />

      <div className="mb-3 grid grid-cols-[44px_1fr_44px] items-center gap-2" data-no-pull>
        <button
          type="button"
          onClick={() => move(-1)}
          aria-label="Previous day"
          className="grid min-h-11 place-items-center rounded-xl border border-border bg-card active:bg-elevated"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <input
          type="date"
          value={date}
          max={today}
          onChange={(event) => event.target.value && setDate(event.target.value)}
          className="min-h-11 min-w-0 rounded-xl border border-input bg-elevated px-3 text-center text-base outline-none focus:border-ring"
          aria-label="History date"
        />
        <button
          type="button"
          onClick={() => move(1)}
          disabled={date >= today}
          aria-label="Next day"
          className="grid min-h-11 place-items-center rounded-xl border border-border bg-card active:bg-elevated disabled:opacity-35"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <Card>
        <SectionTitle>Daily summary</SectionTitle>
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <Summary label="Body weight" value={day?.weight == null ? "—" : `${day.weight} kg`} />
          <Summary label="Calories" value={day?.calories == null ? "—" : `${day.calories} kcal`} />
          <Summary label="Protein" value={day?.protein == null ? "—" : `${day.protein} g`} />
          <Summary label="Carbs" value={day?.carbs == null ? "—" : `${day.carbs} g`} />
          <Summary label="Fat" value={day?.fat == null ? "—" : `${day.fat} g`} />
        </div>
        {day?.note?.trim() ? (
          <p className="mt-3 whitespace-pre-wrap rounded-xl bg-elevated/70 p-3 text-xs text-muted-foreground">
            Daily note: {day.note.trim()}
          </p>
        ) : null}
      </Card>

      <Card className="mt-3">
        <SectionTitle>Workout</SectionTitle>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Summary label="Performed" value={workoutPerformed ? "Yes" : "No"} />
          <Summary label="Workout" value={workoutName} />
          <Summary
            label="Status"
            value={
              !workout
                ? "Not logged"
                : workout.status === "completed"
                  ? "Completed"
                  : workout.status === "draft"
                    ? "Draft"
                    : "Legacy record"
            }
          />
          <Summary
            label="Duration"
            value={duration == null ? "—" : `${Math.round(duration / 60)} min`}
          />
          <Summary
            label="Total volume"
            value={metrics?.volume == null ? "—" : `${metricNumber(metrics.volume)} kg`}
          />
          <Summary label="Working sets" value={String(metrics?.workingSets ?? 0)} />
          {workout?.sessionBodyweight != null ? (
            <Summary label="Session bodyweight" value={`${workout.sessionBodyweight} kg`} />
          ) : null}
        </div>
        {!workout ? (
          <div className="mt-3">
            <Empty>No workout was logged for this day.</Empty>
          </div>
        ) : (
          <>
            {!workoutPerformed ? (
              <p className="mt-3 rounded-xl bg-warn/10 p-3 text-xs text-warn">
                This saved workout has no working sets, so it is not counted as performed.
              </p>
            ) : null}
            <div className="mt-3 space-y-2">
              {workout.entries.map((entry) => (
                <div key={entry.exercise} className="rounded-xl bg-elevated/70 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold">{exerciseLabel(entry.exercise)}</p>
                    <span className="num shrink-0 text-xs text-muted-foreground">
                      {entryLoadLabel(entry)}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1.5">
                    {entry.reps.map((rep, index) => (
                      <div key={index} className="rounded-lg bg-card/60 px-2 py-1.5">
                        <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
                          Set {index + 1}
                        </p>
                        <p className="num mt-0.5 text-xs font-semibold">
                          {rep == null ? "—" : `${rep} reps`}
                        </p>
                      </div>
                    ))}
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <HistoryField label="Load" value={entryLoadLabel(entry)} />
                    {entry.bodyweight != null ? (
                      <HistoryField label="Bodyweight" value={`${entry.bodyweight} kg`} />
                    ) : null}
                    {bodyweightMode(entry) === "added" || entry.addedWeight != null ? (
                      <HistoryField label="Extra weight" value={`${entry.addedWeight ?? 0} kg`} />
                    ) : null}
                    {bodyweightMode(entry) === "assisted" || entry.assistance != null ? (
                      <HistoryField label="Assistance" value={`${entry.assistance ?? 0} kg`} />
                    ) : null}
                    {entry.rpe != null ? (
                      <HistoryField label="RPE" value={String(entry.rpe)} />
                    ) : null}
                  </dl>
                  {entry.noteTags?.length ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Tags: {entry.noteTags.join(" · ")}
                    </p>
                  ) : null}
                  {entry.notes?.trim() ? (
                    <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                      Notes: {entry.notes.trim()}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
            {workout.sessionNote ? (
              <p className="mt-3 whitespace-pre-wrap text-xs text-muted-foreground">
                Session: {workout.sessionNote}
              </p>
            ) : null}
          </>
        )}
      </Card>

      {publicSessions.isLoading ? (
        <div className="mt-3 h-40 animate-pulse rounded-2xl bg-card" />
      ) : publicSessions.error ? (
        <div className="mt-3">
          <DataError
            message={userFacingError(publicSessions.error, "load completed plan workouts")}
            onRetry={() => void publicSessions.refetch()}
          />
        </div>
      ) : publicSessions.data?.length ? (
        <div className="mt-3 space-y-3">
          <SectionTitle>Completed plan workouts</SectionTitle>
          {publicSessions.data.map((session) => (
            <CompletedWorkout key={session.id} session={session} showBackLink={false} />
          ))}
        </div>
      ) : null}

      <Card className="mt-3">
        <SectionTitle>Nutrition</SectionTitle>
        {!hasNutrition ? (
          <Empty>No nutrition was logged for this day.</Empty>
        ) : (
          <>
            {nutrition ? (
              <div>
                <p className="text-sm font-semibold">{nutrition.name}</p>
                {!day?.mealSnapshot && day?.mealPlan !== "custom" ? (
                  <p className="mt-1 text-[11px] text-warn">
                    Legacy day: these are the foods configured for the selected plan; individual
                    consumption was not stored separately.
                  </p>
                ) : day?.mealSnapshot ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Saved plan snapshot for this date.
                  </p>
                ) : null}
                {[...nutrition.base, ...nutrition.meals, ...(nutrition.extras ?? [])].length ? (
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {[...nutrition.base, ...nutrition.meals, ...(nutrition.extras ?? [])].map(
                      (item) => (
                        <li key={item}>· {item}</li>
                      ),
                    )}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {day?.mealPlan === "custom" && !day.mealSnapshot ? (
              <p className="text-xs text-muted-foreground">
                Custom foods and quantities were not stored for this legacy day.
              </p>
            ) : null}
            <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Stored totals (authoritative)
            </p>
            <p className="num mt-1 text-xs text-muted-foreground">
              {day?.calories ?? "—"} kcal · {day?.protein ?? "—"} g protein · {day?.carbs ?? "—"} g
              carbs · {day?.fat ?? "—"} g fat
            </p>
          </>
        )}
      </Card>
    </AppShell>
  );
}

function HistoryField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="inline font-medium text-foreground">{label}:</dt>{" "}
      <dd className="inline">{value}</dd>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-elevated/70 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="num mt-1 font-semibold">{value}</p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-elevated/70 p-3 text-sm text-muted-foreground">{children}</p>;
}

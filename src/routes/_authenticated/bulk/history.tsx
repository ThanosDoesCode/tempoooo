import { createFileRoute } from "@tanstack/react-router";
import { addDays, format, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, SectionTitle } from "@/components/ui-kit";
import { iso } from "@/lib/calc";
import { mealPlan } from "@/lib/meals";
import { useAppData } from "@/lib/store";
import {
  bodyweightMode,
  entryLoadLabel,
  metricNumber,
  notesPreview,
  workoutDuration,
  workoutMetrics,
} from "@/lib/training";

export const Route = createFileRoute("/_authenticated/bulk/history")({
  head: () => ({
    meta: [
      { title: "Bulk history — Tempo" },
      { name: "description", content: "Review a saved day of nutrition and training." },
    ],
  }),
  component: BulkHistoryPage,
});

function BulkHistoryPage() {
  const data = useAppData();
  const today = iso(new Date());
  const [date, setDate] = useState(today);

  if (!data) {
    return (
      <AppShell>
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      </AppShell>
    );
  }

  const day = data.days[date];
  const workout = data.workouts[date];
  const metrics = workout ? workoutMetrics(workout) : null;
  const duration = workout ? workoutDuration(workout) : null;
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
      </Card>

      <Card className="mt-3">
        <SectionTitle>Workout</SectionTitle>
        {!workout ? (
          <Empty>No workout was logged for this day.</Empty>
        ) : (
          <>
            <p className="text-sm font-semibold">{workout.type}</p>
            <p className="num mt-1 text-xs text-muted-foreground">
              {duration == null ? "Duration unavailable" : `${Math.round(duration / 60)} min`} ·{" "}
              {metrics?.volume == null
                ? "Volume unavailable"
                : `${metricNumber(metrics.volume)} kg`}{" "}
              · {metrics?.workingSets ?? 0} sets
            </p>
            <div className="mt-3 space-y-2">
              {workout.entries.map((entry) => (
                <div key={entry.exercise} className="rounded-xl bg-elevated/70 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold">{entry.exercise}</p>
                    <span className="num shrink-0 text-xs text-muted-foreground">
                      {entryLoadLabel(entry)}
                    </span>
                  </div>
                  <p className="num mt-1 text-xs">
                    Sets: {entry.reps.map((rep) => rep ?? "—").join(" / ")}
                  </p>
                  {entry.bodyweight != null ? (
                    <p className="num mt-1 text-[11px] text-muted-foreground">
                      {bodyweightMode(entry) === "assisted"
                        ? `BW ${entry.bodyweight} kg · assistance ${entry.assistance ?? 0} kg`
                        : bodyweightMode(entry) === "added"
                          ? `BW ${entry.bodyweight} kg · extra ${entry.addedWeight ?? 0} kg`
                          : `Bodyweight ${entry.bodyweight} kg`}
                    </p>
                  ) : null}
                  {notesPreview(entry) ? (
                    <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                      {notesPreview(entry)}
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
                ) : null}
                {[...nutrition.base, ...nutrition.meals].length ? (
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {[...nutrition.base, ...nutrition.meals].map((item) => (
                      <li key={item}>· {item}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {day?.mealPlan === "custom" && !day.mealSnapshot ? (
              <p className="text-xs text-muted-foreground">
                Custom foods and quantities were not stored for this legacy day.
              </p>
            ) : null}
            <p className="num mt-3 text-xs text-muted-foreground">
              {day?.calories ?? "—"} kcal · {day?.protein ?? "—"} g protein · {day?.carbs ?? "—"} g
              carbs · {day?.fat ?? "—"} g fat
            </p>
          </>
        )}
      </Card>
    </AppShell>
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

import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Bar, Card, Chip, Field, Note, NumInput, SectionTitle, Stat } from "@/components/ui-kit";
import { avg7, dayCompletion, fmt, iso, weekDays, weekStartOf } from "@/lib/calc";
import { useActions, useAppData } from "@/lib/store";
import type { WorkoutType } from "@/lib/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Today — Lean Bulk Tracker" },
      {
        name: "description",
        content:
          "Log bodyweight, nutrition, activity and training in under a minute with Lean Bulk Tracker.",
      },
      { property: "og:title", content: "Today — Lean Bulk Tracker" },
      {
        property: "og:description",
        content: "Fast daily logging for a 12-month lean bulk.",
      },
    ],
  }),
  component: TodayPage,
});

const WORKOUT_TYPES: WorkoutType[] = ["Chest & Back", "Legs", "Arms & Shoulders", "Rest"];

function TodayPage() {
  const data = useAppData();
  const { saveDay } = useActions();
  const today = iso(new Date());
  const [saved, setSaved] = useState(false);

  const day = data?.days[today];
  const targets = data?.targets;

  const weekCount = useMemo(() => {
    if (!data) return 0;
    return weekDays(weekStartOf(new Date())).filter((d) => data.days[d]?.gym).length;
  }, [data]);

  if (!data || !targets) {
    return (
      <AppShell>
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      </AppShell>
    );
  }

  const set = (patch: Parameters<typeof saveDay>[1]) => {
    saveDay(today, patch);
    setSaved(false);
  };

  const completion = dayCompletion({ ...day, date: today });
  const rolling = avg7(data, today);

  return (
    <AppShell>
      <PageHeader
        title={format(new Date(), "EEEE, d MMMM")}
        subtitle="Log the day in under a minute."
      />

      <div className="grid grid-cols-3 gap-2">
        <Stat label="7-day avg" value={fmt(rolling, 1)} hint="kg" />
        <Stat label="Cal target" value={targets.calories} hint="kcal/day" />
        <Stat label="Gym" value={`${weekCount}/5`} hint="this week" tone={weekCount >= 5 ? "good" : "default"} />
      </div>

      <div className="mt-4 space-y-4">
        <Card>
          <SectionTitle>Morning</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bodyweight (kg)">
              <NumInput value={day?.weight} onChange={(v) => set({ weight: v })} placeholder="61.5" />
            </Field>
            <Field label="Waist (cm, optional)">
              <NumInput value={day?.waist} onChange={(v) => set({ waist: v })} placeholder="74.0" />
            </Field>
            <Field label="Sleep (hours)">
              <NumInput value={day?.sleepHours} onChange={(v) => set({ sleepHours: v })} placeholder="8" />
            </Field>
            <Field label="Sleep quality">
              <div className="mt-1 flex gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Chip key={n} active={day?.sleepQuality === n} onClick={() => set({ sleepQuality: n })}>
                    {n}
                  </Chip>
                ))}
              </div>
            </Field>
          </div>
          <div className="mt-3 space-y-2">
            <Note>
              Weigh yourself after using the bathroom, before food or drink, with no clothes or
              similar clothing, on the same scale and same floor position.
            </Note>
            <Note>Waist: measure once per week in the morning, relaxed, at the navel.</Note>
          </div>
        </Card>

        <Card>
          <SectionTitle>Nutrition</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Calories (kcal)">
              <NumInput value={day?.calories} onChange={(v) => set({ calories: v })} step="10" placeholder="2900" />
            </Field>
            <Field label="Protein (g)">
              <NumInput value={day?.protein} onChange={(v) => set({ protein: v })} step="1" placeholder="130" />
            </Field>
            <Field label="Carbs (g)">
              <NumInput value={day?.carbs} onChange={(v) => set({ carbs: v })} step="1" placeholder="380" />
            </Field>
            <Field label="Fat (g)">
              <NumInput value={day?.fat} onChange={(v) => set({ fat: v })} step="1" placeholder="85" />
            </Field>
            <Field label="Water (L)">
              <NumInput value={day?.water} onChange={(v) => set({ water: v })} placeholder="3" />
            </Field>
            <Field label="Creatine (5 g)">
              <div className="mt-1 flex gap-1.5">
                <Chip active={day?.creatine === true} onClick={() => set({ creatine: true })}>
                  Taken
                </Chip>
                <Chip active={day?.creatine === false} onClick={() => set({ creatine: false })}>
                  No
                </Chip>
              </div>
            </Field>
          </div>
          <div className="mt-4 space-y-2.5">
            <Bar label="Calories" value={day?.calories} target={targets.calories} unit="kcal" />
            <Bar label="Protein" value={day?.protein} target={targets.protein} unit="g" />
            <Bar label="Fat" value={day?.fat} target={targets.fat} unit="g" />
            <Bar label="Water" value={day?.water} target={targets.water} unit="L" />
          </div>
        </Card>

        <Card>
          <SectionTitle>Activity</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Steps">
              <NumInput value={day?.steps} onChange={(v) => set({ steps: v })} step="100" placeholder="8000" />
            </Field>
            <Field label="Cycling (km)">
              <NumInput value={day?.cyclingKm} onChange={(v) => set({ cyclingKm: v })} placeholder="6.5" />
            </Field>
            <Field label="Running (km)">
              <NumInput value={day?.runningKm} onChange={(v) => set({ runningKm: v })} placeholder="0" />
            </Field>
            <Field label="Cardio (min, optional)">
              <NumInput value={day?.cardioMin} onChange={(v) => set({ cardioMin: v })} step="1" placeholder="0" />
            </Field>
          </div>
          <Field label="Note (optional)">
            <input
              value={day?.note ?? ""}
              onChange={(e) => set({ note: e.target.value })}
              placeholder="Cycled to university, long day"
              className="mt-1 w-full rounded-xl border border-input bg-elevated px-3 py-2.5 text-sm outline-none focus:border-ring"
            />
          </Field>
        </Card>

        <Card>
          <SectionTitle
            right={
              <Link to="/training" className="text-xs font-medium text-primary">
                Log exercises →
              </Link>
            }
          >
            Gym
          </SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {WORKOUT_TYPES.map((t) => (
              <Chip
                key={t}
                active={day?.workoutType === t}
                onClick={() => set({ workoutType: t, gym: t !== "Rest" })}
              >
                {t}
              </Chip>
            ))}
          </div>
        </Card>

        <div className="card-surface sticky bottom-24 p-4">
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>Day completion</span>
            <span className="num font-semibold text-foreground">{completion}%</span>
          </div>
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${completion}%` }}
            />
          </div>
          <button
            onClick={() => {
              saveDay(today, {});
              setSaved(true);
            }}
            className="w-full rounded-xl bg-primary py-3 text-base font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
          >
            {saved ? "Saved ✓" : "Save Day"}
          </button>
        </div>
      </div>
    </AppShell>
  );
}

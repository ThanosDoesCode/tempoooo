import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { useMemo, useRef, useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Bar, Card, Chip, Field, Note, NumInput, SectionTitle, Stat } from "@/components/ui-kit";
import { bulkStatus, dayCompletion, fmt, iso, signed, weekDays, weekStartOf } from "@/lib/calc";
import { MEAL_PLANS, mealPlan, mealPlanSnapshot } from "@/lib/meals";
import { useActions, useAppData } from "@/lib/store";
import { RANGES, type MealPlanId, type WorkoutType } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/bulk/")({
  head: () => ({
    meta: [
      { title: "Tempo" },
      {
        name: "description",
        content: "Log bodyweight, nutrition, activity and training in under a minute with Tempo.",
      },
      { property: "og:title", content: "Tempo" },
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
  const [sync, setSync] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const revision = useRef(0);

  const day = data?.days[today];
  const targets = data?.targets;

  const weekCount = useMemo(() => {
    if (!data) return 0;
    return weekDays(weekStartOf(new Date())).filter((d) => data.days[d]?.gym).length;
  }, [data]);

  const status = useMemo(() => (data ? bulkStatus(data) : null), [data]);

  if (!data || !targets || !status) {
    return (
      <AppShell>
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      </AppShell>
    );
  }

  const set = (patch: Parameters<typeof saveDay>[1]) => {
    const version = ++revision.current;
    setSync("saving");
    void saveDay(today, patch)
      .then(() => {
        if (version === revision.current) setSync("saved");
      })
      .catch(() => {
        if (version === revision.current) setSync("error");
      });
  };

  const saveNow = async () => {
    const version = ++revision.current;
    setSync("saving");
    try {
      await saveDay(today, {});
      if (version === revision.current) setSync("saved");
    } catch {
      if (version === revision.current) setSync("error");
    }
  };

  const pickPlan = (id: MealPlanId) => {
    const plan = mealPlan(id);
    const mealSnapshot = plan ? mealPlanSnapshot(plan) : undefined;
    if (!plan?.macros) {
      set({ mealPlan: id, mealSnapshot });
      return;
    }
    set({
      mealPlan: id,
      mealSnapshot,
      calories: plan.macros.calories,
      protein: plan.macros.protein,
      carbs: plan.macros.carbs,
      fat: plan.macros.fat,
    });
  };

  const plan = mealPlan(day?.mealPlan);
  const completion = dayCompletion({ ...day, date: today }, !!data.workouts[today]);
  const toneClass =
    status.tone === "good"
      ? "text-good"
      : status.tone === "warn"
        ? "text-warn"
        : status.tone === "danger"
          ? "text-danger"
          : "text-muted-foreground";

  return (
    <AppShell>
      <PageHeader
        title={format(new Date(), "EEEE, d MMMM")}
        subtitle="Log the day in under a minute."
      />

      <div className="card-surface fade-up mb-2 flex items-center justify-between gap-3 p-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Bulk status
          </p>
          <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{status.label}</p>
        </div>
        <div className="text-right">
          <p className={`num text-2xl font-semibold ${toneClass}`}>{signed(status.rate, 2)}</p>
          <p className="text-[11px] text-muted-foreground">kg/week · target +0.20 to +0.30</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="7-day avg" value={fmt(status.currentAvg, 1)} hint="kg" />
        <Stat label="Cal target" value={targets.calories} hint="kcal/day" />
        <Stat
          label="Gym"
          value={`${weekCount}/5`}
          hint="this week"
          tone={weekCount >= 5 ? "good" : "default"}
        />
      </div>

      <div className="mt-4 space-y-4">
        <Card>
          <SectionTitle>Morning</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bodyweight (kg)">
              <NumInput
                value={day?.weight}
                onChange={(v) => set({ weight: v })}
                placeholder="61.5"
              />
            </Field>
            <Field label="Waist (cm, optional)">
              <NumInput value={day?.waist} onChange={(v) => set({ waist: v })} placeholder="74.0" />
            </Field>
            <Field label="Sleep (hours)">
              <NumInput
                value={day?.sleepHours}
                onChange={(v) => set({ sleepHours: v })}
                placeholder="8"
              />
            </Field>
            <Field label="Resting HR (optional)">
              <NumInput
                value={day?.restingHr}
                onChange={(v) => set({ restingHr: v })}
                step="1"
                placeholder="54"
              />
            </Field>
            <div className="col-span-2">
              <Field label="Sleep quality">
                <div className="mt-1 grid grid-cols-5 gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Chip
                      key={n}
                      active={day?.sleepQuality === n}
                      onClick={() => set({ sleepQuality: n })}
                    >
                      {n}
                    </Chip>
                  ))}
                </div>
              </Field>
            </div>
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
          <SectionTitle>Today&apos;s meal plan</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {MEAL_PLANS.map((m) => (
              <Chip key={m.id} active={day?.mealPlan === m.id} onClick={() => pickPlan(m.id)}>
                {m.short}
              </Chip>
            ))}
          </div>
          {plan ? (
            <div className="mt-3 rounded-xl bg-elevated/70 p-3 text-xs leading-relaxed">
              <p className="text-sm font-semibold">{plan.name}</p>
              {plan.base.length ? (
                <>
                  <p className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                    Daily base
                  </p>
                  <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
                    {plan.base.map((b) => (
                      <li key={b}>· {b}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              <p className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                Main meals
              </p>
              <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
                {plan.meals.map((b) => (
                  <li key={b}>· {b}</li>
                ))}
              </ul>
              {plan.macros ? (
                <p className="num mt-2 font-medium">
                  Daily total: ≈ {plan.macros.calories} kcal · {plan.macros.protein} P ·{" "}
                  {plan.macros.carbs} C · {plan.macros.fat} F
                </p>
              ) : null}
            </div>
          ) : null}
        </Card>

        <Card>
          <SectionTitle>Nutrition</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Calories (kcal)" hint="target 2,900">
              <NumInput
                value={day?.calories}
                onChange={(v) => set({ calories: v })}
                step="10"
                placeholder="2900"
              />
            </Field>
            <Field label="Protein (g)" hint="125 to 140 g">
              <NumInput
                value={day?.protein}
                onChange={(v) => set({ protein: v })}
                step="1"
                placeholder="130"
              />
            </Field>
            <Field label="Carbs (g)" hint="around 380 g">
              <NumInput
                value={day?.carbs}
                onChange={(v) => set({ carbs: v })}
                step="1"
                placeholder="380"
              />
            </Field>
            <Field label="Fat (g)" hint="80 to 90 g">
              <NumInput
                value={day?.fat}
                onChange={(v) => set({ fat: v })}
                step="1"
                placeholder="88"
              />
            </Field>
            <Field label="Water (L)" hint="3 L">
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
            <Bar
              label="Calories"
              value={day?.calories}
              target={targets.calories}
              unit="kcal"
              range={RANGES.calories}
            />
            <Bar
              label="Protein"
              value={day?.protein}
              target={targets.protein}
              unit="g"
              range={RANGES.protein}
            />
            <Bar
              label="Carbs"
              value={day?.carbs}
              target={targets.carbs}
              unit="g"
              range={RANGES.carbs}
            />
            <Bar label="Fat" value={day?.fat} target={targets.fat} unit="g" range={RANGES.fat} />
            <Bar label="Water" value={day?.water} target={targets.water} unit="L" />
          </div>
        </Card>

        <Card>
          <SectionTitle>Activity</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Steps">
              <NumInput
                value={day?.steps}
                onChange={(v) => set({ steps: v })}
                step="100"
                placeholder="8000"
              />
            </Field>
            <Field label="Cycling (km)">
              <NumInput
                value={day?.cyclingKm}
                onChange={(v) => set({ cyclingKm: v })}
                placeholder="6.5"
              />
            </Field>
            <Field label="Running (km)">
              <NumInput
                value={day?.runningKm}
                onChange={(v) => set({ runningKm: v })}
                placeholder="0"
              />
            </Field>
            <Field label="Cardio (min, optional)">
              <NumInput
                value={day?.cardioMin}
                onChange={(v) => set({ cardioMin: v })}
                step="1"
                placeholder="0"
              />
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
              <Link to="/bulk/training" className="text-xs font-medium text-primary">
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

        <div className="card-surface p-4">
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
            onClick={() => void saveNow()}
            disabled={sync === "saving"}
            className="w-full rounded-xl bg-primary py-3 text-base font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {sync === "saving" ? "Saving day…" : sync === "saved" ? "Saved ✓" : "Save Day"}
          </button>
          {sync === "error" ? (
            <p role="alert" className="mt-2 text-xs text-danger">
              Your latest change was not saved. Check your connection and try again.
            </p>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}

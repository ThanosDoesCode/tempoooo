import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/AppShell";
import { BulkNutritionLog } from "@/components/BulkNutritionLog";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui-kit";
import { iso } from "@/lib/calc";
import { mealPlan } from "@/lib/meals";
import { useAppData, useBulkMeta } from "@/lib/store";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/bulk/meals")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: BulkMealsPage,
});

function BulkMealsPage() {
  const { bulkId } = useBulkMeta();
  const data = useAppData();
  const [selectedDate, setSelectedDate] = useState(() => iso(new Date()));
  const publicNutrition = !!data?.targets.trainingSetupPreference;
  const legacyDay = data?.days[selectedDate];
  const legacyPlan = mealPlan(legacyDay?.mealPlan);

  return (
    <AppShell>
      <PageHeader
        title="Meals"
        subtitle={
          publicNutrition
            ? "Today's nutrition, remaining targets and logged meals."
            : "Today's saved nutrition and meal plan."
        }
      />
      {bulkId && publicNutrition && data ? (
        <BulkNutritionLog
          bulkProfileId={bulkId}
          selectedDate={selectedDate}
          onDateChange={setSelectedDate}
          currentTargets={{
            calories: data.targets.calories,
            protein: data.targets.protein,
            carbs: data.targets.carbs,
            fat: data.targets.fat,
          }}
        />
      ) : bulkId && data ? (
        <Card>
          <SectionTitle>Today&apos;s nutrition</SectionTitle>
          <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
            <LegacyMacro label="Calories" value={legacyDay?.calories} unit="kcal" />
            <LegacyMacro label="Protein" value={legacyDay?.protein} unit="g" />
            <LegacyMacro label="Carbs" value={legacyDay?.carbs} unit="g" />
            <LegacyMacro label="Fat" value={legacyDay?.fat} unit="g" />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Meal plan: <span className="text-foreground">{legacyPlan?.name ?? "Not selected"}</span>
          </p>
          <Button asChild className="mt-4 min-h-11 w-full">
            <Link to="/bulk">Open daily log</Link>
          </Button>
        </Card>
      ) : null}
    </AppShell>
  );
}

function LegacyMacro({
  label,
  value,
  unit,
}: {
  label: string;
  value: number | undefined;
  unit: string;
}) {
  return (
    <p className="text-muted-foreground">
      {label}
      <strong className="block text-foreground">
        {value == null ? "—" : `${Math.round(value)} ${unit}`}
      </strong>
    </p>
  );
}

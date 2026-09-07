import { createFileRoute, useLocation } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/AppShell";
import { BulkMealPresets } from "@/components/BulkMealPresets";
import { BulkNutritionLog } from "@/components/BulkNutritionLog";
import { Chip } from "@/components/ui-kit";
import { iso } from "@/lib/calc";
import { useAppData, useBulkMeta } from "@/lib/store";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authenticated/bulk/meals")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: BulkMealsPage,
});

function BulkMealsPage() {
  const { bulkId } = useBulkMeta();
  const data = useAppData();
  const [view, setView] = useState<"daily" | "presets">("daily");
  const { hash } = useLocation();
  const [selectedDate, setSelectedDate] = useState(() => iso(new Date()));
  const publicNutrition = !!data?.targets.trainingSetupPreference;

  useEffect(() => {
    if (hash === "presets") setView("presets");
    else if (!hash) setView("daily");
  }, [hash]);

  return (
    <AppShell>
      <PageHeader
        title="Meals"
        subtitle={
          publicNutrition
            ? "Daily nutrition and reusable meal presets."
            : "Reusable meals with your own ingredients and macros."
        }
      />
      {bulkId && publicNutrition && data ? (
        <>
          <div className="mb-4 flex gap-2" aria-label="Meals view">
            <Chip active={view === "daily"} onClick={() => setView("daily")}>
              Daily Log
            </Chip>
            <Chip active={view === "presets"} onClick={() => setView("presets")}>
              Meal Presets
            </Chip>
          </div>
          <div hidden={view !== "daily"}>
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
          </div>
          <div id="presets" hidden={view !== "presets"}>
            <BulkMealPresets bulkProfileId={bulkId} />
          </div>
        </>
      ) : bulkId ? (
        <BulkMealPresets bulkProfileId={bulkId} />
      ) : null}
    </AppShell>
  );
}

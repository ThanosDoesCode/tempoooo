import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RefreshCcw } from "lucide-react";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, Note, PendingLabel, SectionTitle } from "@/components/ui-kit";
import { bulkPlanModeFor, deactivatePublicGoal, useMemberships } from "@/lib/bulk-access";
import { userFacingError } from "@/lib/network-errors";
import { clearBulk, useBulkMeta } from "@/lib/store";
import { NutritionTargetsEditor } from "@/components/NutritionTargetsEditor";
import { WeeklyWorkoutGoalEditor } from "@/components/WeeklyWorkoutGoalEditor";
import { UnsavedSettingsDialog } from "@/components/UnsavedSettingsDialog";
import { WeightGoalConfigurationEditor } from "@/components/WeightGoalConfigurationEditor";
import { useBulkToday } from "@/lib/bulk-today-query";
import { weightGoalConfiguration } from "@/lib/weekly-progress-coach";
import { iso } from "@/lib/calc";

export const Route = createFileRoute("/_authenticated/bulk/more")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: BulkMorePage,
});

function BulkMorePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const memberships = useMemberships();
  const { bulkId } = useBulkMeta();
  const planMode = bulkPlanModeFor(memberships.data, bulkId);
  const savedQuery = useBulkToday(planMode === "public" ? bulkId : null, iso(new Date()));
  const savedWeightGoal = weightGoalConfiguration(savedQuery.data?.savedTargets);
  const [confirming, setConfirming] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [nutritionDirty, setNutritionDirty] = useState(false);
  const [weeklyDirty, setWeeklyDirty] = useState(false);
  const [weightDirty, setWeightDirty] = useState(false);
  const currentGoal = savedQuery.error
    ? "Goal details unavailable"
    : savedQuery.isLoading || savedQuery.data === undefined
      ? "Loading goal details…"
      : savedWeightGoal.goal === "cut"
        ? "Cut"
        : savedWeightGoal.goal === "maintain"
          ? "Maintain"
          : savedWeightGoal.goal === "gain"
            ? "Bulk"
            : "Goal type not set";

  const changeGoal = async () => {
    if (switching || planMode !== "public" || !bulkId) return;
    setSwitching(true);
    setSwitchError(null);
    try {
      await deactivatePublicGoal();
      clearBulk();
      queryClient.setQueryData(
        ["bulk-memberships"],
        memberships.data?.map((membership) =>
          membership.bulk_profile_id === bulkId ? { ...membership, is_active: false } : membership,
        ) ?? [],
      );
      await queryClient.invalidateQueries({
        predicate: ({ queryKey }) => String(queryKey[0] ?? "").startsWith("bulk"),
      });
      await navigate({ to: "/bulk-onboarding", replace: true });
    } catch (error) {
      setSwitchError(userFacingError(error, "change your goal"));
      setSwitching(false);
    }
  };

  return (
    <AppShell>
      <PageHeader
        title="Goal settings"
        subtitle="Your goal, daily targets and weekly workouts."
        backTo="/profile"
        backLabel="Profile"
      />
      <UnsavedSettingsDialog dirty={(nutritionDirty || weeklyDirty || weightDirty) && !switching} />
      <div className="space-y-3">
        {planMode === "public" ? (
          <Card>
            <SectionTitle>Current goal</SectionTitle>
            <p className="text-lg font-semibold">{currentGoal}</p>
            <dl className="mt-3 space-y-2 text-[13px]">
              {savedWeightGoal.targetWeight != null ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Target weight</dt>
                  <dd>{savedWeightGoal.targetWeight} kg</dd>
                </div>
              ) : null}
              {savedWeightGoal.pace != null ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">
                    Weekly {currentGoal === "Cut" ? "loss" : "change"}
                  </dt>
                  <dd>{savedWeightGoal.pace} kg</dd>
                </div>
              ) : null}
            </dl>
            {!confirming ? (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold text-primary active:bg-elevated"
              >
                <RefreshCcw className="h-4 w-4" aria-hidden="true" /> Change goal
              </button>
            ) : (
              <div className="mt-4">
                {nutritionDirty || weeklyDirty || weightDirty ? (
                  <p className="mb-2 text-sm text-warn">Unsaved target changes will be lost.</p>
                ) : null}
                <Note>
                  Changing goal resets your current calorie, macro, weight-target and active plan
                  setup. Your meal presets, completed history, account and Challenge data stay safe.
                </Note>
                {switchError ? (
                  <p role="alert" className="mt-3 text-sm text-warn">
                    {switchError}
                  </p>
                ) : null}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={switching}
                    onClick={() => {
                      setConfirming(false);
                      setSwitchError(null);
                    }}
                    className="min-h-11 rounded-xl border border-border px-3 text-sm font-medium disabled:opacity-60"
                  >
                    Keep current goal
                  </button>
                  <button
                    type="button"
                    disabled={switching}
                    onClick={() => void changeGoal()}
                    className="flex min-h-11 items-center justify-center rounded-xl bg-danger px-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                  >
                    {switching ? (
                      <PendingLabel>Resetting Goal...</PendingLabel>
                    ) : (
                      "Reset and change"
                    )}
                  </button>
                </div>
              </div>
            )}
          </Card>
        ) : null}
        {planMode === "public" ? (
          <WeightGoalConfigurationEditor
            key={bulkId}
            query={savedQuery}
            onDirtyChange={setWeightDirty}
          />
        ) : null}
        {planMode === "public" ? <WeeklyWorkoutGoalEditor onDirtyChange={setWeeklyDirty} /> : null}
        {planMode === "public" || planMode === "legacy" ? (
          <NutritionTargetsEditor onDirtyChange={setNutritionDirty} />
        ) : null}
      </div>
    </AppShell>
  );
}

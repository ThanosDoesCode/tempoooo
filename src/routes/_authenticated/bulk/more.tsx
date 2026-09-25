import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RefreshCcw } from "lucide-react";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, Note, PendingLabel, SectionTitle } from "@/components/ui-kit";
import { bulkPlanModeFor, deactivatePublicGoal, useMemberships } from "@/lib/bulk-access";
import { userFacingError } from "@/lib/network-errors";
import { clearBulk, useAppData, useBulkMeta } from "@/lib/store";
import { NutritionTargetsEditor } from "@/components/NutritionTargetsEditor";

export const Route = createFileRoute("/_authenticated/bulk/more")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: BulkMorePage,
});

function BulkMorePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const memberships = useMemberships();
  const { bulkId } = useBulkMeta();
  const data = useAppData();
  const planMode = bulkPlanModeFor(memberships.data, bulkId);
  const [confirming, setConfirming] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const currentGoal =
    data?.targets.goal === "cut" ? "Cut" : data?.targets.goal === "maintain" ? "Maintain" : "Bulk";

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
      <PageHeader title="Goal settings" subtitle="Configure your Goal and daily targets." />
      <div className="space-y-3">
        {planMode === "public" ? (
          <Card>
            <SectionTitle>Current goal</SectionTitle>
            <p className="text-lg font-semibold">{currentGoal}</p>
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
                <Note>
                  Changing goal resets your current calorie, macro, weight-target and active plan
                  setup. Your meal presets, completed history, account and Challenge data stay safe.
                </Note>
                {switchError ? (
                  <p role="alert" className="mt-3 text-sm text-danger">
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
        {planMode === "public" || planMode === "legacy" ? <NutritionTargetsEditor /> : null}
      </div>
    </AppShell>
  );
}

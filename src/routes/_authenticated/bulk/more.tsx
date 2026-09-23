import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RefreshCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, Note, PendingLabel, SectionTitle } from "@/components/ui-kit";
import { bulkPlanModeFor, deactivatePublicGoal, useMemberships } from "@/lib/bulk-access";
import { userFacingError } from "@/lib/network-errors";
import { clearBulk, useAppData, useBulkMeta } from "@/lib/store";
import { localDay } from "@/lib/bulk-progress";
import { useBulkWeights } from "@/lib/bulk-progress-query";
import { useGoalSettingsDashboard } from "@/lib/goal-settings-dashboard";
import { buildCheckInConsistency } from "@/lib/goal-check-in-consistency";

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
  const today = localDay(new Date());
  const weights = useBulkWeights(
    planMode === "public" ? bulkId : null,
    localDay(addDays(new Date(), -30)),
  );
  const dashboard = useGoalSettingsDashboard(planMode === "public" ? bulkId : null);
  const chronologicalWeights = useMemo(
    () => [...(weights.data ?? [])].sort((a, b) => a.logDate.localeCompare(b.logDate)),
    [weights.data],
  );
  const checkInWeeks = useMemo(
    () =>
      dashboard.data
        ? buildCheckInConsistency(
            dashboard.data.goalStartedAt,
            dashboard.data.completedWeekStarts,
            today,
          )
        : [],
    [dashboard.data, today],
  );
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
      <PageHeader title="Goal settings" subtitle="Manage your Goal and review related tools." />
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
        {planMode === "public" ? (
          <>
            <Card>
              <SectionTitle>Weight trend</SectionTitle>
              {weights.isLoading ? (
                <div className="h-28 animate-pulse rounded-xl bg-elevated" />
              ) : weights.error ? (
                <button
                  className="min-h-11 text-sm font-semibold text-danger"
                  onClick={() => void weights.refetch()}
                >
                  Weight could not load. Retry
                </button>
              ) : chronologicalWeights.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Log weight in Goal Today to start your 30-day trend.
                </p>
              ) : (
                <div>
                  <div className="flex items-end justify-between gap-3">
                    <p className="num text-2xl font-semibold">
                      {chronologicalWeights.at(-1)!.weightKg.toFixed(1)} kg
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {chronologicalWeights.length > 1
                        ? `${chronologicalWeights.at(-1)!.weightKg - chronologicalWeights[0]!.weightKg >= 0 ? "+" : ""}${(chronologicalWeights.at(-1)!.weightKg - chronologicalWeights[0]!.weightKg).toFixed(1)} kg in 30 days`
                        : "One measurement"}
                    </p>
                  </div>
                  {chronologicalWeights.length > 1 ? (
                    <div className="mt-3 h-28" aria-label="30-day weight trend chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={chronologicalWeights}
                          margin={{ top: 8, right: 4, bottom: 0, left: -24 }}
                        >
                          <XAxis
                            dataKey="logDate"
                            tickFormatter={(value) =>
                              format(new Date(`${value}T12:00:00`), "d MMM")
                            }
                            tick={{ fontSize: 10 }}
                          />
                          <YAxis domain={["dataMin - 1", "dataMax + 1"]} tick={{ fontSize: 10 }} />
                          <Tooltip
                            labelFormatter={(value) =>
                              format(new Date(`${value}T12:00:00`), "d MMM yyyy")
                            }
                            formatter={(value) => [`${Number(value).toFixed(1)} kg`, "Weight"]}
                          />
                          <Line
                            type="monotone"
                            dataKey="weightKg"
                            stroke="var(--primary)"
                            strokeWidth={2}
                            dot={false}
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : null}
                </div>
              )}
            </Card>
            <Card>
              <SectionTitle>Weekly check-ins</SectionTitle>
              {dashboard.isLoading ? (
                <div className="h-14 animate-pulse rounded-xl bg-elevated" />
              ) : dashboard.error ? (
                <button
                  className="min-h-11 text-sm font-semibold text-danger"
                  onClick={() => void dashboard.refetch()}
                >
                  Check-ins could not load. Retry
                </button>
              ) : (
                <div
                  className="grid grid-cols-8 gap-1"
                  aria-label="Previous eight weekly check-ins"
                >
                  {checkInWeeks.map((week) => (
                    <div key={week.weekStart} className="text-center">
                      <span
                        role="img"
                        aria-label={`${week.label}: ${week.status.replace("-", " ")}`}
                        className={`mx-auto block h-4 w-4 rounded-full ${week.status === "completed" ? "bg-primary" : week.status === "missed" ? "bg-danger/80" : week.status === "current-incomplete" ? "border-2 border-primary" : "bg-muted"}`}
                      />
                      <span className="mt-1 block text-[9px] text-muted-foreground">
                        {week.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

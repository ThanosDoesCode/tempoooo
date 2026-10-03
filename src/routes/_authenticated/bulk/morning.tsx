import { createFileRoute } from "@tanstack/react-router";
import { addDays, parseISO } from "date-fns";
import { AppShell, PageHeader } from "@/components/AppShell";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DataError } from "@/components/ui-kit";
import { DailyCheckIn } from "@/components/DailyCheckIn";
import { iso } from "@/lib/calc";
import { useAppData, useBulkMeta } from "@/lib/store";
import { bulkPlanModeFor, useMemberships } from "@/lib/bulk-access";
import { useBulkWeights } from "@/lib/bulk-progress-query";
import { useLocalDay } from "@/lib/use-local-day";
export const Route = createFileRoute("/_authenticated/bulk/morning")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: MorningPage,
});
function MorningPage() {
  const today = useLocalDay();
  const data = useAppData();
  const { bulkId } = useBulkMeta();
  const memberships = useMemberships();
  const publicGoal = bulkPlanModeFor(memberships.data, bulkId) === "public";
  const weights = useBulkWeights(publicGoal ? bulkId : null, today);
  return (
    <AppShell>
      <PageHeader
        title="Morning check-in"
        backTo="/bulk"
        backLabel="Today"
        subtitle="Before breakfast, same scale every day."
      />
      {!bulkId || !data || (publicGoal && weights.isLoading) ? (
        <PageSkeleton label="Loading check-in" />
      ) : publicGoal && weights.error ? (
        <DataError
          message="Could not load your weight. Your check-in is unchanged."
          onRetry={() => void weights.refetch()}
        />
      ) : (
        <DailyCheckIn
          key={`${bulkId}:${today}`}
          profileId={bulkId}
          date={today}
          publicGoal={publicGoal}
          weightNote={weights.data?.find((w) => w.logDate === today)?.note}
          day={data.days[today]}
          yesterdayDay={data.days[iso(addDays(parseISO(today), -1))]}
          weight={
            publicGoal
              ? weights.data?.find((w) => w.logDate === today)?.weightKg
              : data.days[today]?.weight
          }
        />
      )}
    </AppShell>
  );
}

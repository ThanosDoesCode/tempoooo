import { createFileRoute, Link } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { z } from "zod";
import { AppShell, PageHeader } from "@/components/AppShell";
import { HistoryBackLink } from "@/components/HistoryBackLink";
import { Card, DataError, SectionTitle } from "@/components/ui-kit";
import { useStrengthModel } from "@/lib/progress-model";
import { progressRange, recordsPeriodTitle, PROGRESS_PERIODS } from "@/lib/progress-period";
import { progressRecordEvents, workingPerformanceLabel } from "@/lib/strength-progress";
import { ExerciseRecordSummary } from "@/components/ExerciseRecordSummary";
import {
  groupExerciseRecords,
  resolveExerciseRecord,
  exerciseRecordKey,
  type ExerciseRecord,
} from "@/lib/exercise-records";
import { userFacingError } from "@/lib/network-errors";
import type { PersonalRecord } from "@/lib/personal-records";

export const Route = createFileRoute("/_authenticated/bulk/prs")({
  validateSearch: z.object({
    record: z.string().optional(),
    period: z.enum(PROGRESS_PERIODS).optional(),
  }),
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: PersonalRecordsPage,
});

const number = (value: number | null) =>
  value == null ? "—" : value.toLocaleString("en-GB", { maximumFractionDigits: 1 });

function PersonalRecordsPage() {
  const { record: selectedKey, period } = Route.useSearch();
  const { records, loading, error, refetch } = useStrengthModel();
  const events = period ? progressRecordEvents(records, progressRange(period)) : [];
  const groups = groupExerciseRecords(records);
  const selected = selectedKey ? resolveExerciseRecord(groups, selectedKey) : undefined;
  const eventGroupKey = (record: PersonalRecord) =>
    resolveExerciseRecord(groups, record.key)?.key ?? exerciseRecordKey(record);

  return (
    <AppShell>
      {selected ? (
        <RecordDetail group={selected} />
      ) : (
        <>
          <PageHeader
            title={period ? recordsPeriodTitle(period) : "Personal records"}
            subtitle={
              period
                ? "Each record-setting performance, newest first."
                : "Your strongest completed performances."
            }
            historyBack
            backTo="/bulk/training"
            backLabel="Training"
          />
          {error ? (
            <DataError
              message={userFacingError(error, "load your personal records")}
              onRetry={() => void refetch()}
            />
          ) : loading ? (
            <div className="h-40 animate-pulse rounded-2xl bg-card" />
          ) : period ? (
            <div className="space-y-2">
              {events.length ? (
                groups
                  .filter((group) =>
                    events.some((event) => eventGroupKey(event.record) === group.key),
                  )
                  .sort(
                    (a, b) =>
                      events.findIndex((event) => eventGroupKey(event.record) === a.key) -
                      events.findIndex((event) => eventGroupKey(event.record) === b.key),
                  )
                  .map((group) => (
                    <Card key={group.key} className="min-w-0 space-y-2">
                      <Link
                        to="/bulk/prs"
                        search={{ record: group.key }}
                        preload="intent"
                        className="flex min-h-11 items-center break-words font-semibold"
                      >
                        {group.name}
                      </Link>
                      {events
                        .filter((event) => eventGroupKey(event.record) === group.key)
                        .map((event) => (
                          <div key={event.id} className="border-t border-border py-2">
                            <p className="num break-words text-sm">
                              {event.record.side
                                ? `${event.record.side === "left" ? "Left" : "Right"}: `
                                : ""}
                              {event.kind === "volume"
                                ? `${number(event.performance.volume)} kg volume`
                                : event.kind === "reps"
                                  ? `${event.performance.repCount} reps${event.performance.repLoad != null ? ` @ ${number(event.performance.repLoad)} kg` : ""}`
                                  : workingPerformanceLabel(
                                      { ...event.record, side: null },
                                      event.performance,
                                    )}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {format(parseISO(event.performance.date), "d MMM yyyy")} ·{" "}
                              {event.kind === "weight"
                                ? "Weight PR"
                                : event.kind === "reps"
                                  ? "Rep PR"
                                  : "Volume PR"}
                            </p>
                          </div>
                        ))}
                    </Card>
                  ))
              ) : (
                <Card>
                  <p className="font-semibold">No records in this period</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Recorded workouts are still available in workout history.
                  </p>
                </Card>
              )}
            </div>
          ) : records.length ? (
            <div className="space-y-2">
              {groups.map((group) => (
                <Link
                  key={group.key}
                  to="/bulk/prs"
                  search={{ record: group.key }}
                  preload="intent"
                  className="card-surface block min-h-16 min-w-0 space-y-2 p-4 active:opacity-80"
                >
                  <p className="break-words font-semibold">{group.name}</p>
                  <ExerciseRecordSummary group={group} range={progressRange("all")} kind="best" />
                  <p className="text-xs text-muted-foreground">
                    {
                      new Set(
                        group.records.flatMap((record) => record.performances.map((p) => p.date)),
                      ).size
                    }{" "}
                    completed performances · Open exercise history
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <Card className="text-center">
              <p className="font-semibold">No personal records yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Complete a workout to start building your PR history.
              </p>
            </Card>
          )}
        </>
      )}
    </AppShell>
  );
}

function RecordDetail({ group }: { group: ExerciseRecord }) {
  return (
    <>
      <HistoryBackLink
        fallback="/bulk/prs"
        fallbackLabel="Personal records"
        parentPath="/bulk/prs"
        fallbackSearch={{}}
      />
      <div className="[&_h1]:break-words">
        <PageHeader title={group.name} subtitle="Completed history" />
      </div>
      <Card className="mb-4">
        <ExerciseRecordSummary group={group} range={progressRange("all")} kind="best" />
      </Card>
      {group.records.map((record) => (
        <SideRecordHistory
          key={record.key}
          record={record}
          showLabel={group.records.length > 1 || record.side != null}
        />
      ))}
      {group.records.some((record) => record.isBodyweight) ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Bodyweight records show the saved bodyweight when available. Public sessions retain
          external load separately and never invent missing bodyweight.
        </p>
      ) : null}
    </>
  );
}
function SideRecordHistory({ record, showLabel }: { record: PersonalRecord; showLabel: boolean }) {
  return (
    <section className="mb-5 min-w-0">
      {showLabel ? (
        <h2 className="mb-2 text-base font-semibold">
          {record.side === "left" ? "Left" : record.side === "right" ? "Right" : "Standard"}
        </h2>
      ) : null}
      <div className="grid grid-cols-3 gap-2">
        <RecordCard
          label="Weight PR"
          value={`${number(record.bestWeight?.load ?? null)} kg`}
          date={record.bestWeight?.date}
        />
        <RecordCard
          label="Rep PR"
          value={
            record.bestReps
              ? `${record.bestReps.repCount} @ ${number(record.bestReps.repLoad)} kg`
              : "—"
          }
          date={record.bestReps?.date}
        />
        <RecordCard
          label="Volume PR"
          value={`${number(record.bestVolume?.volume ?? null)} kg`}
          date={record.bestVolume?.date}
        />
      </div>{" "}
      <section className="mt-5">
        <SectionTitle>History</SectionTitle>
        <div className="mt-2 space-y-2">
          {record.performances.map((performance, index) => (
            <Card
              key={`${performance.date}:${index}`}
              className="flex min-w-0 flex-wrap items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {new Date(performance.date).toLocaleDateString("en-GB")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {number(performance.load)} kg · {performance.reps} reps
                  {performance.bodyweight != null
                    ? ` · BW ${number(performance.bodyweight)} kg`
                    : ""}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {number(performance.volume)} kg volume
              </span>
            </Card>
          ))}
        </div>
      </section>
    </section>
  );
}

function RecordCard({
  label,
  value,
  date,
}: {
  label: string;
  value: string;
  date: string | undefined;
}) {
  return (
    <Card className="min-w-0 p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="num mt-1 break-words text-sm font-semibold">{value}</p>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {date ? new Date(date).toLocaleDateString("en-GB") : "No data"}
      </p>
    </Card>
  );
}

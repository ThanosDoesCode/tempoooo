import { createFileRoute, Link } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { Trophy } from "lucide-react";
import { z } from "zod";
import { AppShell, PageHeader } from "@/components/AppShell";
import { HistoryBackLink } from "@/components/HistoryBackLink";
import { Card, DataError, SectionTitle } from "@/components/ui-kit";
import { useStrengthModel } from "@/lib/progress-model";
import { progressRange, recordsPeriodTitle, PROGRESS_PERIODS } from "@/lib/progress-period";
import { progressRecordEvents, workingPerformanceLabel } from "@/lib/strength-progress";
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
  const selected = records.find((item) => item.key === selectedKey);

  return (
    <AppShell>
      {selected ? (
        <RecordDetail record={selected} />
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
                events.map((event) => (
                  <Link
                    key={event.id}
                    to="/bulk/prs"
                    search={{ record: event.record.key }}
                    preload="intent"
                    className="card-surface block min-h-16 p-4 active:opacity-80"
                  >
                    <p className="break-words font-semibold">
                      {event.record.name}
                      {event.record.side ? ` · ${event.record.side}` : ""}
                    </p>
                    <p className="num mt-1 text-sm">
                      {event.kind === "volume"
                        ? `${number(event.performance.volume)} kg volume`
                        : event.kind === "reps"
                          ? `${event.performance.repCount} reps${event.performance.repLoad != null ? ` @ ${number(event.performance.repLoad)} kg` : ""}`
                          : workingPerformanceLabel(event.record, event.performance)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {format(parseISO(event.performance.date), "d MMM yyyy")} ·{" "}
                      {event.kind === "weight"
                        ? "Weight PR"
                        : event.kind === "reps"
                          ? "Rep PR"
                          : "Volume PR"}{" "}
                      · Open exercise history
                    </p>
                  </Link>
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
              {records.map((record) => (
                <Link
                  key={record.key}
                  to="/bulk/prs"
                  search={{ record: record.key }}
                  className="card-surface flex min-h-16 items-center justify-between gap-3 p-4 active:scale-[0.99]"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{record.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {record.side ? `${record.side} side · ` : ""}
                      {record.performances.length} completed performance
                      {record.performances.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Trophy className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
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

function RecordDetail({ record }: { record: PersonalRecord }) {
  return (
    <>
      <HistoryBackLink
        fallback="/bulk/prs"
        fallbackLabel="Personal records"
        parentPath="/bulk/prs"
        fallbackSearch={{}}
      />
      <PageHeader
        title={record.name}
        subtitle={record.side ? `${record.side} side` : "Completed history"}
      />
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
      </div>
      {record.isBodyweight ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Bodyweight records show the saved bodyweight when available. Public sessions retain
          external load separately and never invent missing bodyweight.
        </p>
      ) : null}
      <section className="mt-5">
        <SectionTitle>History</SectionTitle>
        <div className="mt-2 space-y-2">
          {record.performances.map((performance, index) => (
            <Card
              key={`${performance.date}:${index}`}
              className="flex items-center justify-between gap-3"
            >
              <div>
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
    </>
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
      <p className="num mt-1 truncate text-sm font-semibold">{value}</p>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {date ? new Date(date).toLocaleDateString("en-GB") : "No data"}
      </p>
    </Card>
  );
}

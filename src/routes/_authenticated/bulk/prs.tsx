import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Trophy } from "lucide-react";
import { z } from "zod";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, DataError, SectionTitle } from "@/components/ui-kit";
import { useAppData, useBulkMeta } from "@/lib/store";
import { fetchRecentCompletedBulkTrainingSessions } from "@/lib/bulk-training-sessions";
import { readRetryDelay, shouldRetryRead, userFacingError } from "@/lib/network-errors";
import {
  deriveLegacyPersonalRecords,
  derivePublicPersonalRecords,
  type PersonalRecord,
} from "@/lib/personal-records";
import { bulkPlanModeFor, useMemberships } from "@/lib/bulk-access";

export const Route = createFileRoute("/_authenticated/bulk/prs")({
  validateSearch: z.object({ record: z.string().optional() }),
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: PersonalRecordsPage,
});

const number = (value: number | null) =>
  value == null ? "—" : value.toLocaleString("en-GB", { maximumFractionDigits: 1 });

function PersonalRecordsPage() {
  const data = useAppData();
  const { bulkId } = useBulkMeta();
  const memberships = useMemberships();
  const navigate = useNavigate();
  const { record: selectedKey } = Route.useSearch();
  const planMode = bulkPlanModeFor(memberships.data, bulkId);
  const isPublic = planMode === "public";
  const sessions = useQuery({
    queryKey: ["bulk-personal-records", bulkId],
    enabled: isPublic && !!bulkId,
    queryFn: () => fetchRecentCompletedBulkTrainingSessions(bulkId!, 500),
    staleTime: 60_000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });
  const records =
    data && planMode !== "none"
      ? isPublic
        ? derivePublicPersonalRecords(sessions.data ?? [])
        : deriveLegacyPersonalRecords(data)
      : [];
  const selected = records.find((item) => item.key === selectedKey);

  return (
    <AppShell>
      {selected ? (
        <RecordDetail
          record={selected}
          onBack={() => void navigate({ to: "/bulk/prs", search: {}, replace: true })}
        />
      ) : (
        <>
          <PageHeader title="Personal Records" subtitle="Your strongest completed performances." />
          {sessions.error && isPublic ? (
            <DataError
              message={userFacingError(sessions.error, "load your personal records")}
              onRetry={() => void sessions.refetch()}
            />
          ) : sessions.isLoading && isPublic ? (
            <div className="h-40 animate-pulse rounded-2xl bg-card" />
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

function RecordDetail({ record, onBack }: { record: PersonalRecord; onBack: () => void }) {
  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="mb-2 inline-flex min-h-11 items-center gap-2 rounded-xl pr-3 text-sm font-semibold text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Personal Records
      </button>
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

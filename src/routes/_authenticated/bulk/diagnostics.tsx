import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { format, formatDistanceToNowStrict } from "date-fns";
import { RefreshCw } from "lucide-react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, DataError, PendingLabel, SectionTitle, Stat } from "@/components/ui-kit";
import { getAdminDiagnostics } from "@/lib/privileged-rpcs.functions";
import { userFacingError } from "@/lib/network-errors";
import { bulkAdminQueryOptions } from "@/lib/bulk-access";

export const Route = createFileRoute("/_authenticated/bulk/diagnostics")({
  beforeLoad: async ({ context }) => {
    const isAdmin = await context.queryClient.ensureQueryData(bulkAdminQueryOptions());
    if (!isAdmin) throw redirect({ to: "/bulk", replace: true });
  },
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: DiagnosticsPage,
});

const diagnosticsQuery = () => ({
  queryKey: ["admin-diagnostics"],
  queryFn: () => getAdminDiagnostics(),
  staleTime: 15_000,
});

function DiagnosticsPage() {
  const query = useQuery(diagnosticsQuery());
  const data = query.data;

  return (
    <AppShell>
      <PageHeader
        title="Diagnostics"
        subtitle="Private operational status for Tempo administrators."
      />
      {query.isLoading ? (
        <div className="space-y-3" aria-label="Loading diagnostics">
          <div className="h-24 animate-pulse rounded-2xl bg-card" />
          <div className="h-40 animate-pulse rounded-2xl bg-card" />
        </div>
      ) : query.error || !data ? (
        <DataError
          title="Could not load diagnostics"
          message={userFacingError(query.error, "load diagnostics")}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Sent · 24h" value={data.counts.sent} tone="good" />
            <Stat
              label="Retrying"
              value={data.retrying.length}
              tone={data.retrying.length ? "warn" : "muted"}
            />
            <Stat
              label="Failed · 24h"
              value={data.counts.failed}
              tone={data.counts.failed ? "danger" : "muted"}
            />
          </div>

          <Card>
            <SectionTitle
              right={
                <button
                  type="button"
                  onClick={() => void query.refetch()}
                  disabled={query.isFetching}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-primary disabled:opacity-60"
                >
                  {query.isFetching ? (
                    <PendingLabel>Refreshing...</PendingLabel>
                  ) : (
                    <>
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh
                    </>
                  )}
                </button>
              }
            >
              Push outbox
            </SectionTitle>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <DiagnosticCount label="Pending" value={data.counts.pending} />
              <DiagnosticCount label="Processing" value={data.counts.processing} />
              <DiagnosticCount label="Skipped" value={data.counts.skipped} />
              <DiagnosticCount
                label="Stuck lease"
                value={data.stuck.length}
                danger={data.stuck.length > 0}
              />
            </dl>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Snapshot {format(new Date(data.generatedAt), "d MMM, HH:mm:ss")}. Counts cover the
              last {data.windowHours} hours.
            </p>
          </Card>

          <EventList
            title="Needs attention"
            events={[...data.stuck, ...data.retrying]}
            empty="No stuck or retrying notification events."
          />
          <EventList
            title="Recent failures"
            events={data.failed}
            empty="No failed notification events in the last 7 days."
          />

          <Card>
            <SectionTitle>Backend errors</SectionTitle>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Runtime errors are kept in sanitized Supabase Edge Function logs and are not copied
              into the application database. Use the event ID and error code above to correlate a
              push failure without exposing recipients or notification content.
            </p>
          </Card>
        </div>
      )}
    </AppShell>
  );
}

function DiagnosticCount({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="rounded-xl bg-elevated px-3 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={`num mt-0.5 text-lg font-semibold ${danger ? "text-danger" : "text-foreground"}`}
      >
        {value}
      </dd>
    </div>
  );
}

type DiagnosticEvent = Awaited<ReturnType<typeof getAdminDiagnostics>>["failed"][number];

function EventList({
  title,
  events,
  empty,
}: {
  title: string;
  events: DiagnosticEvent[];
  empty: string;
}) {
  return (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      {events.length ? (
        <ul className="divide-y divide-border">
          {events.map((event) => (
            <li key={`${event.id}:${event.status}`} className="py-2 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-foreground">
                  {event.kind.replaceAll("_", " ")}
                </span>
                <span className={event.status === "failed" ? "text-danger" : "text-warn"}>
                  {event.status}
                </span>
              </div>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">{event.id}</p>
              <p className="mt-1 text-muted-foreground">
                Attempt {event.attempts} · {event.last_error ?? "no error code"} ·{" "}
                {formatDistanceToNowStrict(new Date(event.created_at), { addSuffix: true })}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{empty}</p>
      )}
    </Card>
  );
}

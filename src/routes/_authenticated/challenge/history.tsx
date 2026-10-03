import { createFileRoute, Link } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, DataError, Note } from "@/components/ui-kit";
import { useAuth } from "@/lib/auth";
import {
  owedText,
  summarizeActivities,
  useActivitySummary,
  useChallengeMembers,
  useMyChallenge,
  useWeeks,
  type Challenge,
  type WeekRow,
} from "@/lib/challenge";
import { countryName } from "@/lib/countries";

export const Route = createFileRoute("/_authenticated/challenge/history")({
  head: () => ({
    meta: [
      { title: "Tempo" },
      {
        name: "description",
        content: "Locked weekly results for both athletes: totals, outcomes and penalties.",
      },
      { property: "og:title", content: "Tempo" },
      { property: "og:description", content: "Immutable finalized weeks and penalties." },
    ],
  }),
  component: History,
});

function History() {
  const challengeQuery = useMyChallenge();
  const { data: challenge, isLoading, error } = challengeQuery;

  return (
    <AppShell>
      <PageHeader title="History" backTo="/challenge" backLabel="This week" />
      {isLoading ? (
        <div className="space-y-3" aria-label="Loading history">
          <div className="h-24 animate-pulse rounded-[20px] bg-card" />
          <div className="h-48 animate-pulse rounded-[20px] bg-card" />
        </div>
      ) : error ? (
        <DataError
          message="Your finalized results are unchanged. Check your connection and try again."
          onRetry={() => void challengeQuery.refetch()}
        />
      ) : !challenge ? (
        <Note>Join or create a challenge before weekly history can appear.</Note>
      ) : (
        <HistoryContent challenge={challenge} />
      )}
    </AppShell>
  );
}

function HistoryContent({ challenge }: { challenge: Challenge }) {
  const { user } = useAuth();
  const membersQuery = useChallengeMembers(challenge.id);
  const weeksQuery = useWeeks(challenge.id);
  const summaryQuery = useActivitySummary(challenge.id);

  const opponent = membersQuery.data?.find((m) => m.userId !== user?.id);
  const name = (id: string) =>
    id === user?.id ? "You" : (membersQuery.data?.find((m) => m.userId === id)?.name ?? "Athlete");

  const weeks = weeksQuery.data ?? [];
  const byWeek = new Map<number, WeekRow[]>();
  weeks.forEach((w) => byWeek.set(w.week_number, [...(byWeek.get(w.week_number) ?? []), w]));
  const numbers = [...byWeek.keys()].sort((a, b) => b - a);

  const tally = (userId: string | undefined) => {
    if (!userId) return { hits: 0, counted: 0, paused: 0 };
    const rows = weeks.filter((w) => w.user_id === userId);
    const paused = rows.filter((w) => w.paused).length;
    const counted = rows.filter((w) => !w.paused);
    return { hits: counted.filter((w) => w.completed).length, counted: counted.length, paused };
  };
  const mine = tally(user?.id);
  const theirs = tally(opponent?.userId);

  if (weeksQuery.isLoading) {
    return <div className="h-48 animate-pulse rounded-[20px] bg-card" />;
  }
  if (weeksQuery.error) {
    return (
      <DataError
        message="Your finalized results are unchanged. Check your connection and try again."
        onRetry={() => void weeksQuery.refetch()}
      />
    );
  }
  if (numbers.length === 0) {
    return (
      <Note>
        No finalized weeks yet. Results and penalties appear here after the first Sunday closes.
      </Note>
    );
  }

  return (
    <div className="space-y-3.5">
      <Card className="grid grid-cols-2 gap-3 p-[18px]">
        <div>
          <p className="text-[13px] text-muted-foreground">You hit target</p>
          <p className="num mt-1 text-[26px] font-semibold">
            {mine.hits} of {mine.counted}
          </p>
          {mine.paused ? (
            <p className="text-xs text-muted-foreground">
              {mine.paused} week{mine.paused === 1 ? "" : "s"} paused
            </p>
          ) : null}
        </div>
        <div>
          <p className="text-[13px] text-muted-foreground">
            {opponent ? `${opponent.name} hit target` : "Opponent hit target"}
          </p>
          <p className="num mt-1 text-[26px] font-semibold">
            {theirs.hits} of {theirs.counted}
          </p>
          {theirs.paused ? (
            <p className="text-xs text-muted-foreground">
              {theirs.paused} week{theirs.paused === 1 ? "" : "s"} paused
            </p>
          ) : null}
        </div>
      </Card>

      <div className="rounded-[20px] bg-card px-4">
        {numbers.map((n) => {
          const rows = byWeek.get(n) ?? [];
          const myRow = rows.find((w) => w.user_id === user?.id);
          const oppRow = rows.find((w) => w.user_id === opponent?.userId);
          const ref = rows[0];
          return (
            <Link
              key={n}
              to="/challenge/history/week/$weekNumber"
              params={{ weekNumber: String(n) }}
              preload="intent"
              resetScroll={false}
              className="flex flex-col gap-2 border-t border-border py-3.5 first:border-t-0 active:opacity-80"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">Week {n}</span>
                {ref ? (
                  <span className="text-[13px] text-muted-foreground">
                    {format(parseISO(ref.week_start), "d MMM")} –{" "}
                    {format(parseISO(ref.week_end), "d MMM")}
                  </span>
                ) : null}
              </div>
              <div className="num flex justify-between text-sm">
                <span>
                  You <WeekValue row={myRow} />
                </span>
                <span>
                  {opponent?.name ?? "Opponent"} <WeekValue row={oppRow} />
                </span>
              </div>
              {(() => {
                const outcome = outcomeLine(myRow, oppRow, name, challenge.legacy_photo_owed);
                return outcome ? (
                  <span
                    className={`self-start rounded-lg bg-elevated px-2 py-[3px] text-xs font-semibold ${outcome.tone}`}
                  >
                    {outcome.text}
                  </span>
                ) : null;
              })()}
            </Link>
          );
        })}
      </div>

      <AllTimeTotals
        oppLabel={opponent?.name ?? "Opponent"}
        meUserId={user?.id}
        oppUserId={opponent?.userId}
        summaryLoading={summaryQuery.isLoading}
        summaries={summaryQuery.data}
      />
    </div>
  );
}

function WeekValue({ row }: { row: WeekRow | undefined }) {
  if (!row) return <span className="text-muted-foreground">—</span>;
  if (row.paused) {
    return (
      <span className="text-muted-foreground">
        paused{row.pause_country ? `, ${countryName(row.pause_country)}` : ""}
      </span>
    );
  }
  return (
    <span className={row.completed ? "text-primary" : "text-warn"}>
      {Number(row.equivalent_km).toFixed(1)} km
    </span>
  );
}

function outcomeLine(
  myRow: WeekRow | undefined,
  oppRow: WeekRow | undefined,
  name: (id: string) => string,
  legacyPhotoOwed: boolean,
): { text: string; tone: string } | null {
  if (!myRow || !oppRow) return null;
  const myDone = myRow.completed || myRow.paused;
  const oppDone = oppRow.completed || oppRow.paused;
  if (myDone && oppDone) return { text: "Both hit it", tone: "text-primary" };

  const describe = (row: WeekRow) =>
    row.penalty_mode === "custom"
      ? (row.penalty_consequence ?? "custom consequence")
      : owedText(Number(row.penalty_eur), legacyPhotoOwed);

  if (!myRow.completed && !myRow.paused && oppDone) {
    return { text: `You owe ${name(oppRow.user_id)} ${describe(myRow)}`, tone: "text-warn" };
  }
  if (!oppRow.completed && !oppRow.paused && myDone) {
    return { text: `${name(oppRow.user_id)} owes you ${describe(oppRow)}`, tone: "text-primary" };
  }
  return { text: "Both fell short", tone: "text-warn" };
}

function AllTimeTotals({
  oppLabel,
  meUserId,
  oppUserId,
  summaryLoading,
  summaries,
}: {
  oppLabel: string;
  meUserId: string | undefined;
  oppUserId: string | undefined;
  summaryLoading: boolean;
  summaries: ReturnType<typeof useActivitySummary>["data"];
}) {
  if (summaryLoading) return <div className="h-28 animate-pulse rounded-[20px] bg-card" />;
  const statsFor = (id: string | undefined) => {
    const found = id ? summaries?.find((row) => row.userId === id)?.stats : undefined;
    return found ?? summarizeActivities([], id ?? "");
  };
  const mine = statsFor(meUserId);
  const theirs = statsFor(oppUserId);

  return (
    <div>
      <p className="mx-1 mb-1.5 text-[13px] font-medium text-muted-foreground">All-time totals</p>
      <Card className="grid grid-cols-2 gap-3 p-[18px]">
        <TotalsColumn label="You" stats={mine} />
        <TotalsColumn label={oppLabel} stats={theirs} />
      </Card>
    </div>
  );
}

function TotalsColumn({
  label,
  stats,
}: {
  label: string;
  stats: ReturnType<typeof summarizeActivities>;
}) {
  return (
    <div>
      <p className="truncate text-[13px] text-muted-foreground">{label}</p>
      <p className="num mt-1 text-xl font-semibold">{stats.totalKm.toFixed(1)} km</p>
      <p className="text-xs text-muted-foreground">{stats.challengeKm.toFixed(1)} counted km</p>
    </div>
  );
}

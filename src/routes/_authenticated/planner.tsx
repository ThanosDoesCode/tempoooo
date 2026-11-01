import { createFileRoute, Link, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { addDays, format, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { HistoryBackLink } from "@/components/HistoryBackLink";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DataError } from "@/components/ui-kit";
import {
  ActivityTile,
  PlannerCard,
  PlannerRowText,
  plannerRowClass,
} from "@/components/PlannerParts";
import { PlannedItemSheet } from "@/components/PlannedItemSheet";
import { usePlannedWorkoutStart, type PlannedWorkoutStart } from "@/lib/planner-start";
import {
  bulkOwnerQueryOptions,
  bulkPlanModeFor,
  preferredBulkMembership,
  useMemberships,
} from "@/lib/bulk-access";
import { backWithinApp } from "@/lib/in-app-back";
import { useLocalDay } from "@/lib/use-local-day";
import {
  ACTIVITY_TONE,
  calendarGrid,
  canStartPlanned,
  gridRange,
  groupPlannerWeeks,
  isPlannerDate,
  monthOf,
  monthTitle,
  plannedCounts,
  plannedDetail,
  plannedStatus,
  plannedTitle,
  selectedDayHeading,
  shiftMonth,
  weekStart,
  type PlannedActivity,
} from "@/lib/planner";
import { usePlannedItem, usePlannerRange } from "@/lib/planner-query";

type PlannerSearch = {
  view?: "calendar" | undefined;
  month?: string | undefined;
  date?: string | undefined;
  item?: string | undefined;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/_authenticated/planner")({
  validateSearch: (search: Record<string, unknown>): PlannerSearch => ({
    view: search["view"] === "calendar" ? "calendar" : undefined,
    month:
      typeof search["month"] === "string" && isPlannerDate(`${search["month"]}-01`)
        ? search["month"]
        : undefined,
    date: isPlannerDate(search["date"]) ? search["date"] : undefined,
    item:
      typeof search["item"] === "string" && UUID.test(search["item"]) ? search["item"] : undefined,
  }),
  // Full-fitness only, through the existing fitness gate: core accounts get the opt-in access
  // screen (never auto-onboarding) and no Planner data is ever mounted for them.
  beforeLoad: async ({ context }) => {
    const memberships = await context.queryClient.ensureQueryData(bulkOwnerQueryOptions());
    const preferred = preferredBulkMembership(memberships);
    if (!preferred) throw redirect({ to: "/bulk-access-denied", replace: true });
    if (bulkPlanModeFor(memberships, preferred.bulk_profile_id) !== "public")
      throw redirect({ to: "/bulk", replace: true });
  },
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: PlannerPage,
});

const AGENDA_WEEKS = 26;
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

function PlannerPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/planner" });
  const router = useRouter();
  const today = useLocalDay();
  const memberships = useMemberships();
  const profileId = preferredBulkMembership(memberships.data)?.bulk_profile_id ?? null;
  const calendar = search.view === "calendar";
  const month = search.month ?? monthOf(search.date ?? today);
  const selected = search.date ?? (monthOf(today) === month ? today : `${month}-01`);
  const agendaFrom = weekStart(today);
  const agendaTo = format(addDays(parseISO(agendaFrom), AGENDA_WEEKS * 7 - 1), "yyyy-MM-dd");
  const grid = gridRange(month);
  const range = usePlannerRange(
    profileId,
    calendar ? grid.from : agendaFrom,
    calendar ? grid.to : agendaTo,
  );
  const detail = usePlannedItem(profileId, search.item ?? null);
  const workoutStart = usePlannedWorkoutStart(profileId);

  const setSearch = (next: Partial<PlannerSearch>, push = false) =>
    void navigate({ search: (previous) => ({ ...previous, ...next }), replace: !push });
  const openItem = (item: PlannedActivity) => setSearch({ item: item.id }, true);
  const closeItem = () => {
    // Return to the exact Agenda/Calendar entry that opened the sheet; deep links fall back here.
    if (!backWithinApp(router.history, "/planner")) setSearch({ item: undefined });
  };
  const newSearch = calendar && selected >= today ? { date: selected } : {};

  return (
    <AppShell>
      <header className="mb-4">
        <div className="flex items-center justify-between gap-3">
          <HistoryBackLink fallback="/bulk" fallbackLabel="Today" />
          <Link
            to="/planner/new"
            search={newSearch}
            aria-label="Plan activity"
            className="mb-2 grid h-11 w-11 place-items-center rounded-full bg-elevated text-foreground active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
          </Link>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Planner</h1>
      </header>

      <div
        role="tablist"
        aria-label="Planner view"
        className="mb-4 grid grid-cols-2 gap-1 rounded-[14px] bg-card p-1"
      >
        {(["agenda", "calendar"] as const).map((view) => {
          const active = (view === "calendar") === calendar;
          return (
            <button
              key={view}
              type="button"
              role="tab"
              id={`planner-tab-${view}`}
              aria-selected={active}
              aria-controls={`planner-panel-${view}`}
              onClick={() => setSearch({ view: view === "calendar" ? "calendar" : undefined })}
              className={`min-h-11 rounded-[11px] text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                active ? "bg-elevated font-semibold" : "font-medium text-muted-foreground"
              }`}
            >
              {view === "agenda" ? "Agenda" : "Calendar"}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`planner-panel-${calendar ? "calendar" : "agenda"}`}
        aria-labelledby={`planner-tab-${calendar ? "calendar" : "agenda"}`}
        className="space-y-4"
      >
        {calendar ? (
          <CalendarView
            month={month}
            selected={selected}
            today={today}
            items={range.data ?? []}
            onMonth={(next) => setSearch({ month: next, date: undefined })}
            onSelect={(date) => setSearch({ date, month: monthOf(date) })}
          />
        ) : null}
        {range.isLoading ? (
          <PageSkeleton label="Loading your planner" />
        ) : range.error ? (
          <DataError
            message="Could not load your planner. Nothing was changed."
            onRetry={() => void range.refetch()}
          />
        ) : calendar ? (
          <DayList
            date={selected}
            today={today}
            items={(range.data ?? []).filter((item) => item.date === selected)}
            onOpen={openItem}
            start={workoutStart}
          />
        ) : (
          <Agenda items={range.data ?? []} today={today} onOpen={openItem} start={workoutStart} />
        )}
        {workoutStart.error ? (
          <p role="alert" className="text-[13px] text-danger">
            {workoutStart.error}
          </p>
        ) : null}
        <p className="px-1 text-[13px] text-muted-foreground">
          Planned items don't count toward your streak or challenge until you log them.
        </p>
      </div>

      <PlannedItemSheet
        open={!!search.item}
        item={detail.data}
        loading={detail.isLoading}
        profileId={profileId}
        today={today}
        onClose={closeItem}
      />
    </AppShell>
  );
}

type StartControl = PlannedWorkoutStart;

function PlannerRow({
  item,
  today,
  onOpen,
  start,
  dateColumn,
}: {
  item: PlannedActivity;
  today: string;
  onOpen: (item: PlannedActivity) => void;
  start: StartControl;
  dateColumn?: boolean;
}) {
  const done = plannedStatus(item) === "completed";
  const past = item.date < today;
  const startable = canStartPlanned(item, today);
  return (
    <div className="flex min-w-0 items-center gap-2 border-t border-border first:border-t-0">
      <button
        type="button"
        onClick={() => onOpen(item)}
        className={`${plannerRowClass} border-t-0`}
        aria-label={`${plannedTitle(item)}, ${format(parseISO(item.date), "EEEE d MMMM")}, ${plannedDetail(item)}`}
      >
        {dateColumn ? (
          <span
            className={`w-10 flex-none text-center ${past ? "text-muted-foreground/70" : item.date === today ? "text-foreground" : "text-muted-foreground"}`}
          >
            <span className="block text-[12px] leading-tight">
              {item.date === today ? "Today" : format(parseISO(item.date), "EEE")}
            </span>
            <span className="num block text-[20px] font-semibold leading-tight">
              {format(parseISO(item.date), "d")}
            </span>
          </span>
        ) : null}
        <ActivityTile item={item} />
        <PlannerRowText
          title={plannedTitle(item)}
          detail={plannedDetail(item)}
          muted={done || past}
        />
        {startable ? null : (
          <ChevronRight
            className="control-chevron flex-none text-muted-foreground"
            aria-hidden="true"
          />
        )}
      </button>
      {startable ? (
        <button
          type="button"
          disabled={start.pendingId !== null}
          aria-busy={start.pendingId === item.id}
          onClick={() => void start.start(item)}
          className="inline-flex min-h-11 flex-none items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          <span className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-[14px] font-semibold text-primary-foreground">
            {start.pendingId === item.id
              ? "Starting…"
              : item.sessionStatus === "in_progress" || start.activeSession
                ? "Resume"
                : "Start"}
          </span>
        </button>
      ) : null}
    </div>
  );
}

function Agenda({
  items,
  today,
  onOpen,
  start,
}: {
  items: PlannedActivity[];
  today: string;
  onOpen: (item: PlannedActivity) => void;
  start: StartControl;
}) {
  if (items.length === 0)
    return (
      <div className="card-surface space-y-2 rounded-[20px] p-5">
        <h2 className="text-[17px] font-semibold">No activities planned</h2>
        <p className="text-[14px] text-muted-foreground">
          Plan a workout, run or ride so you know what's coming next.
        </p>
        <Link
          to="/planner/new"
          className="mt-2 grid h-12 place-items-center rounded-[14px] bg-primary font-semibold text-primary-foreground active:opacity-90"
        >
          Plan activity
        </Link>
      </div>
    );
  return (
    <>
      {groupPlannerWeeks(items, today).map((week) => (
        <section key={week.start} aria-label={week.label} className="space-y-2">
          <div className="flex items-baseline justify-between gap-3 px-1 text-[13px]">
            <h2 className="font-medium text-muted-foreground">{week.label}</h2>
            <span className="num truncate text-muted-foreground">{week.aside}</span>
          </div>
          <PlannerCard>
            {week.items.map((item) => (
              <PlannerRow
                key={item.id}
                item={item}
                today={today}
                onOpen={onOpen}
                start={start}
                dateColumn
              />
            ))}
          </PlannerCard>
        </section>
      ))}
    </>
  );
}

function CalendarView({
  month,
  selected,
  today,
  items,
  onMonth,
  onSelect,
}: {
  month: string;
  selected: string;
  today: string;
  items: PlannedActivity[];
  onMonth: (month: string) => void;
  onSelect: (date: string) => void;
}) {
  const byDate = new Map<string, PlannedActivity[]>();
  for (const item of items) byDate.set(item.date, [...(byDate.get(item.date) ?? []), item]);
  const navButton =
    "grid h-11 w-11 place-items-center rounded-full bg-elevated active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="card-surface rounded-[20px] px-3 pb-4 pt-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label={`Previous month, ${monthTitle(shiftMonth(month, -1))}`}
          onClick={() => onMonth(shiftMonth(month, -1))}
          className={navButton}
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <h2 className="text-[17px] font-semibold" aria-live="polite">
          {monthTitle(month)}
        </h2>
        <button
          type="button"
          aria-label={`Next month, ${monthTitle(shiftMonth(month, 1))}`}
          onClick={() => onMonth(shiftMonth(month, 1))}
          className={navButton}
        >
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div
        className="grid grid-cols-7 text-center text-[12px] text-muted-foreground"
        aria-hidden="true"
      >
        {WEEKDAYS.map((day, index) => (
          <span key={index} className="py-1.5">
            {day}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {calendarGrid(month)
          .flat()
          .map((day) => {
            const dayItems = byDate.get(day.date) ?? [];
            const isToday = day.date === today;
            const isSelected = day.date === selected;
            const types = [...new Set(dayItems.map((item) => item.type))];
            return (
              <button
                key={day.date}
                type="button"
                aria-pressed={isSelected}
                aria-label={`${format(parseISO(day.date), "EEEE d MMMM")}${isToday ? ", today" : ""}, ${
                  dayItems.length ? plannedCounts(dayItems) : "nothing planned"
                }`}
                onClick={() => onSelect(day.date)}
                className={`flex min-h-[52px] min-w-0 flex-col items-center justify-start gap-1 rounded-[12px] pt-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isSelected ? "bg-elevated" : ""
                } ${day.inMonth ? "" : "text-muted-foreground/50"}`}
              >
                <span
                  className={`num grid h-7 w-7 place-items-center rounded-full text-[15px] ${
                    isToday ? "bg-primary font-semibold text-primary-foreground" : "font-medium"
                  }`}
                >
                  {format(parseISO(day.date), "d")}
                </span>
                <span className="flex h-1.5 gap-1" aria-hidden="true">
                  {types.map((type) => (
                    <span
                      key={type}
                      className={`h-1.5 w-1.5 rounded-full ${ACTIVITY_TONE[type].dot}`}
                    />
                  ))}
                </span>
              </button>
            );
          })}
      </div>
      <div className="mt-3 flex justify-center gap-4 text-[12px] text-muted-foreground">
        {(["workout", "run", "ride"] as const).map((type) => (
          <span key={type} className="inline-flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${ACTIVITY_TONE[type].dot}`}
              aria-hidden="true"
            />
            {type === "workout" ? "Workout" : type === "run" ? "Run" : "Ride"}
          </span>
        ))}
      </div>
    </div>
  );
}

function DayList({
  date,
  today,
  items,
  onOpen,
  start,
}: {
  date: string;
  today: string;
  items: PlannedActivity[];
  onOpen: (item: PlannedActivity) => void;
  start: StartControl;
}) {
  return (
    <section aria-label={selectedDayHeading(date, today)} className="space-y-2">
      <h2 className="px-1 text-[13px] font-medium text-muted-foreground">
        {selectedDayHeading(date, today)}
      </h2>
      {items.length ? (
        <PlannerCard>
          {items.map((item) => (
            <PlannerRow key={item.id} item={item} today={today} onOpen={onOpen} start={start} />
          ))}
        </PlannerCard>
      ) : (
        <div className="card-surface flex min-h-[64px] items-center justify-between gap-3 rounded-[20px] px-4">
          <span className="text-[14px] text-muted-foreground">Nothing planned.</span>
          {date >= today ? (
            <Link
              to="/planner/new"
              search={{ date }}
              className="inline-flex min-h-11 items-center rounded-xl px-2 text-[14px] font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Plan for this day
            </Link>
          ) : null}
        </div>
      )}
    </section>
  );
}

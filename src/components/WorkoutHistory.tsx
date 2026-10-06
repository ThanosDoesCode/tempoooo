import { Link } from "@tanstack/react-router";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { MoreHorizontal } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "./ui/button";
import { Card, PendingLabel } from "./ui-kit";
import { DecimalInput } from "./DecimalInput";
import { TempoDatePicker, TempoDateTimePicker } from "./TempoDateTimePicker";
import { NativeSelect } from "./ui/native-select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";
import {
  sessionSetLabel,
  type BulkTrainingSession,
  type BulkTrainingSessionExercise,
  type BulkTrainingSet,
  type EditableSessionSet,
} from "@/lib/bulk-training-session-domain";
import {
  groupWorkoutWeeks,
  historyDuration,
  workoutDetailDuration,
  localTimestampInput,
  validateWorkoutTimes,
  legacyRecordSetKey,
  type HistoryWorkout,
} from "@/lib/workout-history";
import { entryLoadLabel, notesPreview } from "@/lib/training";

const tones = {
  normal: "bg-elevated text-foreground",
  warmup: "bg-warn/15 text-warn",
  failure: "bg-danger/15 text-danger",
  drop: "bg-chart-2/15 text-chart-2",
};
const number = (value: number) => Math.round(value).toLocaleString("en-GB");
const recordLabel = (n: number) => `${n} record${n === 1 ? "" : "s"}`;

export function WorkoutHistoryList({
  rows,
  today,
  expected,
  planName,
  planId,
  planStartedAt,
  active,
  pending,
  onDiscard,
  onFixTime,
}: {
  rows: HistoryWorkout[];
  today: string;
  expected: number | null;
  planName?: string | undefined;
  planId?: string | undefined;
  planStartedAt?: string | undefined;
  active: BulkTrainingSession | null;
  pending: boolean;
  onDiscard: () => void;
  onFixTime: (row: HistoryWorkout) => void;
}) {
  const summaryRows =
    planId && planStartedAt
      ? rows.filter(
          (row) => row.session?.trainingPlanId === planId && row.date >= planStartedAt.slice(0, 10),
        )
      : rows;
  const seconds = summaryRows.reduce((sum, row) => sum + (row.seconds ?? 0), 0);
  const records = summaryRows.reduce((sum, row) => sum + row.records, 0);
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid grid-cols-3 gap-2">
          <SummaryMetric value={String(summaryRows.length)} label="workouts" />
          <SummaryMetric
            value={summaryRows.some((r) => r.seconds != null) ? historyDuration(seconds) : "—"}
            label={summaryRows.some((r) => r.seconds == null) ? "recorded time" : "total time"}
          />
          <SummaryMetric value={String(records)} label="records" />
        </div>
        {planName ? (
          <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
            {planStartedAt
              ? `Since you started ${planName} on ${format(new Date(planStartedAt), "d MMM")}`
              : `Current plan: ${planName}`}
          </p>
        ) : null}
      </Card>
      {active ? (
        <Card className="p-4">
          <h2 className="font-semibold">Unfinished workout</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {active.workoutDayName} · started {format(new Date(active.startedAt), "d MMM HH:mm")}
            {active.exercises.some((e) => e.sets.some((s) => s.isComplete))
              ? " · partially logged"
              : " · nothing logged yet"}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Button asChild className="min-h-12 rounded-xl">
              <Link to="/bulk/workout/$sessionId" params={{ sessionId: active.id }}>
                Resume
              </Link>
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              className="min-h-12 rounded-xl text-danger"
              onClick={onDiscard}
            >
              Discard
            </Button>
          </div>
        </Card>
      ) : null}
      {groupWorkoutWeeks(rows, today).map((group) => (
        <section key={group.start}>
          <div className="mb-2 flex items-center justify-between gap-2 px-1 text-xs font-medium text-muted-foreground">
            <h2>{group.label}</h2>
            <span className="shrink-0">
              {planId &&
              expected &&
              group.workouts.every((row) => row.session?.trainingPlanId === planId)
                ? `${group.workouts.length} of ${expected} done`
                : `${group.workouts.length} done`}
            </span>
          </div>
          <div className="rounded-[20px] bg-card px-4">
            {group.workouts.map((row) => (
              <div key={row.key} className="border-t border-border first:border-0">
                <Link
                  to="/bulk/training/history"
                  search={row.session ? { session: row.session.id } : { legacy: row.date }}
                  preload="intent"
                  className="flex min-h-[78px] items-center justify-between gap-3 py-3 active:opacity-80"
                >
                  <div className="min-w-0">
                    <h3 className="font-semibold">{row.name}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {format(parseISO(row.date), "EEE d MMM")} · {historyDuration(row.seconds)} ·{" "}
                      {row.workingSets} sets
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="num font-semibold">
                      {row.volume == null ? "—" : `${number(row.volume)} kg`}
                    </p>
                    {row.records ? (
                      <p className="mt-1 text-xs font-semibold text-primary">
                        {recordLabel(row.records)}
                      </p>
                    ) : null}
                  </div>
                </Link>
                {row.seconds != null && row.seconds > 4 * 3600 ? (
                  <p className="-mt-1 pb-2 text-xs text-muted-foreground">
                    Timer was left running.{" "}
                    <button className="min-h-11 px-1 text-primary" onClick={() => onFixTime(row)}>
                      Fix time
                    </button>
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ))}
      {!rows.length && !active ? (
        <Card>
          <p className="font-semibold">No completed workouts yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Finish a workout to start your history.
          </p>
        </Card>
      ) : null}
    </div>
  );
}

export function WorkoutDetail({
  row,
  previous,
  pending,
  error,
  onRepeat,
  onDelete,
  onSaveSet,
  onSaveTime,
  legacyEditor,
}: {
  row: HistoryWorkout;
  previous: HistoryWorkout | null;
  pending: boolean;
  error: string | null;
  legacyEditor?: ReactNode;
  onRepeat: () => void;
  onDelete: () => void;
  onSaveSet: (set: EditableSessionSet) => Promise<boolean>;
  onSaveTime: (date: string, start: string, end: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const session = row.session;
  const delta =
    row.volume != null && previous?.volume != null ? row.volume - previous.volume : null;
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {row.planName}
            {session ? ` · Day ${session.workoutDayOrder}` : ""}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{row.name}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {format(parseISO(row.date), "EEEE d MMM")}
            {` · ${workoutDetailDuration(row)}`}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Workout actions"
              className="grid min-h-11 min-w-11 place-items-center rounded-full bg-card"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="min-h-11" onSelect={() => setEditing(true)}>
              Edit sets
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-11" onSelect={() => setTimeOpen(true)}>
              Change date or time
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-11 text-danger" onSelect={() => setDeleteOpen(true)}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Card className="p-4">
        <div className="grid grid-cols-3 gap-2">
          <SummaryMetric value={historyDuration(row.seconds)} label="time" />
          <SummaryMetric
            value={String(row.workingSets)}
            label={`sets${row.warmups ? ` + ${row.warmups} warm-up` : ""}`}
          />
          <SummaryMetric value={row.volume == null ? "—" : number(row.volume)} label="kg volume" />
        </div>
        <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
          <span className="font-semibold text-primary">{recordLabel(row.records)}</span>
          {delta != null
            ? ` · ${delta >= 0 ? "+" : ""}${number(delta)} kg volume on last ${row.name}`
            : " · No previous comparable workout"}
        </p>
        {(session?.bodyweightKg ?? row.legacy?.sessionBodyweight) != null ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Bodyweight that day{" "}
            {(session?.bodyweightKg ?? row.legacy?.sessionBodyweight)!.toFixed(1)} kg
          </p>
        ) : null}
      </Card>
      {editing && !session ? legacyEditor : null}
      {session
        ? session.exercises.map((exercise) => (
            <Card key={exercise.id} className="p-4">
              <h2 className="text-sm font-semibold">{exercise.name}</h2>
              <ol className="mt-2 space-y-1">
                {exercise.sets
                  .filter((set) => set.isComplete)
                  .map((set, index) => (
                    <li key={set.id}>
                      {editing ? (
                        <HistoricalSetEditor
                          key={`${set.id}:${session.updatedAt}`}
                          set={set}
                          exercise={exercise}
                          pending={pending}
                          onSave={onSaveSet}
                        />
                      ) : (
                        <div className="flex min-h-9 items-center gap-3 text-sm">
                          <SetTypeBadge
                            set={set}
                            number={
                              exercise.sets
                                .slice(0, exercise.sets.indexOf(set) + 1)
                                .filter((s) => s.setType === "normal").length || index + 1
                            }
                          />
                          <span className="min-w-0 flex-1 font-medium tabular-nums">
                            {sessionSetLabel(set, exercise)}
                          </span>
                          {set.rpe != null ? (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              RPE {set.rpe}
                            </span>
                          ) : null}
                          {row.recordSets.includes(set.id) ? (
                            <span className="text-xs font-semibold text-primary">Record</span>
                          ) : null}
                        </div>
                      )}
                    </li>
                  ))}
              </ol>
              {exercise.notes ? (
                <p className="mt-2 text-xs text-muted-foreground">{exercise.notes}</p>
              ) : null}
            </Card>
          ))
        : row.legacy?.entries.map((entry) => (
            <Card key={entry.exercise} className="p-4">
              <h2 className="text-sm font-semibold">{entry.exercise}</h2>
              <ol className="mt-2 space-y-1">
                {entry.reps.flatMap((reps, index) =>
                  reps != null && reps > 0
                    ? [
                        <li key={index} className="flex min-h-9 items-center gap-3 text-sm">
                          <span className="grid h-6 w-6 place-items-center rounded-lg bg-elevated text-xs">
                            {index + 1}
                          </span>
                          <span className="flex-1">
                            {entryLoadLabel(entry)} × {reps}
                          </span>
                          {row.recordSets.includes(
                            legacyRecordSetKey(row.date, entry.exercise, index),
                          ) ? (
                            <span className="text-xs font-semibold text-primary">Record</span>
                          ) : null}
                        </li>,
                      ]
                    : [],
                )}
              </ol>
              {notesPreview(entry) ? (
                <p className="mt-2 text-xs text-muted-foreground">{notesPreview(entry)}</p>
              ) : null}
            </Card>
          ))}
      {row.legacy?.sessionNote ? (
        <Card className="text-sm text-muted-foreground">{row.legacy.sessionNote}</Card>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {editing ? (
        <Button
          variant="secondary"
          disabled={pending}
          className="min-h-11 w-full"
          onClick={() => setEditing(false)}
        >
          Done editing
        </Button>
      ) : null}
      <Button disabled={pending} className="min-h-12 w-full rounded-xl" onClick={onRepeat}>
        {pending ? <PendingLabel>Working</PendingLabel> : "Repeat this workout"}
      </Button>
      {timeOpen ? (
        <WorkoutTimeDialog
          row={row}
          open
          onOpenChange={setTimeOpen}
          pending={pending}
          error={error}
          onSave={onSaveTime}
        />
      ) : null}
      <ConfirmWorkoutRemoval
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        pending={pending}
        onConfirm={onDelete}
      />
    </div>
  );
}

export function SetTypeBadge({ set, number: position }: { set: BulkTrainingSet; number: number }) {
  return (
    <span
      aria-label={`${set.setType} set`}
      className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg text-xs font-semibold ${tones[set.setType]}`}
    >
      {set.setType === "warmup"
        ? "W"
        : set.setType === "failure"
          ? "F"
          : set.setType === "drop"
            ? "D"
            : position}
    </span>
  );
}

function SummaryMetric({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0">
      <p className="num text-lg font-semibold leading-tight min-[360px]:text-xl">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export function HistoricalSetEditor({
  set,
  exercise,
  pending,
  onSave,
}: {
  set: BulkTrainingSet;
  exercise: BulkTrainingSessionExercise;
  pending: boolean;
  onSave: (set: EditableSessionSet) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<EditableSessionSet>({ ...set });
  const patch = (field: keyof EditableSessionSet, value: number | undefined) =>
    setDraft((old) => ({ ...old, [field]: value ?? null }));
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(draft);
      }}
      className="my-2 space-y-2 rounded-xl bg-elevated p-3"
    >
      <div className="grid grid-cols-2 gap-2">
        {(exercise.executionMode === "unilateral"
          ? (["left", "right"] as const)
          : (["bilateral"] as const)
        ).map((side) => (
          <div key={side} className="min-w-0 space-y-1">
            <p className="text-xs text-muted-foreground">
              {side === "bilateral" ? "Load / reps" : `${side} load / reps`}
            </p>
            <div className="flex gap-1">
              <DecimalInput
                label={`${side} load`}
                min={0}
                max={1000}
                value={draft[`${side}Weight`] ?? undefined}
                onChange={(value) => patch(`${side}Weight`, value)}
                disabled={pending}
                className="num h-11 w-full min-w-0 rounded-lg bg-card px-2"
              />
              <DecimalInput
                label={`${side} reps`}
                min={1}
                max={1000}
                integer
                value={draft[`${side}Reps`] ?? undefined}
                onChange={(value) => patch(`${side}Reps`, value)}
                disabled={pending}
                className="num h-11 w-full min-w-0 rounded-lg bg-card px-2"
              />
            </div>
          </div>
        ))}
        <label className="text-xs text-muted-foreground">
          Set type
          <NativeSelect
            value={draft.setType}
            disabled={pending}
            onChange={(event) =>
              setDraft((old) => ({
                ...old,
                setType: event.target.value as BulkTrainingSet["setType"],
              }))
            }
          >
            {["normal", "warmup", "failure", "drop"].map((type) => (
              <option key={type} value={type}>
                {type === "drop" ? "Dropset" : type[0]!.toUpperCase() + type.slice(1)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="text-xs text-muted-foreground">
          RPE
          <NativeSelect
            value={draft.rpe ?? ""}
            disabled={pending}
            onChange={(event) =>
              setDraft((old) => ({
                ...old,
                rpe: event.target.value ? Number(event.target.value) : null,
              }))
            }
          >
            <option value="">Not recorded</option>
            {Array.from({ length: 9 }, (_, i) => 6 + i / 2).map((rpe) => (
              <option key={rpe} value={rpe}>
                {rpe}
              </option>
            ))}
          </NativeSelect>
        </label>
      </div>
      <Button disabled={pending} type="submit" size="sm" className="min-h-11">
        Save set {set.order}
      </Button>
    </form>
  );
}

export function WorkoutTimeDialog({
  row,
  open,
  onOpenChange,
  pending,
  error,
  onSave,
}: {
  row: HistoryWorkout;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  error: string | null;
  onSave: (date: string, start: string, end: string) => Promise<boolean>;
}) {
  const [date, setDate] = useState(row.date);
  const [start, setStart] = useState(
    row.session
      ? localTimestampInput(row.session.startedAt)
      : row.legacy?.startedAt
        ? localTimestampInput(row.legacy.startedAt)
        : "",
  );
  const [end, setEnd] = useState(
    row.session
      ? localTimestampInput(row.session.completedAt!)
      : row.legacy?.completedAt
        ? localTimestampInput(row.legacy.completedAt)
        : "",
  );
  const [validation, setValidation] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] rounded-2xl p-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change date or time</DialogTitle>
          <DialogDescription>
            Correct the timer without changing your logged sets.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const issue = validateWorkoutTimes(date, start, end);
            setValidation(issue);
            if (!issue)
              void onSave(date, start, end).then((ok) => {
                if (ok) onOpenChange(false);
              });
          }}
        >
          <label className="block text-sm">
            Date
            <TempoDatePicker
              label="Workout date"
              value={date}
              disabled={pending}
              onChange={(value) => {
                const shift = value
                  ? differenceInCalendarDays(parseISO(value), parseISO(date || row.date))
                  : 0;
                setDate(value);
                if (start && value)
                  setStart(localTimestampInput(addDays(new Date(start), shift).toISOString()));
                if (end && value)
                  setEnd(localTimestampInput(addDays(new Date(end), shift).toISOString()));
              }}
              className="mt-1"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <TempoDateTimePicker
              label="Start time"
              dateFallback={date}
              value={start}
              onChange={setStart}
              disabled={pending}
              aria-describedby={validation || error ? "workout-time-error" : undefined}
              aria-invalid={!!validation}
            />
            <TempoDateTimePicker
              label="End time"
              dateFallback={date}
              value={end}
              onChange={setEnd}
              disabled={pending}
              aria-describedby={validation || error ? "workout-time-error" : undefined}
              aria-invalid={!!validation}
            />
          </div>
          {validation || error ? (
            <p id="workout-time-error" role="alert" className="text-sm text-danger">
              {validation ?? error}
            </p>
          ) : null}
          <Button disabled={pending} className="min-h-11 w-full">
            {pending ? "Saving…" : "Save time"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmWorkoutRemoval({
  open,
  onOpenChange,
  pending,
  onConfirm,
  discard = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onConfirm: () => void;
  discard?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[calc(100%-2rem)] rounded-2xl p-5 sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {discard ? "Discard unfinished workout?" : "Delete workout?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            This workout and its logged sets will be permanently removed. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} className="min-h-11">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            className="min-h-11 bg-danger text-white"
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {pending ? "Removing…" : discard ? "Discard workout" : "Delete workout"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

import { useId, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { TempoDatePicker, TempoTimePicker } from "@/components/TempoDateTimePicker";
import { planningDisclaimer } from "@/components/PlannerParts";
import { useAuth } from "@/lib/auth";
import { backWithinApp } from "@/lib/in-app-back";
import { canonicalDuration, formatClock } from "@/lib/duration";
import { userFacingError } from "@/lib/network-errors";
import {
  ACTIVITY_LABEL,
  parsePlannedDistance,
  parsePlannedMinutes,
  parsePlannedNote,
  type PlannedActivity,
  type PlannedActivityType,
  type WorkoutSource,
} from "@/lib/planner";
import {
  createPlannedActivity,
  invalidatePlanner,
  updatePlannedActivity,
  type PlannedInput,
} from "@/lib/planner-query";
import { useActiveTrainingPlan } from "@/lib/training-plans-query";
import { useMyWorkouts } from "@/lib/workout-templates-query";

type Details = { distance: string; minutes: string; note: string };
const emptyDetails: Details = { distance: "", minutes: "", note: "" };

const rowClass =
  "flex min-h-[56px] items-center justify-between gap-3 border-t border-border first:border-t-0";
const inputClass =
  "num min-w-0 flex-1 bg-transparent text-right text-[16px] font-semibold text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground/70 aria-[invalid=true]:text-danger";

/** Shared Plan activity form. The type is fixed when editing; date/time carry across type changes. */
export function PlanActivityForm({
  profileId,
  today,
  initialType,
  initialDate,
  editing,
}: {
  profileId: string;
  today: string;
  initialType?: PlannedActivityType | undefined;
  initialDate?: string | undefined;
  editing?: PlannedActivity | undefined;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const id = useId();
  const requestId = useRef(crypto.randomUUID());
  const submitting = useRef(false);
  const [type, setType] = useState<PlannedActivityType>(editing?.type ?? initialType ?? "workout");
  const [date, setDate] = useState(editing?.date ?? initialDate ?? today);
  const [time, setTime] = useState(editing?.time ?? "");
  const [source, setSource] = useState<WorkoutSource>(editing?.source ?? "plan_day");
  const [planDayId, setPlanDayId] = useState<string | null>(editing?.planDayId ?? null);
  const [templateId, setTemplateId] = useState<string | null>(editing?.templateId ?? null);
  // Run and Ride keep separate drafts so values never leak between activity types.
  const [details, setDetails] = useState<Record<"run" | "ride", Details>>(() => {
    const own: Details = {
      distance: editing?.distanceKm != null ? String(editing.distanceKm) : "",
      minutes: editing?.durationSeconds != null ? formatClock(editing.durationSeconds) : "",
      note: editing?.note ?? "",
    };
    return {
      run: editing?.type === "run" ? own : emptyDetails,
      ride: editing?.type === "ride" ? own : emptyDetails,
    };
  });
  const [errors, setErrors] = useState<
    Partial<Record<"distance" | "minutes" | "note" | "workout" | "date", string>>
  >({});
  const [requestError, setRequestError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const plan = useActiveTrainingPlan(type === "workout" ? profileId : null);
  const workouts = useMyWorkouts(
    type === "workout" && source === "my_workout" ? (user?.id ?? null) : null,
    profileId,
  );
  const draft = type === "workout" ? null : details[type];
  const setDraft = (patch: Partial<Details>) =>
    type !== "workout" &&
    setDetails((current) => ({ ...current, [type]: { ...current[type], ...patch } }));

  const leave = () => {
    if (!backWithinApp(router.history)) void navigate({ to: "/planner", replace: true });
  };

  async function submit() {
    if (submitting.current) return;
    const nextErrors: typeof errors = {};
    if (!date) nextErrors.date = "Choose a date.";
    let input: PlannedInput = {
      type,
      date,
      time: time || null,
      source: null,
      planDayId: null,
      templateId: null,
      distanceKm: null,
      durationSeconds: null,
      note: null,
    };
    if (type === "workout") {
      const chosen = source === "plan_day" ? planDayId : templateId;
      // An unchanged orphaned source (deleted day/workout) remains valid for date/time edits.
      const orphanKept =
        !!editing &&
        editing.source === source &&
        (source === "plan_day" ? !editing.planDayId : !editing.templateId);
      if (!chosen && !orphanKept) nextErrors.workout = "Choose a workout.";
      input = {
        ...input,
        source,
        planDayId: source === "plan_day" ? planDayId : null,
        templateId: source === "my_workout" ? templateId : null,
      };
    } else if (draft) {
      const distance = parsePlannedDistance(draft.distance);
      const minutes = parsePlannedMinutes(draft.minutes);
      const note = parsePlannedNote(draft.note);
      if (distance.error) nextErrors.distance = distance.error;
      if (minutes.error) nextErrors.minutes = minutes.error;
      if (note.error) nextErrors.note = note.error;
      input = {
        ...input,
        distanceKm: distance.value,
        durationSeconds: minutes.value,
        note: note.value,
      };
    }
    setErrors(nextErrors);
    setRequestError(null);
    if (Object.keys(nextErrors).length) return;
    submitting.current = true;
    setPending(true);
    try {
      if (editing) await updatePlannedActivity(editing.id, editing.updatedAt, input);
      else await createPlannedActivity(input, requestId.current);
      await invalidatePlanner(queryClient);
      if (editing) leave();
      // Replace the form entry so Back from the Planner returns to where planning started.
      else void navigate({ to: "/planner", replace: true });
    } catch (error) {
      // Every typed value stays; the same request id makes a retry safe.
      setRequestError(
        userFacingError(error, editing ? "save this plan" : "add this to your planner", {
          inputPreserved: true,
        }),
      );
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  const label = editing ? "Save changes" : `Add ${ACTIVITY_LABEL[type].toLowerCase()} to planner`;
  const errorId = (field: string) => `${id}-${field}-error`;
  const fieldError = (field: keyof typeof errors) =>
    errors[field] ? (
      <p id={errorId(field)} role="alert" className="pb-2 text-right text-[12px] text-danger">
        {errors[field]}
      </p>
    ) : null;

  return (
    <form
      noValidate
      className="flex min-h-[calc(100dvh-3rem)] flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={leave}
          className="-ml-2 inline-flex min-h-11 items-center rounded-xl px-2 text-[16px] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Cancel
        </button>
        <span className="text-[15px] text-muted-foreground">Plan ahead</span>
      </div>
      <h1 className="mb-4 text-3xl font-semibold tracking-tight">
        {editing ? "Edit activity" : "Plan activity"}
      </h1>

      <div className="space-y-4">
        <div
          role="radiogroup"
          aria-label="Activity type"
          className="grid grid-cols-3 gap-1 rounded-[14px] bg-card p-1"
        >
          {(["workout", "run", "ride"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={type === option}
              disabled={!!editing && editing.type !== option}
              onClick={() => {
                setType(option);
                setErrors({});
              }}
              className={`min-h-11 rounded-[11px] text-[15px] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                type === option ? "bg-elevated font-semibold" : "font-medium text-muted-foreground"
              }`}
            >
              {ACTIVITY_LABEL[option]}
            </button>
          ))}
        </div>

        <div className="card-surface rounded-[20px] px-4">
          <div className={rowClass}>
            <span className="text-[16px]">Date</span>
            <TempoDatePicker
              label="Date"
              value={date}
              onChange={setDate}
              {...(editing ? {} : { min: today })}
              aria-invalid={!!errors.date}
              className="w-auto border-0 bg-transparent px-0 text-[15px]"
            />
          </div>
          <div className={rowClass}>
            <span className="text-[16px]">
              Time <span className="text-[13px] text-muted-foreground">· optional</span>
            </span>
            <span className="flex items-center gap-1">
              <TempoTimePicker
                label="Time"
                value={time}
                onChange={setTime}
                className="w-auto border-0 bg-transparent px-0 text-[15px]"
              />
              {time ? (
                <button
                  type="button"
                  aria-label="Clear time"
                  onClick={() => setTime("")}
                  className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </span>
          </div>
          {fieldError("date")}
        </div>

        {type === "workout" ? (
          <WorkoutChooser
            source={source}
            onSource={(next) => {
              setSource(next);
              setErrors({});
            }}
            plan={plan}
            workouts={workouts}
            planDayId={planDayId}
            templateId={templateId}
            onPlanDay={setPlanDayId}
            onTemplate={setTemplateId}
            editing={editing}
            error={errors.workout}
            errorId={errorId("workout")}
          />
        ) : draft ? (
          <section className="space-y-2" aria-labelledby={`${id}-details`}>
            <h2 id={`${id}-details`} className="px-1 text-[13px] font-medium text-muted-foreground">
              Details · all optional
            </h2>
            <div className="card-surface rounded-[20px] px-4">
              <DetailRow label="Distance" unit="km" htmlFor={`${id}-distance`}>
                <input
                  id={`${id}-distance`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  value={draft.distance}
                  aria-invalid={!!errors.distance}
                  aria-describedby={errors.distance ? errorId("distance") : undefined}
                  onChange={(event) => setDraft({ distance: event.target.value })}
                  className={inputClass}
                />
              </DetailRow>
              {fieldError("distance")}
              <DetailRow label="Duration" htmlFor={`${id}-minutes`}>
                <input
                  id={`${id}-minutes`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="e.g. 15,35"
                  aria-label="Planned duration (minutes:seconds, optional)"
                  value={draft.minutes}
                  aria-invalid={!!errors.minutes}
                  aria-describedby={errors.minutes ? errorId("minutes") : undefined}
                  onChange={(event) => setDraft({ minutes: event.target.value })}
                  onBlur={() => setDraft({ minutes: canonicalDuration(draft.minutes) })}
                  className={inputClass}
                />
              </DetailRow>
              {fieldError("minutes")}
              <DetailRow label="Note" htmlFor={`${id}-note`}>
                <input
                  id={`${id}-note`}
                  type="text"
                  autoComplete="off"
                  maxLength={200}
                  placeholder="Add a note"
                  value={draft.note}
                  aria-invalid={!!errors.note}
                  aria-describedby={errors.note ? errorId("note") : undefined}
                  onChange={(event) => setDraft({ note: event.target.value })}
                  className={`${inputClass} font-normal`}
                />
              </DetailRow>
              {fieldError("note")}
            </div>
          </section>
        ) : null}

        <p className="px-1 text-[13px] text-muted-foreground">{planningDisclaimer}</p>
      </div>

      <div className="sticky bottom-0 mt-auto -mx-5 border-t border-border bg-background px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        {requestError ? (
          <p role="alert" className="mb-2 text-[13px] text-danger">
            {requestError}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="grid h-14 w-full place-items-center rounded-[16px] bg-primary text-[16px] font-semibold text-primary-foreground active:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {pending ? "Saving…" : label}
        </button>
      </div>
    </form>
  );
}

function DetailRow({
  label,
  unit,
  htmlFor,
  children,
}: {
  label: string;
  unit?: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className={rowClass}>
      <label htmlFor={htmlFor} className="flex-none text-[16px]">
        {label}
      </label>
      <span className="flex min-w-0 flex-1 items-center justify-end gap-2">
        {children}
        {unit ? <span className="flex-none text-[15px] text-muted-foreground">{unit}</span> : null}
      </span>
    </div>
  );
}

function WorkoutChooser({
  source,
  onSource,
  plan,
  workouts,
  planDayId,
  templateId,
  onPlanDay,
  onTemplate,
  editing,
  error,
  errorId,
}: {
  source: WorkoutSource;
  onSource: (source: WorkoutSource) => void;
  plan: ReturnType<typeof useActiveTrainingPlan>;
  workouts: ReturnType<typeof useMyWorkouts>;
  planDayId: string | null;
  templateId: string | null;
  onPlanDay: (id: string) => void;
  onTemplate: (id: string) => void;
  editing: PlannedActivity | undefined;
  error: string | undefined;
  errorId: string;
}) {
  const options =
    source === "plan_day"
      ? (plan.data?.days ?? []).map((day) => ({
          id: day.id,
          name: day.name,
          detail: `${day.exercises.length} ${day.exercises.length === 1 ? "exercise" : "exercises"}`,
        }))
      : (workouts.data ?? []).map((workout) => ({
          id: workout.id,
          name: workout.title,
          detail: `${workout.exerciseCount} ${workout.exerciseCount === 1 ? "exercise" : "exercises"}`,
        }));
  const selected = source === "plan_day" ? planDayId : templateId;
  const query = source === "plan_day" ? plan : workouts;
  // A snapshot whose source was deleted stays visible and selectable as-is.
  const orphan =
    editing &&
    editing.source === source &&
    !(source === "plan_day" ? editing.planDayId : editing.templateId)
      ? editing.workoutName
      : null;
  return (
    <section className="space-y-2" aria-label="Workout">
      <h2 className="px-1 text-[13px] font-medium text-muted-foreground">Workout</h2>
      <div
        role="radiogroup"
        aria-label="Workout source"
        className="grid grid-cols-2 gap-1 rounded-[14px] bg-card p-1"
      >
        {(["plan_day", "my_workout"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={source === option}
            onClick={() => onSource(option)}
            className={`min-h-11 rounded-[11px] text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              source === option ? "bg-elevated font-semibold" : "font-medium text-muted-foreground"
            }`}
          >
            {option === "plan_day" ? "Current plan" : "My Workouts"}
          </button>
        ))}
      </div>
      {query.isLoading ? (
        <p role="status" className="px-1 py-3 text-[14px] text-muted-foreground">
          Loading workouts…
        </p>
      ) : query.error ? (
        <p role="alert" className="px-1 py-3 text-[14px] text-danger">
          Could not load workouts.{" "}
          <button
            type="button"
            className="min-h-11 font-semibold underline"
            onClick={() => void query.refetch()}
          >
            Try again
          </button>
        </p>
      ) : options.length === 0 && !orphan ? (
        <div className="card-surface space-y-1 rounded-[20px] p-4 text-[14px] text-muted-foreground">
          {source === "plan_day" ? (
            <>
              <p>You don't have a current training plan with workout days.</p>
              <Link
                to="/bulk/training"
                className="inline-flex min-h-11 items-center font-semibold text-primary"
              >
                Open Training
              </Link>
            </>
          ) : (
            <>
              <p>You haven't saved any workouts yet.</p>
              <Link
                to="/bulk/training/workouts"
                className="inline-flex min-h-11 items-center font-semibold text-primary"
              >
                Open My Workouts
              </Link>
            </>
          )}
        </div>
      ) : (
        <div
          role="radiogroup"
          aria-label={source === "plan_day" ? "Current plan workouts" : "My Workouts"}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          className="card-surface rounded-[20px] px-4"
        >
          {orphan ? (
            <div className="flex min-h-[60px] items-center gap-3.5 border-t border-border py-2 first:border-t-0">
              <Radio checked={!selected} />
              <span className="min-w-0">
                <span className="block truncate text-[16px] font-semibold">{orphan}</span>
                <span className="block text-[13px] text-muted-foreground">No longer available</span>
              </span>
            </div>
          ) : null}
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected === option.id}
              onClick={() => (source === "plan_day" ? onPlanDay(option.id) : onTemplate(option.id))}
              className="flex min-h-[60px] w-full min-w-0 items-center gap-3.5 border-t border-border py-2 text-left first:border-t-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <Radio checked={selected === option.id} />
              <span className="min-w-0">
                <span className="block truncate text-[16px] font-semibold">{option.name}</span>
                <span className="num block text-[13px] text-muted-foreground">{option.detail}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {error ? (
        <p id={errorId} role="alert" className="px-1 text-[12px] text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function Radio({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid h-7 w-7 flex-none place-items-center rounded-full border-2 ${
        checked ? "border-primary bg-primary" : "border-muted-foreground/40"
      }`}
    >
      {checked ? <span className="h-2.5 w-2.5 rounded-full bg-primary-foreground" /> : null}
    </span>
  );
}

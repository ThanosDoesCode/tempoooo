import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TempoDatePicker, TempoTimePicker } from "@/components/TempoDateTimePicker";
import { ActivityTile } from "@/components/PlannerParts";
import { useMyChallenge } from "@/lib/challenge";
import { userFacingError } from "@/lib/network-errors";
import { usePlannedWorkoutStart } from "@/lib/planner-start";
import {
  canStartPlanned,
  formatKm,
  formatMinutes,
  plannedStatus,
  plannedTitle,
  plannedWhen,
  type PlannedActivity,
} from "@/lib/planner";
import {
  deletePlannedActivity,
  invalidatePlanner,
  reschedulePlannedActivity,
} from "@/lib/planner-query";

const primaryClass =
  "grid h-14 w-full place-items-center rounded-[16px] bg-primary text-[16px] font-semibold text-primary-foreground active:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card";
const secondaryClass =
  "grid h-12 w-full place-items-center rounded-[14px] bg-elevated text-[15px] font-semibold active:opacity-80 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function PlannedItemSheet({
  item,
  open,
  loading,
  profileId,
  today,
  onClose,
}: {
  item: PlannedActivity | null | undefined;
  open: boolean;
  loading: boolean;
  profileId: string | null;
  today: string;
  onClose: () => void;
}) {
  return (
    <Drawer open={open} onOpenChange={(next) => !next && onClose()} shouldScaleBackground={false}>
      {open ? (
        <DrawerContent
          aria-describedby={undefined}
          className="max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-t-[28px] border-0 bg-card px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-3 [&>div:first-child]:mt-0 [&>div:first-child]:h-[5px] [&>div:first-child]:w-10 [&>div:first-child]:bg-[oklch(38%_.01_260)]"
        >
          {item ? (
            <PlannedItemContent item={item} profileId={profileId} today={today} onClose={onClose} />
          ) : (
            <div className="flex items-center justify-between gap-3 py-4">
              <DrawerTitle className="text-[17px] font-semibold">
                {loading ? "Loading planned activity…" : "This planned activity is no longer here."}
              </DrawerTitle>
              <DrawerClose
                aria-label="Close"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-muted"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </DrawerClose>
            </div>
          )}
        </DrawerContent>
      ) : null}
    </Drawer>
  );
}

function PlannedItemContent({
  item,
  profileId,
  today,
  onClose,
}: {
  item: PlannedActivity;
  profileId: string | null;
  today: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const status = plannedStatus(item);
  const workoutStart = usePlannedWorkoutStart(item.type === "workout" ? profileId : null);
  const challenge = useMyChallenge();
  const challengeActive = challenge.data?.status === "active";
  const [mode, setMode] = useState<"view" | "reschedule">("view");
  const [date, setDate] = useState(item.date);
  const [time, setTime] = useState(item.time ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const busy = saving || workoutStart.pendingId === item.id;

  async function saveReschedule() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await reschedulePlannedActivity(item.id, date, time || null);
      await invalidatePlanner(queryClient);
      setMode("view");
    } catch (rescheduleError) {
      // The chosen date/time stay in place for another try.
      setError(
        userFacingError(rescheduleError, "reschedule this activity", { inputPreserved: true }),
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await deletePlannedActivity(item.id);
      await invalidatePlanner(queryClient);
      onClose();
    } catch (deleteError) {
      setError(userFacingError(deleteError, "delete this planned activity"));
    } finally {
      setSaving(false);
    }
  }

  const logLabel = item.type === "ride" ? "Log ride" : "Log run";
  let primary: ReactNode = null;
  if (status === "completed") {
    primary = (
      <p className="rounded-[14px] bg-primary/10 px-4 py-3 text-[14px] text-primary">
        Completed. Your logged {item.type === "workout" ? "workout" : item.type} is in your history.
      </p>
    );
  } else if (item.type === "workout" && item.source === "my_workout") {
    primary = item.templateId ? (
      <Link
        to="/bulk/training/workouts/$workoutId"
        params={{ workoutId: item.templateId }}
        search={{ edit: false }}
        className={primaryClass}
      >
        Open workout
      </Link>
    ) : (
      <p className="text-[14px] text-muted-foreground">
        This workout was deleted from My Workouts. You can still reschedule or delete this plan.
      </p>
    );
  } else if (item.type === "workout") {
    primary = !item.planDayId ? (
      <p className="text-[14px] text-muted-foreground">
        This workout is no longer in your current plan.
      </p>
    ) : canStartPlanned(item, today) ? (
      <button
        type="button"
        disabled={busy}
        aria-busy={workoutStart.pendingId === item.id}
        onClick={() => void workoutStart.start(item)}
        className={primaryClass}
      >
        {workoutStart.pendingId === item.id
          ? "Starting…"
          : status === "in_progress" || workoutStart.activeSession
            ? "Resume workout"
            : "Start workout"}
      </button>
    ) : (
      <p className="text-[14px] text-muted-foreground">You can start it on the day.</p>
    );
  } else if (challengeActive) {
    primary = (
      <>
        <Link
          to="/challenge/add"
          search={{
            type: item.type === "ride" ? "cycle" : "run",
            planned: item.id,
            // Raw planned values only; the Challenge form keeps its own conversion and rules.
            ...(item.distanceKm != null ? { distance: String(item.distanceKm) } : {}),
            ...(item.durationSeconds != null ? { duration: item.durationSeconds } : {}),
            ...(item.note ? { note: item.note } : {}),
          }}
          className={primaryClass}
        >
          {logLabel}
        </Link>
        <p className="mt-2 text-center text-[13px] text-muted-foreground">
          Opens the {item.type} form with these values filled in.
        </p>
      </>
    );
  } else if (!challenge.isLoading) {
    primary = (
      <p className="text-[14px] text-muted-foreground">
        Logging runs and rides currently requires an active Challenge.
      </p>
    );
  }

  const source =
    item.type !== "workout"
      ? null
      : [
          item.source === "my_workout" ? "My Workouts" : "From your plan",
          item.exerciseCount ? `${item.exerciseCount} exercises` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3.5">
        <ActivityTile item={item} size="lg" />
        <div className="min-w-0 flex-1 pt-1">
          <DrawerTitle className="text-[22px] font-semibold leading-tight tracking-tight [overflow-wrap:anywhere]">
            {plannedTitle(item)}
          </DrawerTitle>
          <p className="num mt-0.5 text-[15px] text-muted-foreground">{plannedWhen(item, today)}</p>
        </div>
        <DrawerClose
          aria-label="Close"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-muted text-foreground active:opacity-80"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </DrawerClose>
      </div>

      {item.type === "workout" ? (
        <div className="rounded-[18px] bg-elevated px-4 py-3.5 text-[15px] text-muted-foreground">
          {source}
        </div>
      ) : item.distanceKm != null || item.durationSeconds != null || item.note ? (
        <div className="rounded-[18px] bg-elevated px-4 py-3.5">
          {item.distanceKm != null || item.durationSeconds != null ? (
            <dl className="grid grid-cols-2 gap-3">
              {item.distanceKm != null ? (
                <div>
                  <dt className="text-[13px] text-muted-foreground">Planned distance</dt>
                  <dd className="num text-[20px] font-semibold">{formatKm(item.distanceKm)}</dd>
                </div>
              ) : null}
              {item.durationSeconds != null ? (
                <div>
                  <dt className="text-[13px] text-muted-foreground">Planned time</dt>
                  <dd className="num text-[20px] font-semibold">
                    {formatMinutes(item.durationSeconds)}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          {item.note ? (
            <p className="mt-2 text-[14px] text-muted-foreground [overflow-wrap:anywhere] first:mt-0">
              {item.note}
            </p>
          ) : null}
        </div>
      ) : null}

      {mode === "reschedule" ? (
        <div className="space-y-3" role="group" aria-label="Reschedule">
          <TempoDatePicker label="Date" value={date} onChange={setDate} />
          <div className="flex items-center gap-2">
            <TempoTimePicker label="Time" value={time} onChange={setTime} className="flex-1" />
            {time ? (
              <button
                type="button"
                aria-label="Clear time"
                onClick={() => setTime("")}
                className="grid h-11 w-11 place-items-center rounded-full bg-elevated text-muted-foreground"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              className={secondaryClass}
              disabled={saving}
              onClick={() => {
                // Cancel writes nothing and restores the saved values.
                setDate(item.date);
                setTime(item.time ?? "");
                setError(null);
                setMode("view");
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`${secondaryClass} bg-primary text-primary-foreground`}
              disabled={saving || !date}
              aria-busy={saving}
              onClick={() => void saveReschedule()}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <>
          {primary}
          {workoutStart.error ? (
            <p role="alert" className="text-[13px] text-danger">
              {workoutStart.error}
            </p>
          ) : null}
          {status !== "completed" ? (
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                className={secondaryClass}
                disabled={busy}
                onClick={() => setMode("reschedule")}
              >
                Reschedule
              </button>
              <button
                type="button"
                className={secondaryClass}
                disabled={busy}
                onClick={() =>
                  void navigate({ to: "/planner/$plannedId/edit", params: { plannedId: item.id } })
                }
              >
                Edit
              </button>
            </div>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
            className="mx-auto flex min-h-11 items-center rounded-xl px-4 text-[15px] font-medium text-danger disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Delete from planner
          </button>
        </>
      )}
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="w-[calc(100%-2.5rem)] max-w-sm gap-4 rounded-[20px] border-border bg-card p-5 sm:rounded-[20px] motion-reduce:animate-none">
          <AlertDialogHeader className="space-y-1 text-left">
            <AlertDialogTitle className="text-lg">Delete from planner?</AlertDialogTitle>
            <AlertDialogDescription className="[overflow-wrap:anywhere]">
              {status === "completed"
                ? `“${plannedTitle(item)}” leaves your planner. Your logged activity stays in your history.`
                : `“${plannedTitle(item)}” will be removed from your planner.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="grid grid-cols-2 gap-2 sm:space-x-0">
            <AlertDialogCancel className="mt-0 h-12 min-w-0 rounded-xl border-border bg-elevated px-2 text-sm">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-12 min-w-0 rounded-xl bg-danger px-2 text-sm text-white hover:bg-danger/90"
              onClick={() => void remove()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { Link, useNavigate } from "@tanstack/react-router";
import { Bike, Dumbbell, Footprints, Moon, Utensils, X, type LucideIcon } from "lucide-react";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { useMyChallenge } from "@/lib/challenge";
import { LOG_ACTIONS, type LogAction } from "@/lib/main-navigation";

const ICONS: Record<string, LucideIcon> = {
  run: Footprints,
  ride: Bike,
  "weigh-in": Moon,
  meal: Utensils,
  workout: Dumbbell,
};

/**
 * Shared "+" Log sheet. Challenge logging is available only with an active Challenge;
 * fitness actions keep their existing gates. Read access only while the sheet is open,
 * sharing the canonical Challenge cache instead of adding startup work.
 */
export function LogSheet({
  open,
  onOpenChange,
  showFitnessActions = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Challenge-only (core) accounts hide the fitness-only "Your day" actions. */
  showFitnessActions?: boolean;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
      {open ? (
        <LogSheetContent onOpenChange={onOpenChange} showFitnessActions={showFitnessActions} />
      ) : null}
    </Drawer>
  );
}

export function LogSheetContent({
  onOpenChange,
  showFitnessActions,
}: {
  onOpenChange: (open: boolean) => void;
  showFitnessActions: boolean;
}) {
  const navigate = useNavigate();
  const challengeQuery = useMyChallenge();
  const canLog = challengeQuery.data?.status === "active";
  const challenge = LOG_ACTIONS.filter((action) => action.group === "challenge");
  const day = LOG_ACTIONS.filter((action) => action.group === "day");

  const go = (action: LogAction) => {
    onOpenChange(false);
    void navigate(action.search ? { to: action.to, search: action.search } : { to: action.to });
  };

  return (
    <DrawerContent
      aria-describedby={undefined}
      className="max-h-[calc(100dvh-1rem)] overflow-y-auto mt-24 gap-3.5 rounded-t-[28px] border-0 bg-card px-5 pb-[max(2.25rem,env(safe-area-inset-bottom))] pt-3 [&>div:first-child]:mt-0 [&>div:first-child]:h-[5px] [&>div:first-child]:w-10 [&>div:first-child]:bg-[oklch(38%_.01_260)]"
    >
      <div className="flex items-center justify-between">
        <DrawerTitle className="text-[22px] font-semibold tracking-tight">
          What do you want to log?
        </DrawerTitle>
        <DrawerClose
          aria-label="Close"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-muted text-foreground active:opacity-80"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </DrawerClose>
      </div>

      <p className="mx-1 text-[13px] font-medium text-muted-foreground">
        {canLog ? "Counts toward your challenge" : "Run & ride"}
      </p>
      <div className="grid grid-cols-2 gap-3">
        {challenge.map((action) => {
          const Icon = ICONS[action.key]!;
          if (!canLog)
            return (
              <button
                key={action.key}
                type="button"
                disabled
                className="flex h-[100px] min-w-0 flex-col justify-between rounded-[18px] bg-elevated p-4 text-left text-muted-foreground"
              >
                <Icon className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
                <span className="text-[17px] font-semibold">{action.label}</span>
              </button>
            );
          return (
            <Link
              key={action.key}
              to={action.to}
              {...(action.search ? { search: action.search } : {})}
              onClick={() => onOpenChange(false)}
              className="flex h-[118px] flex-col justify-between rounded-[18px] bg-primary p-4 text-primary-foreground active:opacity-90"
            >
              <Icon className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
              <span>
                <span className="block text-[17px] font-semibold">{action.label}</span>
                <span className="mt-0.5 block text-[13px] opacity-75">{action.description}</span>
              </span>
            </Link>
          );
        })}
      </div>

      {!canLog ? (
        <div className="text-sm text-muted-foreground">
          {challengeQuery.isLoading ? (
            <p role="status">Checking challenge…</p>
          ) : challengeQuery.isError ? (
            <>
              <p role="alert">Could not check Challenge access.</p>
              <button
                type="button"
                className="min-h-11 rounded-xl px-2 text-primary focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => void challengeQuery.refetch()}
              >
                Try again
              </button>
            </>
          ) : (
            <>
              <p>Join or create an active challenge to log a run or ride.</p>
              <Link
                to="/challenge"
                onClick={() => onOpenChange(false)}
                className="inline-flex min-h-11 items-center rounded-xl text-primary focus-visible:ring-2 focus-visible:ring-ring"
              >
                Open Challenge
              </Link>
            </>
          )}
        </div>
      ) : null}
      {showFitnessActions ? (
        <>
          <p className="mx-1 text-[13px] font-medium text-muted-foreground">Your day</p>
          <div className="rounded-[18px] bg-elevated px-4">
            {day.map((action) => {
              const Icon = ICONS[action.key]!;
              return (
                <button
                  key={action.key}
                  type="button"
                  onClick={() => go(action)}
                  className="flex min-h-[56px] w-full items-center gap-3.5 border-t border-border py-2 text-left first:border-t-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:opacity-80"
                >
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-[11px] bg-muted">
                    <Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-[15px] font-medium">{action.label}</span>
                    <span className="mt-0.5 block text-[13px] text-muted-foreground">
                      {action.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </DrawerContent>
  );
}

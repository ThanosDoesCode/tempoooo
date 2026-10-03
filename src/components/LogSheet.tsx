import { Link, useNavigate } from "@tanstack/react-router";
import { Bike, Dumbbell, Footprints, Moon, Utensils, X, type LucideIcon } from "lucide-react";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { LOG_ACTIONS, type LogAction } from "@/lib/main-navigation";

const ICONS: Record<string, LucideIcon> = {
  run: Footprints,
  ride: Bike,
  "weigh-in": Moon,
  meal: Utensils,
  workout: Dumbbell,
};

/**
 * Shared "+" Log sheet (Log.html). A bottom sheet with two groups — "Counts toward your
 * challenge" (Run, Ride) and "Your day" (Weigh-in & sleep, Meal, Workout) — each routing to
 * the existing functional flow. vaul provides the focus trap, Escape/backdrop close and grab
 * handle; selecting an action navigates and closes the sheet.
 */
export function LogSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const challenge = LOG_ACTIONS.filter((action) => action.group === "challenge");
  const day = LOG_ACTIONS.filter((action) => action.group === "day");

  const go = (action: LogAction) => {
    onOpenChange(false);
    void navigate({ to: action.to });
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
      <DrawerContent className="mt-24 gap-3.5 rounded-t-[28px] border-0 bg-card px-5 pb-[max(2.25rem,env(safe-area-inset-bottom))] pt-3 [&>div:first-child]:bg-[oklch(38%_.01_260)]">
        <div className="flex items-center justify-between">
          <DrawerTitle className="text-[22px] font-semibold tracking-tight">
            What do you want to log?
          </DrawerTitle>
          <DrawerClose
            aria-label="Close"
            className="grid h-11 w-11 place-items-center rounded-full bg-muted text-foreground active:opacity-80"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </DrawerClose>
        </div>

        <p className="mx-1 text-[13px] font-medium text-muted-foreground">
          Counts toward your challenge
        </p>
        <div className="grid grid-cols-2 gap-3">
          {challenge.map((action) => {
            const Icon = ICONS[action.key]!;
            return (
              <Link
                key={action.key}
                to={action.to}
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

        <p className="mx-1 text-[13px] font-medium text-muted-foreground">Your day</p>
        <div className="rounded-[18px] bg-elevated px-4">
          {day.map((action) => {
            const Icon = ICONS[action.key]!;
            return (
              <button
                key={action.key}
                type="button"
                onClick={() => go(action)}
                className="flex min-h-[60px] w-full items-center gap-3.5 border-t border-border text-left first:border-t-0 active:opacity-80"
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
      </DrawerContent>
    </Drawer>
  );
}

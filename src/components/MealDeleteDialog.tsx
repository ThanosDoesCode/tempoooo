import { useRef } from "react";
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

/** Shared presentation only; callers retain their existing delete and invalidation paths. */
export function MealDeleteDialog({
  name,
  preset = false,
  open,
  onOpenChange,
  onConfirm,
}: {
  name: string;
  preset?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  const confirmedName = useRef(name);
  const displayName = name || confirmedName.current;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        className="w-[calc(100%-2.5rem)] max-w-sm gap-4 rounded-[20px] border-border bg-card p-5 sm:rounded-[20px] motion-reduce:animate-none"
        onOpenAutoFocus={() => {
          returnFocus.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          confirmedName.current = name;
        }}
        onCloseAutoFocus={(event) => {
          if (returnFocus.current?.isConnected) {
            event.preventDefault();
            returnFocus.current.focus({ preventScroll: true });
          }
        }}
      >
        <AlertDialogHeader className="space-y-1 text-left">
          <AlertDialogTitle className="text-lg">
            {preset ? "Delete meal preset?" : "Delete meal?"}
          </AlertDialogTitle>
          <AlertDialogDescription className="[overflow-wrap:anywhere]">
            {preset
              ? `“${displayName}” will be deleted. Already logged meals will stay unchanged.`
              : `“${displayName}” will be removed from this day.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="grid grid-cols-2 gap-2 sm:space-x-0">
          <AlertDialogCancel className="mt-0 h-12 min-w-0 rounded-xl border-border bg-elevated px-2 text-sm">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            className="h-12 min-w-0 rounded-xl bg-danger px-2 text-sm text-white hover:bg-danger/90"
            onClick={onConfirm}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Trash2 } from "lucide-react";
import { PendingLabel } from "@/components/ui-kit";
import { deleteTempoAccount } from "@/lib/privileged-rpcs.functions";

/** Presentation confirmation only. The authenticated server still derives the deleted user. */
export function DeleteAccountDialog({ onDeleted }: { onDeleted: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const accountDeleted = useRef(false);

  const remove = async () => {
    if (confirmation !== "DELETE" || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      if (!accountDeleted.current) {
        await deleteTempoAccount({ data: { confirmation: "Delete my account" } });
        accountDeleted.current = true;
      }
      await onDeleted();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setError(
        accountDeleted.current
          ? "Your account was deleted, but Tempo couldn't finish signing out. Retry to finish."
          : /account_deletion_photo_cleanup_failed/.test(message)
            ? "Photo cleanup could not finish. Your account and database records were kept. Some photos may already have been removed. You can retry."
            : /account_deletion_photo_discovery_failed/.test(message)
              ? "Tempo couldn't load all your photos. Your account has not been deleted. Please retry."
              : "Your account could not be deleted. Please try again.",
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (inFlight.current) return;
        setOpen(next);
        if (!next) {
          setConfirmation("");
          setError(null);
        }
      }}
    >
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium text-danger hover:bg-danger/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete account
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content
          className="fixed bottom-0 left-1/2 z-50 max-h-[90svh] w-full max-w-lg -translate-x-1/2 overflow-y-auto rounded-t-[28px] border border-border bg-card px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-[20px]"
          onEscapeKeyDown={(event) => {
            if (inFlight.current) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (inFlight.current) event.preventDefault();
          }}
        >
          <Dialog.Title className="text-2xl font-semibold tracking-tight">
            Delete your account?
          </Dialog.Title>
          <Dialog.Description className="mt-3 text-sm leading-6 text-muted-foreground">
            This permanently deletes your account and owned Goal data, including meals, workouts and
            progress photos. Shared Challenge records are preserved. This cannot be undone.
          </Dialog.Description>
          <p className="mt-3 text-[13px] leading-5 text-muted-foreground">
            Want a copy of your Challenge data? Download the CSV from You before continuing.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void remove();
            }}
          >
            <label className="mt-5 block text-[13px] text-muted-foreground">
              Type DELETE to confirm
              <input
                className="account-input mt-2"
                value={confirmation}
                disabled={pending}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
            {error ? (
              <p role="alert" className="mt-3 text-sm leading-5 text-warn">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={confirmation !== "DELETE" || pending}
              className="mt-5 flex min-h-13 w-full items-center justify-center rounded-2xl bg-danger px-4 font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50"
            >
              {pending ? (
                <PendingLabel>Deleting account…</PendingLabel>
              ) : accountDeleted.current ? (
                "Finish signing out"
              ) : (
                "Delete my account"
              )}
            </button>
          </form>
          <Dialog.Close asChild>
            <button type="button" disabled={pending} className="account-secondary mt-3">
              Keep my account
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

import { useRef } from "react";
import { useBlocker } from "@tanstack/react-router";
import * as Dialog from "@radix-ui/react-dialog";

/** One router/history guard for the existing Goal editors, including browser Back. */
export function UnsavedSettingsDialog({ dirty }: { dirty: boolean }) {
  const returnFocus = useRef<HTMLElement | null>(null);
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    disabled: !dirty,
    enableBeforeUnload: dirty,
    withResolver: true,
  });
  return (
    <Dialog.Root
      open={blocker.status === "blocked"}
      onOpenChange={(open) => {
        if (!open) blocker.reset?.();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content
          onOpenAutoFocus={() => {
            returnFocus.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            if (returnFocus.current?.isConnected) {
              event.preventDefault();
              returnFocus.current.focus();
            }
          }}
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2.5rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[20px] border border-border bg-card p-5"
        >
          <Dialog.Title className="text-xl font-semibold">Leave without saving?</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">
            Your unsaved target edits will be lost. Saved settings and history are unchanged.
          </Dialog.Description>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button type="button" className="account-secondary" onClick={() => blocker.reset?.()}>
              Keep editing
            </button>
            <button type="button" className="account-primary" onClick={() => blocker.proceed?.()}>
              Leave
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

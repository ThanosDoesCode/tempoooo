import { useEffect, useRef, useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import * as Dialog from "@/components/ui/dialog-root";
import { useOverlayBack } from "./NavigationOverlay";

/** One router/history guard for the existing Goal editors, including browser Back. */
export function UnsavedSettingsDialog({
  dirty,
  description = "Your unsaved target edits will be lost. Saved settings and history are unchanged.",
  ignoreSearch = false,
}: {
  dirty: boolean;
  description?: string;
  ignoreSearch?: boolean;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  const [blocked, setBlocked] = useState(false);
  const pending = useRef<((block: boolean) => void) | null>(null);
  const resolve = (leave: boolean) => {
    const finish = pending.current;
    pending.current = null;
    setBlocked(false);
    finish?.(!leave);
  };
  useBlocker({
    // Same-screen picker/overlay history does not discard the form. Its own Cancel/date
    // controls retain their existing draft checks; a real route exit is guarded here.
    shouldBlockFn: ({ current, next }) => {
      if (pending.current) {
        resolve(false);
        return true;
      }
      if (
        !dirty ||
        (current.pathname === next.pathname &&
          (ignoreSearch || JSON.stringify(current.search) === JSON.stringify(next.search)))
      )
        return false;
      return new Promise<boolean>((finish) => {
        pending.current = finish;
        setBlocked(true);
      });
    },
    disabled: !dirty,
    enableBeforeUnload: dirty,
    withResolver: false,
  });
  useOverlayBack(
    blocked,
    (open) => {
      if (!open) resolve(false);
    },
    { kind: "guard", frame: false },
  );
  useEffect(
    () => () => {
      pending.current?.(true);
      pending.current = null;
    },
    [],
  );
  return (
    <Dialog.Root
      historyBack={false}
      open={blocked}
      onOpenChange={(open) => {
        if (!open) resolve(false);
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
            {description}
          </Dialog.Description>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button type="button" className="account-secondary" onClick={() => resolve(false)}>
              Keep editing
            </button>
            <button type="button" className="account-primary" onClick={() => resolve(true)}>
              Leave
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

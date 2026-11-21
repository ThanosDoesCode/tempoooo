import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/history";
import { createOverlayHistory } from "@/lib/overlay-history";

const Depth = createContext(0);
const ParentLayer = createContext<string | undefined>(undefined);
const controllers = new WeakMap<RouterHistory, ReturnType<typeof createOverlayHistory>>();

export function useOverlayBack(
  open: boolean,
  onOpenChange: (open: boolean) => void,
  {
    enabled = true,
    dismissible = true,
    kind = "overlay",
    frame = true,
  }: {
    enabled?: boolean;
    dismissible?: boolean;
    kind?: "overlay" | "step" | "guard";
    frame?: boolean;
  } = {},
) {
  const router = useRouter({ warn: false });
  const depth = useContext(Depth);
  const parentId = useContext(ParentLayer);
  const id = useId();
  const callback = useRef(onOpenChange);
  callback.current = onOpenChange;
  const controller = router?.history ? controllers.get(router.history) : undefined;
  useEffect(() => {
    if (!enabled || !router?.history) return;
    let active = controllers.get(router.history);
    if (!active) {
      active = createOverlayHistory(router.history, (token) =>
        router.navigate({
          href: router.history.location.href,
          state: { tempoOverlay: token },
          resetScroll: false,
        }),
      );
      controllers.set(router.history, active);
    }
    active.update({
      id,
      open,
      depth,
      parentId,
      kind,
      frame,
      dismissible,
      change: (value) => callback.current(value),
    });
  });
  useEffect(
    () => () => {
      if (router?.history) controllers.get(router.history)?.remove(id);
    },
    [router, id],
  );
  useEffect(() => {
    if (!enabled) controller?.remove(id);
  }, [enabled, controller, id]);
  return id;
}

/** Local flows declare their child ownership without adding a DOM wrapper or another layer. */
export function NavigationBackScope({
  ownerId,
  children,
}: {
  ownerId: string;
  children: ReactNode;
}) {
  return <ParentLayer.Provider value={ownerId}>{children}</ParentLayer.Provider>;
}

/** Shared by controlled/uncontrolled Radix and Vaul roots; existing focus behavior stays native. */
export function NavigationOverlay({
  open,
  defaultOpen = false,
  onOpenChange,
  historyBack = true,
  dismissible = true,
  children,
}: {
  open?: boolean | undefined;
  defaultOpen?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  historyBack?: boolean | undefined;
  dismissible?: boolean | undefined;
  children: (state: { open: boolean; onOpenChange: (open: boolean) => void }) => ReactNode;
}) {
  const [local, setLocal] = useState(defaultOpen);
  const value = open ?? local;
  const depth = useContext(Depth);
  const change = (next: boolean) => {
    if (!dismissible && !next) return;
    if (open === undefined) setLocal(next);
    onOpenChange?.(next);
  };
  const ownerId = useOverlayBack(value, change, { enabled: historyBack, dismissible });
  return (
    <NavigationBackScope ownerId={ownerId}>
      <Depth.Provider value={depth + 1}>
        {children({ open: value, onOpenChange: change })}
      </Depth.Provider>
    </NavigationBackScope>
  );
}

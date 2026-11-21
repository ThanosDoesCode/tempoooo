import type { RouterHistory } from "@tanstack/history";
import { navigationRevision, registerBackHandler, trackInAppHistory } from "./in-app-back.ts";

export type BackLayer = {
  id: string;
  open: boolean;
  depth: number;
  parentId?: string | undefined;
  kind?: "overlay" | "step" | "guard";
  frame?: boolean;
  dismissible?: boolean;
  change: (open: boolean) => void;
};
type Frame = {
  revision: number;
  owner: string;
  href: string;
  baseKey: string | undefined;
  baseIndex: number;
  retired?: boolean;
};

/** Open UI owners only. Browser/TanStack history remains the sole navigation stack. */
export function createOverlayHistory(
  history: RouterHistory,
  push: (token: string) => void | Promise<unknown> = (token) =>
    history.push(history.location.href, { tempoOverlay: token }),
) {
  trackInAppHistory(history);
  const layers = new Map<string, BackLayer>();
  const frames = new Map<string, Frame>();
  let serial = 0;
  let scheduled = false;
  let moving = false;
  let creating = false;
  let disposed = false;
  let last = history.location;
  let furthestIndex = last.state.__TSR_index;
  let identity = navigationRevision();
  const released: Array<() => void> = [];
  const replace = history.replace;
  // Same-screen replacements keep their existing overlay frame. On close, the base entry is
  // rebased to the latest date/filter, so a picker never reintroduces date-browsing history.
  const replaceWithFrame: RouterHistory["replace"] = (path, state, options) => {
    const token = history.location.state.tempoOverlay;
    if (
      token &&
      frames.has(token) &&
      new URL(path, "https://tempo.invalid").pathname === history.location.pathname
    )
      replace(path, { ...state, tempoOverlay: token }, options);
    else replace(path, state, options);
  };
  history.replace = replaceWithFrame;
  const layerDepth = (layer: BackLayer, seen = new Set<string>()): number => {
    if (seen.has(layer.id)) return layer.depth;
    seen.add(layer.id);
    const parent = layer.parentId ? layers.get(layer.parentId) : undefined;
    return parent ? Math.max(layer.depth, layerDepth(parent, seen) + 1) : layer.depth;
  };
  const top = () =>
    [...layers.values()]
      .filter((layer) => layer.open)
      .sort(
        (a, b) =>
          // An already-blocked navigation keeps its confirmation owner. Otherwise actual
          // nesting wins over kind, including local steps inside a containing dialog.
          Number(a.kind === "guard") - Number(b.kind === "guard") ||
          layerDepth(a) - layerDepth(b) ||
          Number(a.kind !== "step") - Number(b.kind !== "step") ||
          a.id.localeCompare(b.id),
      )
      .at(-1);
  const currentFrame = () => {
    const frame = frames.get(history.location.state.tempoOverlay ?? "");
    return frame?.revision === navigationRevision() && !frame.retired ? frame : undefined;
  };
  const schedule = () => {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      sync();
    });
  };
  const sync = () => {
    if (disposed || moving || creating) return;
    if (identity !== navigationRevision()) {
      identity = navigationRevision();
      frames.clear();
      layers.forEach((layer) => {
        layer.open = false;
      });
      return;
    }
    const layer = top();
    // A confirmation resolves an existing blocked navigation; never push another transaction.
    if (layer?.frame === false) return;
    if (layer && !currentFrame()) {
      const token = `tempo-overlay-${identity}-${++serial}`;
      frames.set(token, {
        revision: identity,
        owner: layer.id,
        href: history.location.href,
        baseKey: history.location.state.__TSR_key ?? history.location.state.key,
        baseIndex: history.location.state.__TSR_index,
      });
      // Keep the registry bounded; entries from unmounted routes cannot restore private UI.
      if (frames.size > 64) frames.delete(frames.keys().next().value!);
      creating = true;
      let failed = false;
      Promise.resolve(push(token))
        .catch(() => {
          failed = true;
          frames.delete(token);
        })
        .finally(() => {
          creating = false;
          if (!failed) schedule();
        });
    } else if (!layer && currentFrame()) {
      moving = true;
      history.back({ ignoreBlocker: true });
    }
  };
  const dismiss = () => {
    if (moving) return true;
    const layer = top();
    if (!layer) return false;
    if (layer.dismissible === false || moving) return true;
    // One frame protects the route. Nested owners are closed one at a time.
    layer.change(false);
    schedule();
    return true;
  };
  const release = () =>
    new Promise<void>((resolve) => {
      if (!currentFrame()) {
        resolve();
        return;
      }
      released.push(resolve);
      layers.forEach((layer) => {
        layer.open = false;
      });
      if (moving) return;
      moving = true;
      history.back({ ignoreBlocker: true });
    });
  const removeHandler = registerBackHandler(history, dismiss, release);
  const unsubscribe = history.subscribe(({ action }) => {
    const previous = last;
    last = history.location;
    const index = last.state.__TSR_index;
    furthestIndex = action.type === "PUSH" ? index : Math.max(furthestIndex, index);
    const pop = action.type === "BACK" || action.type === "FORWARD" || action.type === "GO";
    const marker = last.state.tempoOverlay;
    const frame = marker ? frames.get(marker) : undefined;
    if (marker && frame && action.type === "REPLACE") frame.href = last.href;
    if (pop && marker) {
      moving = false;
      const owner =
        frame?.revision === navigationRevision() && !frame.retired
          ? layers.get(frame.owner)
          : undefined;
      if (!owner) {
        // Skip an expired UI frame in the traversal direction. At the known forward
        // boundary, return to its base instead of leaving a non-interactive ghost page.
        const forward = index > previous.state.__TSR_index;
        moving = true;
        if (forward && index < furthestIndex) history.forward({ ignoreBlocker: true });
        else history.back({ ignoreBlocker: true });
      } else {
        owner.change(true);
      }
      return;
    }
    if (pop && previous.state.tempoOverlay) {
      const old = frames.get(previous.state.tempoOverlay);
      const layer = top();
      const programmatic = moving;
      moving = false;
      const isBase =
        old?.revision === navigationRevision() &&
        old.baseIndex === index &&
        old.baseKey !== undefined &&
        old.baseKey === (last.state.__TSR_key ?? last.state.key);
      if (isBase && old.href !== last.href) {
        history.replace(old.href);
        old.baseKey = history.location.state.__TSR_key ?? history.location.state.key;
      }
      if (!isBase) {
        // A multi-entry traversal left the screen. Never rebase an unrelated destination
        // or resurrect this route's owners there.
        layers.forEach((owner) => {
          owner.open = false;
        });
        if (old) old.retired = true;
      } else if (layer && !programmatic && !old.retired) {
        if (layer.dismissible === false) {
          moving = true;
          history.forward({ ignoreBlocker: true });
          return;
        }
        layer.change(false);
      }
      schedule();
      if (released.length && previous.state.tempoOverlay)
        frames.delete(previous.state.tempoOverlay);
      released.splice(0).forEach((resolve) => resolve());
    } else if (!marker && last.href !== previous.href) {
      // A real screen navigation owns its destination. Never resurrect an old route's UI there.
      layers.forEach((layer) => {
        layer.open = false;
      });
      const previousFrame = frames.get(previous.state.tempoOverlay ?? "");
      if (previousFrame) previousFrame.retired = true;
    }
  });
  return {
    update(layer: BackLayer) {
      layers.set(layer.id, layer);
      schedule();
    },
    remove(id: string) {
      layers.delete(id);
      schedule();
    },
    dismiss,
    destroy() {
      disposed = true;
      removeHandler();
      unsubscribe();
      layers.clear();
      frames.clear();
      if (history.replace === replaceWithFrame) history.replace = replace;
      released.splice(0).forEach((resolve) => resolve());
    },
  };
}

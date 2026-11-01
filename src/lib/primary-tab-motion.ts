/** Only real primary-page switches participate; nested routes and the Log sheet do not. */
export function isPrimaryTabChange(from: string, to: string, primaryPaths: ReadonlySet<string>) {
  const previous = from.replace(/\/$/, "");
  const next = to.replace(/\/$/, "");
  return previous !== next && primaryPaths.has(previous) && primaryPaths.has(next);
}

export function primaryTabDirection(from: string, to: string, primaryPaths: ReadonlySet<string>) {
  const order = [...primaryPaths];
  return order.indexOf(to.replace(/\/$/, "")) > order.indexOf(from.replace(/\/$/, "")) ? 1 : -1;
}

export type PrimaryTabSnapshot = { layer: HTMLDivElement; visual: HTMLElement };
let snapshotId = 0;

/** Capture before React's DOM mutation. This detached DOM copy has no React tree/listeners. */
export function capturePrimaryTabSnapshot(element: HTMLElement | null): PrimaryTabSnapshot | null {
  if (
    !element ||
    typeof window === "undefined" ||
    typeof element.animate !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    return null;
  const rect = element.getBoundingClientRect();
  const top = Math.max(0, rect.top);
  const height = Math.min(window.innerHeight, rect.bottom) - top;
  if (rect.width <= 0 || height <= 0) return null;
  const layer = element.ownerDocument.createElement("div");
  layer.className = "tempo-tab-snapshot";
  layer.setAttribute("aria-hidden", "true");
  layer.setAttribute("inert", "");
  layer.inert = true;
  Object.assign(layer.style, {
    left: `${rect.left}px`,
    top: `${top}px`,
    width: `${rect.width}px`,
    height: `${height}px`,
  });
  const visual = element.cloneNode(true) as HTMLElement;
  visual.classList.remove("tempo-tab-live");
  visual.classList.add("tempo-tab-snapshot-visual");
  Object.assign(visual.style, {
    margin: "0",
    width: `${rect.width}px`,
    position: "absolute",
    top: `${rect.top - top}px`,
  });
  // Never replay embedded documents/media, resource hints, scripts or autofocus in a visual copy.
  visual
    .querySelectorAll("script,iframe,object,embed,audio,video,link")
    .forEach((node) => node.remove());
  const originals = element.querySelectorAll("canvas");
  visual.querySelectorAll("canvas").forEach((canvas, index) => {
    const source = originals[index];
    if (source && source.width > 0 && source.height > 0)
      canvas.getContext("2d")?.drawImage(source, 0, 0);
  });
  // Keep SVG gradients/clips working without duplicate document IDs or form associations.
  const prefix = `tempo-tab-snapshot-${++snapshotId}-`;
  const ids = new Map<string, string>();
  for (const node of [visual, ...visual.querySelectorAll<HTMLElement>("[id]")]) {
    if (node.id) {
      ids.set(node.id, prefix + node.id);
      node.id = prefix + node.id;
    }
  }
  for (const node of [visual, ...visual.querySelectorAll("*")]) {
    for (const attribute of [...node.attributes]) {
      if (/^on/i.test(attribute.name) || ["autofocus", "name", "form"].includes(attribute.name)) {
        node.removeAttribute(attribute.name);
        continue;
      }
      const value = attribute.value.replace(/url\(["']?#([^"')]+)["']?\)/g, (original, id) =>
        ids.has(id) ? `url(#${ids.get(id)})` : original,
      );
      if ((attribute.name === "href" || attribute.name === "xlink:href") && value.startsWith("#")) {
        node.setAttribute(attribute.name, `#${ids.get(value.slice(1)) ?? value.slice(1)}`);
      } else if (/^(aria-labelledby|aria-describedby|aria-controls|for)$/.test(attribute.name)) {
        node.setAttribute(
          attribute.name,
          value
            .split(" ")
            .map((id) => ids.get(id) ?? id)
            .join(" "),
        );
      } else if (value !== attribute.value) node.setAttribute(attribute.name, value);
    }
  }
  visual
    .querySelectorAll<HTMLElement>(
      "a,button,input,select,textarea,summary,[tabindex],[contenteditable]",
    )
    .forEach((node) => {
      node.tabIndex = -1;
      node.removeAttribute("contenteditable");
    });
  layer.append(visual);
  return { layer, visual };
}

/** One live outlet plus a short-lived, inert outgoing visual. Navigation is never awaited. */
export function animatePrimaryTabChange(
  element: HTMLElement | null,
  from: string,
  to: string,
  primaryPaths: ReadonlySet<string>,
  snapshot: PrimaryTabSnapshot | null,
) {
  if (
    !element ||
    !snapshot ||
    !isPrimaryTabChange(from, to, primaryPaths) ||
    typeof window === "undefined" ||
    typeof element.animate !== "function"
  ) {
    snapshot?.layer.remove();
    return;
  }
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reducedMotion.matches) {
    snapshot.layer.remove();
    return;
  }
  const direction = primaryTabDirection(from, to, primaryPaths);
  const timing = { duration: 180, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" };
  element.ownerDocument.body.append(snapshot.layer);
  const incoming = element.animate(
    [
      { opacity: 0.88, transform: `translateX(${direction * 6}px)` },
      { opacity: 1, transform: "translateX(0)" },
    ],
    timing,
  );
  const outgoing = snapshot.visual.animate(
    [
      { opacity: 1, transform: "translateX(0)" },
      { opacity: 0.88, transform: `translateX(${-direction * 4}px)` },
    ],
    timing,
  );
  // Dissolve the visual layer too: removing an opaque 0.88 layer at the end would snap again.
  const dissolve = snapshot.layer.animate([{ opacity: 1 }, { opacity: 0 }], timing);
  let running: { layer: HTMLDivElement; animations: Animation[] } | null = {
    layer: snapshot.layer,
    animations: [incoming, outgoing, dissolve],
  };
  const cleanup = () => {
    const current = running;
    if (!current) return;
    // Release the copied DOM/animation targets even if the component keeps this teardown.
    running = null;
    reducedMotion.removeEventListener("change", onMotionChange);
    current.animations[2]!.onfinish = null;
    current.layer.remove();
    current.animations.forEach((animation) => animation.cancel());
  };
  const onMotionChange = () => {
    if (reducedMotion.matches) cleanup();
  };
  reducedMotion.addEventListener("change", onMotionChange);
  dissolve.onfinish = cleanup;
  return cleanup;
}

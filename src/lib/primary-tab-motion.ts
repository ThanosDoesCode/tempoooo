/** Only real primary-page switches participate; nested routes and the Log sheet do not. */
export function isPrimaryTabChange(from: string, to: string, primaryPaths: ReadonlySet<string>) {
  const previous = from.replace(/\/$/, "");
  const next = to.replace(/\/$/, "");
  return previous !== next && primaryPaths.has(previous) && primaryPaths.has(next);
}

/** Animate the existing outlet element, never a retained copy or a keyed remount. */
export function animatePrimaryTabChange(
  element: HTMLElement | null,
  from: string,
  to: string,
  primaryPaths: ReadonlySet<string>,
) {
  if (
    !element ||
    !isPrimaryTabChange(from, to, primaryPaths) ||
    typeof window === "undefined" ||
    typeof element.animate !== "function"
  )
    return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reducedMotion.matches) return;
  const animation = element.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: 160,
    easing: "ease-out",
  });
  const onMotionChange = () => {
    if (reducedMotion.matches) animation.cancel();
  };
  reducedMotion.addEventListener("change", onMotionChange);
  return () => {
    reducedMotion.removeEventListener("change", onMotionChange);
    animation.cancel();
  };
}

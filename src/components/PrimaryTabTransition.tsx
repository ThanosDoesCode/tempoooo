import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { animatePrimaryTabChange } from "@/lib/primary-tab-motion";

/** The shell stays mounted; only the newly rendered primary-page content fades in. */
export function PrimaryTabTransition({
  children,
  primaryPaths,
}: {
  children: ReactNode;
  primaryPaths: ReadonlySet<string>;
}) {
  // location changes at navigation start, before the outlet changes. Animate the committed
  // match instead, so a delayed loader cannot animate/remount the outgoing page.
  const pathname = useRouterState({
    select: (state) => state.matches.at(-1)?.pathname ?? state.location.pathname,
  });
  const element = useRef<HTMLDivElement>(null);
  const previous = useRef(pathname);
  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = pathname;
    return animatePrimaryTabChange(element.current, from, pathname, primaryPaths);
  }, [pathname, primaryPaths]);
  return (
    <div
      ref={element}
      className="tempo-route-content"
      data-primary-page={primaryPaths.has(pathname.replace(/\/$/, "")) || undefined}
    >
      {children}
    </div>
  );
}

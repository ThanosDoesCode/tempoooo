import { Component, createRef, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import {
  animatePrimaryTabChange,
  capturePrimaryTabSnapshot,
  isPrimaryTabChange,
  type PrimaryTabSnapshot,
} from "@/lib/primary-tab-motion";

type SurfaceProps = { children: ReactNode; primaryPaths: ReadonlySet<string>; pathname: string };

/** Snapshot lifecycle runs BEFORE descendant DOM changes, including router outlet replacement. */
class TabTransitionSurface extends Component<SurfaceProps> {
  private element = createRef<HTMLDivElement>();
  private cleanup: (() => void) | undefined;

  override getSnapshotBeforeUpdate(previous: SurfaceProps) {
    if (previous.pathname === this.props.pathname) return null;
    this.cleanup?.();
    this.cleanup = undefined;
    return isPrimaryTabChange(previous.pathname, this.props.pathname, this.props.primaryPaths)
      ? capturePrimaryTabSnapshot(this.element.current)
      : null;
  }

  override componentDidUpdate(
    previous: SurfaceProps,
    _state: unknown,
    snapshot: PrimaryTabSnapshot | null,
  ) {
    if (previous.pathname === this.props.pathname) return;
    this.cleanup = animatePrimaryTabChange(
      this.element.current,
      previous.pathname,
      this.props.pathname,
      this.props.primaryPaths,
      snapshot,
    );
  }

  override componentWillUnmount() {
    this.cleanup?.();
  }

  override render() {
    return (
      <div
        className="tempo-route-content"
        data-primary-page={
          this.props.primaryPaths.has(this.props.pathname.replace(/\/$/, "")) || undefined
        }
      >
        <div ref={this.element} className="tempo-tab-live">
          {this.props.children}
        </div>
      </div>
    );
  }
}

/** Exactly one live outlet, driven by rendered matches rather than a pending destination URL. */
export function PrimaryTabTransition({ children, primaryPaths }: Omit<SurfaceProps, "pathname">) {
  const pathname = useRouterState({
    select: (state) => state.matches.at(-1)?.pathname ?? state.location.pathname,
  });
  return (
    <TabTransitionSurface pathname={pathname} primaryPaths={primaryPaths}>
      {children}
    </TabTransitionSurface>
  );
}

import { useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const ROW_HEIGHT = 44;
const VISIBLE_ROWS = 5;

/** A bounded, single-focus-stop wheel; the parent picker owns the HH:mm draft. */
export function TimeWheel({
  value,
  max,
  onChange,
  ariaLabel,
}: {
  value: number;
  max: number;
  onChange: (value: number) => void;
  ariaLabel: string;
}) {
  const wheel = useRef<HTMLDivElement>(null);
  const centered = useRef(false);
  const selected = useRef(value);
  const frame = useRef<number | null>(null);
  const touching = useRef(false);
  const clamp = (next: number) => Math.max(0, Math.min(max, next));
  const cancelFrame = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };
  const update = (next: number) => {
    if (selected.current === next) return;
    selected.current = next;
    onChange(next);
  };
  const settle = () => {
    const element = wheel.current;
    if (!element || touching.current) return;
    cancelFrame();
    const next = clamp(Math.round(element.scrollTop / ROW_HEIGHT));
    update(next);
    // CSS does the native snapping; correct fractional positions on completion.
    if (Math.abs(element.scrollTop - next * ROW_HEIGHT) > 0.5)
      element.scrollTop = next * ROW_HEIGHT;
  };
  const watchForSettle = () => {
    const element = wheel.current;
    if (!element || frame.current !== null || Reflect.has(element, "onscrollend")) return;
    let lastTop = element.scrollTop;
    let stillSince: number | undefined;
    const check = (now: number) => {
      const current = wheel.current;
      if (!current) return;
      // Older browsers without scrollend: observe actual motion, including inertia,
      // rather than selecting after a fixed timeout from the last touch event.
      if (touching.current || Math.abs(current.scrollTop - lastTop) > 0.1) stillSince = now;
      else stillSince ??= now;
      lastTop = current.scrollTop;
      if (now - stillSince >= 120) {
        frame.current = null;
        settle();
      } else frame.current = requestAnimationFrame(check);
    };
    frame.current = requestAnimationFrame(check);
  };
  const select = (next: number) => {
    const element = wheel.current;
    if (!element) return;
    cancelFrame();
    update(clamp(next));
    element.scrollTop = clamp(next) * ROW_HEIGHT;
    element.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    const element = wheel.current;
    if (!element || (centered.current && selected.current === value)) return;
    // Only mount or an external value change repositions the wheel. Scroll-driven
    // draft renders must not interrupt the finger or native momentum scrolling.
    selected.current = value;
    element.scrollTop = value * ROW_HEIGHT;
    centered.current = true;
  }, [value]);
  useEffect(() => () => cancelFrame(), []);

  return (
    <div className="min-w-0">
      <div className="mb-2 text-center text-xs font-medium text-muted-foreground">{ariaLabel}</div>
      <div className="relative isolate overflow-hidden rounded-xl bg-background/50">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-1 top-1/2 -z-10 h-11 -translate-y-1/2 rounded-xl border border-primary/20 bg-primary/[0.07]"
        />
        <div
          ref={wheel}
          role="spinbutton"
          tabIndex={0}
          aria-label={ariaLabel}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={String(value).padStart(2, "0")}
          className="relative w-full snap-y snap-mandatory touch-pan-y overflow-y-auto overscroll-y-contain rounded-xl outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-scrollbar]:hidden"
          style={{
            height: ROW_HEIGHT * VISIBLE_ROWS,
            paddingBlock: (ROW_HEIGHT * (VISIBLE_ROWS - 1)) / 2,
            maskImage: "linear-gradient(to bottom, transparent, black 25%, black 75%, transparent)",
          }}
          onScroll={(event) => {
            update(clamp(Math.round(event.currentTarget.scrollTop / ROW_HEIGHT)));
            watchForSettle();
          }}
          onScrollEnd={settle}
          onTouchStart={() => {
            touching.current = true;
          }}
          onTouchEnd={() => {
            touching.current = false;
            watchForSettle();
          }}
          onTouchCancel={() => {
            touching.current = false;
            watchForSettle();
          }}
          onClick={(event) => {
            const option = (event.target as HTMLElement).closest<HTMLElement>(
              "[data-time-wheel-value]",
            );
            if (option && event.currentTarget.contains(option))
              select(Number(option.dataset["timeWheelValue"]));
          }}
          onKeyDown={(event) => {
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? max
                  : event.key === "ArrowUp"
                    ? selected.current - 1
                    : event.key === "ArrowDown"
                      ? selected.current + 1
                      : undefined;
            if (next === undefined) return;
            event.preventDefault();
            select(next);
          }}
        >
          {Array.from({ length: max + 1 }, (_, number) => (
            <div
              key={number}
              aria-hidden="true"
              data-time-wheel-value={number}
              className={cn(
                "flex h-11 snap-center cursor-pointer items-center justify-center text-2xl tabular-nums",
                value === number
                  ? "font-semibold text-foreground"
                  : Math.abs(value - number) === 1
                    ? "text-muted-foreground/80"
                    : "text-muted-foreground/40",
              )}
            >
              {String(number).padStart(2, "0")}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

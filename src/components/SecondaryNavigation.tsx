import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { secondaryNavigationSlot } from "@/lib/secondary-navigation";

export type SecondaryNavigationItem = {
  to: string;
  label: string;
  exact: boolean;
  activePrefixes?: readonly string[];
};

export function SecondaryNavigation({
  label,
  items,
  pathname,
  onIntent,
}: {
  label: string;
  items: readonly SecondaryNavigationItem[];
  pathname: string;
  onIntent?: (to: string) => void;
}) {
  const root = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [selectionPending, setSelectionPending] = useState(false);
  const activeIndex = Math.max(
    0,
    items.findIndex(
      (item) =>
        (item.exact ? pathname === item.to : pathname.startsWith(item.to)) ||
        item.activePrefixes?.some((prefix) => pathname.startsWith(prefix)),
    ),
  );

  useEffect(() => {
    if (!selectionPending) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(
      () => {
        setExpanded(false);
        setSelectionPending(false);
      },
      reduced ? 0 : 170,
    );
    return () => window.clearTimeout(timer);
  }, [pathname, selectionPending]);

  useEffect(() => {
    if (!expanded) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setExpanded(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [expanded]);

  return (
    <nav ref={root} aria-label={label} className="mb-4 h-12 overflow-hidden">
      <div className="relative mx-auto h-12 w-full max-w-[22rem] rounded-xl bg-card">
        {items.map((item, index) => {
          const active = index === activeIndex;
          const slot = secondaryNavigationSlot(index, activeIndex, items.length);
          return (
            <Link
              key={item.to}
              to={item.to}
              preload="intent"
              aria-current={active ? "page" : undefined}
              aria-expanded={active ? expanded : undefined}
              onPointerDown={() => onIntent?.(item.to)}
              onPointerEnter={() => onIntent?.(item.to)}
              onFocus={() => onIntent?.(item.to)}
              onClick={(event) => {
                if (active) {
                  event.preventDefault();
                  setExpanded((current) => !current);
                  setSelectionPending(false);
                } else if (expanded) {
                  setSelectionPending(true);
                }
              }}
              style={{ transform: `translateX(calc(-50% + ${expanded ? slot * 76 : 0}px))` }}
              className={cn(
                "absolute left-1/2 top-0 flex h-12 w-[4.5rem] items-center justify-center gap-1 rounded-lg px-1 text-xs font-semibold whitespace-nowrap transition-[transform,opacity,color,background-color] duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none",
                active ? "z-10 bg-elevated text-primary" : "text-muted-foreground",
                expanded || active ? "opacity-100" : "pointer-events-none opacity-0",
              )}
            >
              <span className="truncate">{item.label}</span>
              {active ? (
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none",
                    expanded && "rotate-180",
                  )}
                  aria-hidden="true"
                />
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

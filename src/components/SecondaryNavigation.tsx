import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

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
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const [expanded, setExpanded] = useState(false);
  const activeIndex = Math.max(
    0,
    items.findIndex(
      (item) =>
        (item.exact ? pathname === item.to : pathname.startsWith(item.to)) ||
        item.activePrefixes?.some((prefix) => pathname.startsWith(prefix)),
    ),
  );
  const activeItem = items[activeIndex]!;

  useEffect(() => {
    setExpanded(false);
  }, [pathname]);

  useEffect(() => {
    if (!expanded) return;
    const closeFromOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setExpanded(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setExpanded(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [expanded]);

  return (
    <nav
      ref={root}
      aria-label={label}
      className="relative z-30 mb-4 flex h-11 justify-center"
      data-no-pull
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={expanded}
        aria-controls={menuId}
        aria-haspopup="menu"
        onClick={() => setExpanded((current) => !current)}
        className="inline-flex min-h-11 max-w-[calc(100vw-2rem)] items-center justify-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold text-primary shadow-sm transition-[background-color,transform,opacity] duration-150 ease-out active:scale-[0.98] active:bg-elevated active:opacity-80 motion-reduce:transition-none"
      >
        <span className="truncate">{activeItem.label}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 transition-transform duration-150 motion-reduce:transition-none",
            expanded && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>

      {expanded ? (
        <div
          id={menuId}
          role="menu"
          className="absolute left-1/2 top-[calc(100%+0.5rem)] grid max-h-[calc(100vh-10rem)] w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 grid-cols-2 gap-1 overflow-y-auto rounded-2xl border border-border bg-card p-2 shadow-xl motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-150"
        >
          {items.map((item, index) => {
            const active = index === activeIndex;
            return (
              <Link
                key={item.to}
                to={item.to}
                preload="intent"
                role="menuitem"
                aria-current={active ? "page" : undefined}
                onPointerDown={() => onIntent?.(item.to)}
                onPointerEnter={() => onIntent?.(item.to)}
                onFocus={() => onIntent?.(item.to)}
                onClick={() => setExpanded(false)}
                className={cn(
                  "flex min-h-11 min-w-0 items-center justify-center rounded-xl px-3 py-2 text-center text-sm font-semibold transition-[background-color,color,transform,opacity] duration-150 ease-out active:scale-[0.98] active:opacity-80 motion-reduce:transition-none",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-elevated hover:text-foreground",
                )}
              >
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </nav>
  );
}

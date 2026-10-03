import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

export type NavRow = { to: string; label: string; hint?: string };

/**
 * A card of labelled link rows. Replaces the removed top dropdown as the in-page way to reach
 * a tab's sub-screens (Challenge terms/history/money, Progress history/review, You settings).
 * Sentence-case grey labels, one card, 44px+ rows — the shared Phase 1 pattern.
 */
export function NavRows({ title, rows }: { title?: string; rows: readonly NavRow[] }) {
  return (
    <section className="rounded-[20px] bg-card">
      {title ? (
        <h2 className="px-4 pt-4 text-[13px] font-medium text-muted-foreground">{title}</h2>
      ) : null}
      <div className="px-4">
        {rows.map((row) => (
          <Link
            key={row.to}
            to={row.to}
            preload="intent"
            className="flex min-h-[56px] items-center gap-3 border-t border-border first:border-t-0 active:opacity-80"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium text-foreground">{row.label}</span>
              {row.hint ? (
                <span className="mt-0.5 block text-[13px] text-muted-foreground">{row.hint}</span>
              ) : null}
            </span>
            <ChevronRight className="h-5 w-5 flex-none text-muted-foreground" aria-hidden="true" />
          </Link>
        ))}
      </div>
      {title ? <div className="pb-2" /> : null}
    </section>
  );
}

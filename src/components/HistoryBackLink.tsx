import { defaultParseSearch, Link, useRouter, useRouterState } from "@tanstack/react-router";
import { BackLabel, backControlClassName } from "./BackControl";
import { backWithinApp, inAppBackLabel, inAppBackLocation } from "@/lib/in-app-back";
import { cn } from "@/lib/utils";

export function HistoryBackLink({
  fallback,
  fallbackLabel = "Back",
  originLabels,
  fallbackParams,
  fallbackSearch,
  parentPath,
  iconOnly = false,
}: {
  fallback: string;
  fallbackLabel?: string;
  originLabels?: Readonly<Record<string, string>>;
  fallbackParams?: Record<string, string>;
  fallbackSearch?: Record<string, unknown>;
  /** A detail sharing its parent's pathname must return to that list, not skip it. */
  parentPath?: string;
  /** Compact headers retain the same contextual destination with an icon-only presentation. */
  iconOnly?: boolean;
}) {
  const router = useRouter();
  useRouterState({ select: (state) => state.location.href });
  const location = inAppBackLocation(router.history, parentPath);
  const previous = location?.pathname;
  const label = previous
    ? (originLabels?.[previous] ?? inAppBackLabel(previous) ?? "Back")
    : fallbackLabel;
  return (
    <Link
      to={previous ?? fallback}
      {...(!previous && fallbackParams ? { params: fallbackParams } : {})}
      search={
        location
          ? (router.options?.parseSearch ?? defaultParseSearch)(location.search)
          : (fallbackSearch ?? {})
      }
      hash={location?.hash.replace(/^#/, "") ?? ""}
      preload="intent"
      aria-label={iconOnly ? `Back to ${label}` : undefined}
      className={cn(backControlClassName, iconOnly ? "mb-0 h-11 w-11 justify-center pr-0" : "mb-2")}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        if (backWithinApp(router.history, parentPath)) event.preventDefault();
      }}
    >
      <BackLabel>{iconOnly ? <span className="sr-only">{label}</span> : label}</BackLabel>
    </Link>
  );
}

/** Initial data placeholders only; cached content stays visible during revalidation. */
export function PageSkeleton({ label = "Loading page" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-4 motion-safe:animate-pulse">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="space-y-4">
        <div className="h-7 w-40 rounded-lg bg-card" />
        <div className="grid grid-cols-2 gap-3">
          <div className="h-24 rounded-2xl bg-card" />
          <div className="h-24 rounded-2xl bg-card" />
        </div>
        <div className="h-36 rounded-2xl bg-card" />
        <div className="h-20 rounded-2xl bg-card" />
      </div>
    </div>
  );
}

export function ActivityFeedSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading recent activity"
      className="space-y-2 motion-safe:animate-pulse"
    >
      <span className="sr-only">Loading recent activity</span>
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} aria-hidden="true" className="flex h-20 gap-3 rounded-2xl bg-card p-3">
          <div className="h-8 w-8 shrink-0 rounded-full bg-elevated" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-2/3 rounded bg-elevated" />
            <div className="h-3 w-1/2 rounded bg-elevated" />
          </div>
        </div>
      ))}
    </div>
  );
}

import type { Activity } from "./challenge";

export const ACTIVITY_PAGE_SIZE = 20;
export const ACTIVITY_FIELDS =
  "id,challenge_id,user_id,activity_type,distance_km,equivalent_km,qualifying_equivalent_km,is_qualified,average_speed_kmh,average_pace_seconds_per_km,activity_date,duration_seconds,evidence_path,extra_evidence_paths,external_activity_url,note,edited,created_at,updated_at";
export type ActivityCursor = Pick<Activity, "activity_date" | "created_at" | "id">;
export type ActivityPage = { rows: Activity[]; next: ActivityCursor | null };
export type ActivityDateRange = { start: string; end: string };

export function activityCursorFilter(cursor: ActivityCursor) {
  // Values come from a database row; reject malformed filter input defensively.
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(cursor.activity_date) ||
    !/^\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.created_at) ||
    !/^[0-9a-f-]{36}$/i.test(cursor.id)
  )
    throw new Error("Invalid activity cursor");
  const { activity_date: day, created_at: created, id } = cursor;
  return `activity_date.lt.${day},and(activity_date.eq.${day},created_at.lt.${created}),and(activity_date.eq.${day},created_at.eq.${created},id.gt.${id})`;
}

export function activityPage(rows: Activity[], pageSize = ACTIVITY_PAGE_SIZE): ActivityPage {
  const page = rows.slice(0, pageSize);
  const last = page.at(-1);
  return {
    rows: page,
    next:
      rows.length > pageSize && last
        ? { activity_date: last.activity_date, created_at: last.created_at, id: last.id }
        : null,
  };
}

export function uniqueActivityPages(pages: ActivityPage[]): Activity[] {
  const seen = new Set<string>();
  return pages.flatMap((page) =>
    page.rows.filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    }),
  );
}

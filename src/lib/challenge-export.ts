import {
  activityMetrics,
  formatPace,
  qualifiedEquivalentKm,
  summarizeActivities,
  weekNumberOf,
  type Activity,
  type Challenge,
  type TravelPause,
  type WeekRow,
} from "./challenge";

type Member = { userId: string; name: string };

const columns = [
  "record_type",
  "player",
  "week",
  "activity_date",
  "activity_type",
  "distance_km",
  "duration_seconds",
  "average_speed_kmh",
  "average_pace",
  "qualified",
  "challenge_km",
  "weekly_target_km",
  "penalty_mode",
  "penalty_high_eur",
  "penalty_medium_eur",
  "penalty_low_eur",
  "penalty_high_custom",
  "penalty_medium_custom",
  "penalty_low_custom",
  "legacy_photo_owed",
  "applied_penalty_band",
  "applied_penalty_consequence",
  "penalty_eur",
  "travel_paused",
  "travel_country",
  "activity_id",
] as const;

type ExportRow = Record<(typeof columns)[number], string | number | boolean | null>;

function csvCell(value: ExportRow[(typeof columns)[number]]) {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function challengeCsv(
  challenge: Challenge,
  members: Member[],
  activities: Activity[],
  weeks: WeekRow[],
  pauses: TravelPause[],
) {
  const name = (userId: string) =>
    members.find((member) => member.userId === userId)?.name ?? userId;
  const rows: ExportRow[] = [];

  for (const member of members) {
    const stats = summarizeActivities(activities, member.userId);
    rows.push({
      record_type: "player_summary",
      player: member.name,
      week: "",
      activity_date: "",
      activity_type: "all",
      distance_km: Number(stats.totalKm.toFixed(2)),
      duration_seconds: "",
      average_speed_kmh:
        stats.averageSpeedKmh === null ? "" : Number(stats.averageSpeedKmh.toFixed(2)),
      average_pace: formatPace(stats.runningPaceSecondsPerKm),
      qualified: `${stats.qualifiedActivities}/${stats.activities} activities`,
      challenge_km: Number(stats.challengeKm.toFixed(2)),
      weekly_target_km: Number(challenge.weekly_target_km),
      penalty_mode: challenge.penalty_mode,
      penalty_high_eur: Number(challenge.penalty_high_eur),
      penalty_medium_eur: Number(challenge.penalty_medium_eur),
      penalty_low_eur: Number(challenge.penalty_low_eur),
      penalty_high_custom: challenge.penalty_high_custom,
      penalty_medium_custom: challenge.penalty_medium_custom,
      penalty_low_custom: challenge.penalty_low_custom,
      legacy_photo_owed: challenge.legacy_photo_owed,
      applied_penalty_band: "",
      applied_penalty_consequence: "",
      penalty_eur: "",
      travel_paused: pauses.filter((pause) => pause.user_id === member.userId).length,
      travel_country: "",
      activity_id: "",
    });
  }

  for (const activity of activities) {
    const metrics = activityMetrics(activity);
    rows.push({
      record_type: "activity",
      player: name(activity.user_id),
      week: weekNumberOf(challenge, activity.activity_date),
      activity_date: activity.activity_date,
      activity_type: activity.activity_type,
      distance_km: Number(activity.distance_km),
      duration_seconds: activity.duration_seconds,
      average_speed_kmh:
        metrics.averageSpeed === null ? "" : Number(metrics.averageSpeed.toFixed(2)),
      average_pace: formatPace(metrics.averagePace),
      qualified: metrics.qualified,
      challenge_km: Number(qualifiedEquivalentKm(activity).toFixed(4)),
      weekly_target_km: Number(challenge.weekly_target_km),
      penalty_mode: challenge.penalty_mode,
      penalty_high_eur: Number(challenge.penalty_high_eur),
      penalty_medium_eur: Number(challenge.penalty_medium_eur),
      penalty_low_eur: Number(challenge.penalty_low_eur),
      penalty_high_custom: challenge.penalty_high_custom,
      penalty_medium_custom: challenge.penalty_medium_custom,
      penalty_low_custom: challenge.penalty_low_custom,
      legacy_photo_owed: challenge.legacy_photo_owed,
      applied_penalty_band: "",
      applied_penalty_consequence: "",
      penalty_eur: "",
      travel_paused: pauses.some(
        (pause) =>
          pause.user_id === activity.user_id &&
          pause.week_number === weekNumberOf(challenge, activity.activity_date),
      ),
      travel_country: "",
      activity_id: activity.id,
    });
  }

  for (const week of weeks) {
    rows.push({
      record_type: "finalized_week",
      player: name(week.user_id),
      week: week.week_number,
      activity_date: `${week.week_start} to ${week.week_end}`,
      activity_type: "week_total",
      distance_km: Number(week.running_km) + Number(week.cycling_km),
      duration_seconds: "",
      average_speed_kmh: "",
      average_pace: "",
      qualified: week.completed,
      challenge_km: Number(week.equivalent_km),
      weekly_target_km: Number(week.target_km),
      penalty_mode: week.penalty_mode ?? challenge.penalty_mode,
      penalty_high_eur: Number(challenge.penalty_high_eur),
      penalty_medium_eur: Number(challenge.penalty_medium_eur),
      penalty_low_eur: Number(challenge.penalty_low_eur),
      penalty_high_custom: challenge.penalty_high_custom,
      penalty_medium_custom: challenge.penalty_medium_custom,
      penalty_low_custom: challenge.penalty_low_custom,
      legacy_photo_owed: challenge.legacy_photo_owed,
      applied_penalty_band: week.penalty_band,
      applied_penalty_consequence: week.penalty_consequence,
      penalty_eur: Number(week.penalty_eur),
      travel_paused: week.paused,
      travel_country: week.pause_country,
      activity_id: "",
    });
  }

  for (const pause of pauses) {
    rows.push({
      record_type: "travel_pause",
      player: name(pause.user_id),
      week: pause.week_number,
      activity_date: "",
      activity_type: "",
      distance_km: "",
      duration_seconds: "",
      average_speed_kmh: "",
      average_pace: "",
      qualified: "",
      challenge_km: "",
      weekly_target_km: 0,
      penalty_mode: challenge.penalty_mode,
      penalty_high_eur: Number(challenge.penalty_high_eur),
      penalty_medium_eur: Number(challenge.penalty_medium_eur),
      penalty_low_eur: Number(challenge.penalty_low_eur),
      penalty_high_custom: challenge.penalty_high_custom,
      penalty_medium_custom: challenge.penalty_medium_custom,
      penalty_low_custom: challenge.penalty_low_custom,
      legacy_photo_owed: challenge.legacy_photo_owed,
      applied_penalty_band: "",
      applied_penalty_consequence: "",
      penalty_eur: 0,
      travel_paused: true,
      travel_country: pause.country,
      activity_id: "",
    });
  }

  return [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\n");
}

export function downloadChallengeCsv(
  challenge: Challenge,
  members: Member[],
  activities: Activity[],
  weeks: WeekRow[],
  pauses: TravelPause[],
) {
  const blob = new Blob([challengeCsv(challenge, members, activities, weeks, pauses)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${challenge.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "challenge"}-52-week-data.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

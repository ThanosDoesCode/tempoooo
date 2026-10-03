import { useRef, useState } from "react";
import { Download } from "lucide-react";
import { Card, SectionTitle } from "@/components/ui-kit";
import { userFacingError } from "@/lib/network-errors";
import { downloadChallengeCsv } from "@/lib/challenge-export";
import {
  fetchActivitiesForExport,
  useChallengeMembers,
  useMyChallenge,
  useTravelPauses,
  useWeekTargets,
  useWeeks,
} from "@/lib/challenge";

/**
 * "Download challenge data (CSV)" lives on You (moved off the Money screen). The full activity
 * history is only fetched when the user taps the button, never on mount.
 */
export function ChallengeDataExport() {
  const { data: challenge } = useMyChallenge();
  const { data: members } = useChallengeMembers(challenge?.id);
  const { data: weeks } = useWeeks(challenge?.id);
  const { data: travelPauses } = useTravelPauses(challenge?.id);
  const { data: weekTargets } = useWeekTargets(challenge?.id);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  if (!challenge) return null;

  const exportCsv = async () => {
    if (!members || inFlight.current) return;
    inFlight.current = true;
    setExporting(true);
    setError(null);
    try {
      const activities = await fetchActivitiesForExport(challenge.id);
      downloadChallengeCsv(
        challenge,
        members,
        activities,
        weeks ?? [],
        travelPauses ?? [],
        weekTargets ?? [],
      );
    } catch (cause) {
      setError(userFacingError(cause, "export challenge data"));
    } finally {
      inFlight.current = false;
      setExporting(false);
    }
  };

  return (
    <Card className="mt-3">
      <SectionTitle>Your data</SectionTitle>
      <p className="text-sm leading-6 text-muted-foreground">
        Every activity, stored pace and speed, qualifying distance, finalized penalties and travel
        pauses for both players.
      </p>
      <button
        type="button"
        disabled={exporting || !members}
        onClick={() => void exportCsv()}
        className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-semibold disabled:opacity-60"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        {exporting ? "Preparing challenge data…" : "Download challenge data (CSV)"}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error} Try the download again.
        </p>
      ) : null}
    </Card>
  );
}

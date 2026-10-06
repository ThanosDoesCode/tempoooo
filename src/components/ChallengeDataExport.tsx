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
      <button
        type="button"
        disabled={exporting || !members}
        onClick={() => void exportCsv()}
        className="flex min-h-11 w-full items-center gap-3 rounded-xl text-left text-[15px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        {exporting ? "Preparing challenge data…" : "Download challenge data (CSV)"}
      </button>
      <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
        Full activity history, weekly outcomes, payments and travel pauses for both players.
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-warn">
          {error} Try the download again.
        </p>
      ) : null}
    </Card>
  );
}

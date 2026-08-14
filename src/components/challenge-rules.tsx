import { Card, Note, SectionTitle } from "@/components/ui-kit";

export function RulesCard() {
  return (
    <Card>
      <SectionTitle>Rules</SectionTitle>
      <ul className="space-y-1 text-sm text-muted-foreground">
        <li>15 equivalent km every week</li>
        <li>1 km running = 1 equivalent km</li>
        <li>3 km cycling = 1 equivalent km</li>
        <li>Week runs Monday 00:00 to Sunday 23:59 in the challenge timezone</li>
        <li>No carry-over between weeks</li>
        <li>Minimum duration 52 weeks</li>
        <li>A Strava screenshot is required for every activity</li>
      </ul>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <Tier label="15.00 km or more" value="€0" />
        <Tier label="10.00 to 14.99 km" value="€5" />
        <Tier label="5.00 to 9.99 km" value="€10" />
        <Tier label="Below 5.00 km" value="€15" />
      </div>
      <Note>Once the challenge begins, the rules are locked and cannot be changed.</Note>
    </Card>
  );
}

function Tier({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-elevated px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="num font-semibold">{value}</span>
    </div>
  );
}

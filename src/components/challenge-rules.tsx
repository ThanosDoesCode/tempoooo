import { Card, Note, SectionTitle } from "@/components/ui-kit";

export function RulesCard() {
  return (
    <Card>
      <SectionTitle>Rules</SectionTitle>
      <ul className="space-y-1 text-sm text-muted-foreground">
        <li>15 equivalent km every week, unless a lower target is agreed for that week</li>
        <li>1 km running = 1 equivalent km</li>
        <li>3 km cycling = 1 equivalent km</li>
        <li>Week runs Monday 00:00 to Sunday 23:59 in the challenge timezone</li>
        <li>No carry-over between weeks</li>
        <li>Minimum duration 52 weeks</li>
        <li>A Strava screenshot is required for every activity</li>
        <li>Every €5 owed is also 1 photo owed</li>
      </ul>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <Tier label="Full target met" value="€0" />
        <Tier label="Two thirds of target" value="€5 + 1 photo" />
        <Tier label="One third of target" value="€10 + 2 photos" />
        <Tier label="Below one third" value="€15 + 3 photos" />
      </div>
      <Note>
        Tiers scale with the week's target. With the default 15 km that is 15, 10 and 5 km. The
        creator can lower or raise the target for future weeks only.
      </Note>
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

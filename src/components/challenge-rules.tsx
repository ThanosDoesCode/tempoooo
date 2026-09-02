import { Card, Note, SectionTitle } from "@/components/ui-kit";

export function ChallengePrimer() {
  return (
    <Card>
      <SectionTitle>How Tempo works</SectionTitle>
      <ol className="space-y-2 text-sm">
        <PrimerStep number="1" title="Reach 15 challenge km each week">
          Equivalent km are your converted progress: runs count 1:1 below 7:00 min/km, and rides
          count 3:1 from 18 km/h.
        </PrimerStep>
        <PrimerStep number="2" title="Add duration and evidence">
          Every activity needs its duration and a screenshot that verifies distance and pace or
          speed.
        </PrimerStep>
        <PrimerStep number="3" title="Sunday locks the result">
          Finishing below 15 creates a €5, €10, or €15 penalty. Extra km do not carry over.
        </PrimerStep>
        <PrimerStep number="4" title="Travelling can pause your week">
          Outside Greece or Sweden, you can pause your own full week so it is penalty-free.
        </PrimerStep>
      </ol>
      <details className="group mt-3 border-t border-border pt-1">
        <summary className="flex min-h-11 cursor-pointer list-none items-center text-xs font-semibold text-primary [&::-webkit-details-marker]:hidden">
          View all challenge rules
          <span className="ml-auto text-muted-foreground group-open:hidden">+</span>
          <span className="ml-auto hidden text-muted-foreground group-open:inline">−</span>
        </summary>
        <div className="space-y-4 pb-1 pt-2">
          <RulesContent />
        </div>
      </details>
    </Card>
  );
}

export function RulesCard() {
  return (
    <Card className="space-y-4">
      <SectionTitle>Challenge rules</SectionTitle>
      <RulesContent />
    </Card>
  );
}

function RulesContent() {
  return (
    <>
      <RuleGroup title="Weekly target">
        <li>Weekly target is 15 challenge km.</li>
        <li>Extra distance above 15 does not carry over.</li>
      </RuleGroup>

      <div className="grid gap-4 sm:grid-cols-2">
        <RuleGroup title="Running">
          <li>Running counts 1:1.</li>
          <li>1 km running = 1 challenge km.</li>
          <li>Average pace must be under 7:00 min/km.</li>
        </RuleGroup>
        <RuleGroup title="Cycling">
          <li>Cycling counts at 3:1.</li>
          <li>3 km cycling = 1 challenge km.</li>
          <li>Average speed must be at least 18 km/h.</li>
        </RuleGroup>
      </div>

      <RuleGroup title="Travel">
        <li>The challenge stays active in Greece and Sweden.</li>
        <li>
          When travelling elsewhere, each participant can continue normally or pause their own
          challenge week.
        </li>
        <li>A paused week is penalty-free for that participant only.</li>
      </RuleGroup>

      <RuleGroup title="Evidence">
        <li>Every activity needs a screenshot; a Strava link can be added as extra evidence.</li>
        <li>The evidence must verify distance and the relevant pace or cycling speed.</li>
      </RuleGroup>

      <RuleGroup title="Photo rule">
        <li>Every €5 owed is one penalty photo.</li>
        <li>
          Photos should become progressively more creative, funny, or unusual as they accumulate.
        </li>
      </RuleGroup>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <Tier label="15 km or more" value="€0 · 0 photos" />
        <Tier label="10 to 14.99 km" value="€5 · 1 photo" />
        <Tier label="5 to 9.99 km" value="€10 · 2 photos" />
        <Tier label="0 to 4.99 km" value="€15 · 3 photos" />
      </div>
      <Note>
        Weeks run Monday 00:00 to Sunday 23:59 in the challenge timezone. Finalized results stay
        locked.
      </Note>
    </>
  );
}

function PrimerStep({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">
        {number}
      </span>
      <span className="min-w-0">
        <span className="block font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
          {children}
        </span>
      </span>
    </li>
  );
}

function RuleGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">{title}</h3>
      <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm text-muted-foreground">{children}</ul>
    </section>
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

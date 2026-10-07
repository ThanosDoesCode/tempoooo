import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { presentationComponent } from "./presentation-component-fixture.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const { MainPageHeader } = presentationComponent("src/components/MainPageHeader.tsx", {
  "./NotificationBell": {
    NotificationBell: () =>
      React.createElement(
        "a",
        { href: "/notifications", "aria-label": "Notifications", className: "h-11 w-11" },
        "Bell",
      ),
  },
});
const { ChallengeParticipantHeading, ChallengeStatus } = presentationComponent(
  "src/components/ChallengeParticipant.tsx",
);
const html = (component, props) => renderToStaticMarkup(React.createElement(component, props));

test("all main headings use a compact first-row title/bell baseline without a metadata slot", () => {
  for (const title of ["Today", "Challenge", "Progress", "You"]) {
    const markup = html(MainPageHeader, {
      title,
    });
    assert.doesNotMatch(markup, /min-h-5|Thursday|text-muted-foreground/);
    assert.match(markup, /row-start-1[^>]*text-\[30px\][^>]*leading-9/);
    assert.equal((markup.match(/href="\/notifications"/g) ?? []).length, 1);
    assert.match(markup, /h-11 w-11/);
    assert.doesNotMatch(markup, /pt-6|pt-\[/);
  }
  for (const file of [
    "src/routes/_authenticated/bulk/index.tsx",
    "src/routes/_authenticated/challenge/index.tsx",
    "src/routes/_authenticated/profile.tsx",
    "src/components/ChallengeWaiting.tsx",
    "src/components/ProgressChrome.tsx",
  ])
    assert.match(read(file), /<MainPageHeader/);
  const shell = read("src/components/AppShell.tsx");
  assert.match(
    shell,
    /MAIN_TAB_PATHS = new Set\(\["\/bulk", "\/challenge", "\/bulk\/progress", "\/profile"\]\)/,
  );
  assert.match(shell, /MAIN_TAB_PATHS\.has\(pathname\.replace/);
  assert.match(shell, /pt-\[max\(1rem,env\(safe-area-inset-top\)\)\]/);
  assert.match(shell, /pt-\[max\(1.5rem,env\(safe-area-inset-top\)\)\]/);
  const wide = shell.slice(
    shell.indexOf("const widerDailyLayout"),
    shell.indexOf("const prefetchDestination"),
  );
  assert.doesNotMatch(wide, /pathname === "\/bulk"/);
  assert.match(wide, /bulk\/training/);
});

test("Progress header places the period control on a separate narrow-screen row without moving the bell", () => {
  const markup = html(MainPageHeader, {
    title: "Progress",
    children: React.createElement(
      "select",
      { "aria-label": "Period" },
      React.createElement("option", {}, "Last 3 months"),
    ),
  });
  assert.match(markup, /col-start-2 row-start-1 min-\[400px\]:col-start-3/);
  assert.match(markup, /row-start-2.*min-\[400px\]:row-start-1/);
  assert.equal((markup.match(/<select/g) ?? []).length, 1);
});

test("main-tab contextual information stays in content, never above the title or duplicated", () => {
  const today = read("src/routes/_authenticated/bulk/index.tsx");
  assert.match(today, /<MainPageHeader title="Today" \/>/);
  assert.doesNotMatch(today, /EEEE, d MMMM|eyebrow=/);
  const challenge = read("src/routes/_authenticated/challenge/index.tsx");
  assert.doesNotMatch(challenge, /eyebrow=/);
  assert.equal(
    (challenge.match(/Week \{week\?\.n\} of \{challenge\.duration_weeks\}/g) ?? []).length,
    1,
  );
  assert.ok(challenge.indexOf('title="This week"') < challenge.indexOf("Week {week?.n}"));
  assert.match(challenge, /label=\{opponent\?\.name \?\? "Opponent"\}/);
  assert.doesNotMatch(read("src/components/ChallengeWaiting.tsx"), /eyebrow=/);
});

test("participant rows preserve exact names and displayed km while sharing value hierarchy", () => {
  for (const [label, value, suffix] of [
    ["You", "6.5", "/ 15 km"],
    ["@averylongparticipantusername", "9.2", "km"],
  ]) {
    const markup = html(ChallengeParticipantHeading, { label, value, suffix });
    assert.ok(markup.includes(label));
    assert.ok(markup.includes(value));
    assert.ok(markup.includes(suffix));
    assert.match(markup, /items-baseline justify-between gap-3/);
    assert.match(markup, /min-w-0 break-words/);
    assert.match(markup, /shrink-0 whitespace-nowrap text-right/);
    assert.match(markup, /text-2xl font-semibold/);
    assert.doesNotMatch(markup, /52px|progressbar/);
  }
  const paused = html(ChallengeParticipantHeading, {
    label: "You",
    value: "6.5",
    suffix: "/ 15 km",
    status: "Paused",
  });
  assert.match(paused, /Paused/);
  assert.doesNotMatch(paused, /6.5|15 km/);
  assert.doesNotMatch(html(ChallengeParticipantHeading, { label: "Opponent" }), /0.0|km/);
});

test("risk copy stays intact with the softer scoped warning token; neutral state is not a warning", () => {
  const risk = html(ChallengeStatus, {
    atRisk: true,
    children: "At risk: €10 if the week ended now",
  });
  assert.match(risk, /At risk: €10 if the week ended now/);
  assert.match(risk, /border-warn-soft\/20 bg-warn-soft\/5 text-warn-soft/);
  assert.match(risk, /text-\[13px\] leading-relaxed/);
  const neutral = html(ChallengeStatus, { atRisk: false, children: "Week paused · no penalty" });
  assert.doesNotMatch(neutral, /warn-soft/);
  assert.match(neutral, /Week paused · no penalty/);
  const css = read("src/styles.css");
  assert.match(css, /--warn-soft: oklch\(0.8 0.065 82\)/);
  assert.match(css, /--warn: oklch\(0.82 0.14 82\)/); // Other warning controls keep their original treatment.
});

test("Today and main Challenge cards share padding and status presentation without changing bar inputs", () => {
  const today = read("src/components/TodayChallenge.tsx");
  const challenge = read("src/routes/_authenticated/challenge/index.tsx");
  for (const source of [today, challenge]) {
    assert.match(source, /space-y-3.5 p-5/);
    assert.match(source, /<ChallengeParticipantHeading/);
    assert.match(source, /<ChallengeStatus atRisk=\{penalty.atRisk\}>\{penalty.line\}/);
    assert.match(source, /border-t border-border pt-3.5/);
  }
  assert.match(today, /Math.min\(100, \(myKm \/ target\) \* 100\)/);
  assert.match(
    challenge,
    /const pct = target > 0 \? Math.min\(100, \(equivalent \/ target\) \* 100\) : 0/,
  );
  assert.match(challenge, /width: `\$\{paused \? 100 : pct\}%`/);
});

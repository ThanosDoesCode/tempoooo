import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { DAILY_BASE, MEAL_PLANS, mealPlan, mealPlanSnapshot } from "../src/lib/meals.ts";

const repairSql = await readFile(
  new URL("../supabase/scripts/repair_bulk_nutrition_presets_20260904.sql", import.meta.url),
  "utf8",
);
const salmonRepairSql = await readFile(
  new URL("../supabase/scripts/repair_bulk_salmon_preset_20260905.sql", import.meta.url),
  "utf8",
);

const plan = (id) => {
  const value = mealPlan(id);
  assert.ok(value);
  return value;
};

test("Bulk presets use the corrected canonical daily base, quantities and full-day totals", () => {
  assert.deepEqual(DAILY_BASE.meals, [
    {
      name: "Milkshake",
      quantities: [
        "100 g banana",
        "200 g Arla Köket Greek yoghurt 10%",
        "100 g ICA oats",
        "330 ml Arla 3% milk",
        "5 g creatine",
      ],
      macros: { calories: 900, protein: 31, carbs: 109, fat: 37 },
    },
    {
      name: "Grötbröd + cheese",
      quantities: ["2 slices Grötbröd", "40 g Prästost Mild 35%"],
      macros: { calories: 420, protein: 20, carbs: 41, fat: 19 },
    },
  ]);
  assert.deepEqual(DAILY_BASE.macros, { calories: 1320, protein: 51, carbs: 150, fat: 56 });

  assert.deepEqual(plan("beef").macros, {
    calories: 2900,
    protein: 141,
    carbs: 375,
    fat: 87,
  });
  assert.deepEqual(plan("beef").meals, [
    "Beef pasta ×2",
    "146 g dry ICA Spirali each",
    "1/6 finished beef sauce batch each",
  ]);

  const lentil = plan("lentil");
  assert.deepEqual(lentil.macros, { calories: 2800, protein: 123, carbs: 362, fat: 81 });
  assert.deepEqual(lentil.meals, [
    "Lentils + rice ×2",
    "62.5 g dry Ben’s Original rice each",
    "1/4 finished lentil batch each",
  ]);
  assert.doesNotMatch(JSON.stringify(lentil), /lentil pasta|146 g.*pasta|1\/6 lentil/i);

  assert.deepEqual(plan("kebab").macros, {
    calories: 2835,
    protein: 135,
    carbs: 343,
    fat: 95,
  });
  assert.deepEqual(plan("kebab").meals, [
    "Chicken kebab ×2",
    "150 g chicken kebab each",
    "62.5 g dry Ben’s Original rice each",
    "2 slices Grötbröd each",
    "10 g Heinz mayo each",
  ]);

  assert.deepEqual(plan("salmon").macros, {
    calories: 2850,
    protein: 120,
    carbs: 369,
    fat: 96,
  });
  assert.equal(plan("salmon").name, "SALMON DAY");
  assert.deepEqual(plan("salmon").meals, [
    "Salmon + rice ×2",
    "125 g raw salmon each",
    "125 g dry Ben’s Original rice each",
  ]);
  assert.deepEqual(plan("salmon").extras, ["Nature Valley Oats & Honey 42 g ×1"]);
  assert.equal(plan("salmon").mealsPerDay, 2);
  assert.match(plan("salmon").batchDescription.join(" | "), /250 g raw salmon/);
  assert.match(plan("salmon").batchDescription.join(" | "), /250 g dry Ben’s Original rice/);
  assert.doesNotMatch(JSON.stringify(plan("salmon")), /150 g dry|300 g dry/i);

  for (const preset of MEAL_PLANS.filter(({ id }) => id !== "custom")) {
    assert.equal(preset.mealsPerDay, 2);
    assert.ok(preset.mainMealDescription);
    assert.ok(preset.batchDescription.length);
    assert.deepEqual(mealPlanSnapshot(preset).macros, preset.macros);
  }
});

test("Bulk History treats saved preset macros as authoritative full-day totals", async () => {
  const history = await readFile(
    new URL("../src/routes/_authenticated/bulk/history.tsx", import.meta.url),
    "utf8",
  );
  assert.match(history, /Stored totals \(authoritative\)/);
  for (const key of ["calories", "protein", "carbs", "fat"]) {
    assert.match(history, new RegExp(`day\\?\\.${key}`));
  }
  assert.match(history, /day\?\.mealSnapshot \?\? configuredPlan/);
  assert.match(history, /nutrition\.extras/);
});

test("Today, logging and export consume the canonical Salmon snapshot", async () => {
  const [today, progress] = await Promise.all([
    readFile(new URL("../src/routes/_authenticated/bulk/index.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/_authenticated/bulk/progress.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(today, /mealPlan\(id\)/);
  assert.match(today, /mealPlanSnapshot\(plan\)/);
  assert.match(today, /mealSnapshot/);
  assert.match(today, /plan\.extras/);
  assert.match(progress, /JSON\.stringify\(data\)/);
  assert.doesNotMatch(today + progress, /150 g dry Ben|300 g dry Ben|Nature Valley Oats/);
});

test("the optional repair changes only positively identified untouched preset nutrition", async () => {
  assert.doesNotMatch(repairSql, /DELETE\s+FROM|bulk_photos|bulk_workouts|bulk_week_notes/i);
  assert.doesNotMatch(salmonRepairSql, /DELETE\s+FROM|bulk_photos|bulk_workouts|bulk_week_notes/i);
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE public.bulk_days (
        id uuid PRIMARY KEY,
        bulk_profile_id uuid NOT NULL,
        day date NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE FUNCTION public.touch_updated_at() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
      CREATE TRIGGER bulk_days_touch BEFORE UPDATE ON public.bulk_days
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
    `);

    const profile = "00000000-0000-4000-8000-000000000001";
    const originalTimestamp = "2026-01-02T03:04:05.000Z";
    const rows = [
      {
        id: "00000000-0000-4000-8000-000000000101",
        day: "2026-01-01",
        payload: {
          date: "2026-01-01",
          mealPlan: "beef",
          calories: 2900,
          protein: 132,
          carbs: 382,
          fat: 88,
          note: "Keep this note",
          weight: 61.5,
        },
      },
      {
        id: "00000000-0000-4000-8000-000000000102",
        day: "2026-01-02",
        payload: {
          date: "2026-01-02",
          mealPlan: "lentil",
          calories: 2880,
          protein: 126,
          carbs: 400,
          fat: 82,
          note: "Lentil note",
          mealSnapshot: {
            name: "Lentil day",
            base: ["Milkshake", "Grötbröd + cheese"],
            meals: ["Lentil pasta ×2", "146 g dry pasta each", "1/6 lentil sauce batch each"],
            macros: { calories: 2880, protein: 126, carbs: 400, fat: 82 },
          },
        },
      },
      {
        id: "00000000-0000-4000-8000-000000000103",
        day: "2026-01-03",
        payload: {
          date: "2026-01-03",
          mealPlan: "kebab",
          calories: 2920,
          protein: 140,
          carbs: 375,
          fat: 86,
        },
      },
      {
        id: "00000000-0000-4000-8000-000000000104",
        day: "2026-01-04",
        payload: {
          date: "2026-01-04",
          mealPlan: "salmon",
          calories: 2890,
          protein: 134,
          carbs: 360,
          fat: 90,
        },
      },
      {
        id: "00000000-0000-4000-8000-000000000105",
        day: "2026-01-05",
        payload: {
          date: "2026-01-05",
          mealPlan: "custom",
          calories: 2880,
          protein: 126,
          carbs: 400,
          fat: 82,
          note: "Custom is never repaired",
        },
      },
      {
        id: "00000000-0000-4000-8000-000000000106",
        day: "2026-01-06",
        payload: {
          date: "2026-01-06",
          mealPlan: "lentil",
          calories: 2880,
          protein: 126,
          carbs: 399,
          fat: 82,
          note: "Edited totals are ambiguous",
        },
      },
      {
        id: "00000000-0000-4000-8000-000000000107",
        day: "2026-01-07",
        payload: {
          date: "2026-01-07",
          mealPlan: "lentil",
          calories: 2880,
          protein: 126,
          carbs: 400,
          fat: 82,
          mealSnapshot: {
            name: "My lentil variation",
            base: [],
            meals: ["Manual recipe"],
            macros: { calories: 2880, protein: 126, carbs: 400, fat: 82 },
          },
        },
      },
      {
        id: "00000000-0000-4000-8000-000000000108",
        day: "2026-01-08",
        payload: {
          date: "2026-01-08",
          mealPlan: "salmon",
          calories: 2830,
          protein: 118,
          carbs: 380,
          fat: 89,
          note: "Manual salmon recipe",
          mealSnapshot: {
            name: "My salmon variation",
            base: [],
            meals: ["Manually entered salmon plate"],
            macros: { calories: 2830, protein: 118, carbs: 380, fat: 89 },
          },
        },
      },
      {
        id: "00000000-0000-4000-8000-000000000109",
        day: "2026-01-09",
        payload: {
          date: "2026-01-09",
          mealPlan: "custom",
          calories: 2830,
          protein: 118,
          carbs: 380,
          fat: 89,
          note: "Custom values happen to match",
        },
      },
      {
        id: "00000000-0000-4000-8000-000000000110",
        day: "2026-01-10",
        payload: {
          date: "2026-01-10",
          mealPlan: "salmon",
          calories: 2830,
          protein: 118,
          carbs: 379,
          fat: 89,
          note: "Edited salmon totals",
        },
      },
    ];
    for (const row of rows) {
      await db.query(
        `INSERT INTO public.bulk_days(
          id,bulk_profile_id,day,payload,created_at,updated_at
        ) VALUES ($1,$2,$3,$4,$5,$5)`,
        [row.id, profile, row.day, row.payload, originalTimestamp],
      );
    }

    const untouchedBefore = (
      await db.query(
        "SELECT id,bulk_profile_id,day,payload,created_at,updated_at FROM public.bulk_days ORDER BY day",
      )
    ).rows;
    await db.exec(repairSql);
    await db.exec(salmonRepairSql);
    const repaired = (
      await db.query(
        "SELECT id,bulk_profile_id,day,payload,created_at,updated_at FROM public.bulk_days ORDER BY day",
      )
    ).rows;

    const byDay = (day) => repaired.find((row) => row.payload.date === day);
    assert.deepEqual(
      ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"].map((day) => {
        const payload = byDay(day).payload;
        return [payload.calories, payload.protein, payload.carbs, payload.fat];
      }),
      [
        [2900, 141, 375, 87],
        [2800, 123, 362, 81],
        [2835, 135, 343, 95],
        [2850, 120, 369, 96],
      ],
    );
    assert.equal(byDay("2026-01-01").payload.note, "Keep this note");
    assert.equal(byDay("2026-01-01").payload.weight, 61.5);
    assert.equal("mealSnapshot" in byDay("2026-01-01").payload, false);
    assert.deepEqual(byDay("2026-01-02").payload.mealSnapshot, mealPlanSnapshot(plan("lentil")));
    assert.deepEqual(byDay("2026-01-04").payload.mealSnapshot, mealPlanSnapshot(plan("salmon")));

    for (const index of [4, 5, 6, 7, 8, 9]) {
      assert.deepEqual(repaired[index].payload, untouchedBefore[index].payload);
    }
    for (let index = 0; index < repaired.length; index += 1) {
      assert.equal(repaired[index].id, untouchedBefore[index].id);
      assert.equal(repaired[index].bulk_profile_id, untouchedBefore[index].bulk_profile_id);
      assert.equal(String(repaired[index].day), String(untouchedBefore[index].day));
      assert.equal(String(repaired[index].created_at), String(untouchedBefore[index].created_at));
      assert.equal(String(repaired[index].updated_at), String(untouchedBefore[index].updated_at));
    }

    await db.exec(repairSql);
    await db.exec(salmonRepairSql);
    assert.deepEqual(
      (
        await db.query(
          "SELECT id,bulk_profile_id,day,payload,created_at,updated_at FROM public.bulk_days ORDER BY day",
        )
      ).rows,
      repaired,
    );
  } finally {
    await db.close();
  }
});

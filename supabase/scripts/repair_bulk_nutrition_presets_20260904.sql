-- One-time, owner-operated repair. This file is intentionally outside migrations
-- and must not be run automatically during deployment.
--
-- A row is eligible only when its preset id and all four totals exactly match the
-- previous generated preset. Its snapshot must be absent/null (legacy) or exactly
-- equal to the previous generated snapshot. Custom and ambiguous/edited rows do
-- not match and remain untouched.
BEGIN;

-- Preserve the original row update timestamps along with ids, logged days and
-- every unrelated payload field. Trigger state changes roll back with the
-- transaction if any statement fails.
ALTER TABLE public.bulk_days DISABLE TRIGGER bulk_days_touch;

WITH repairs(plan_id, old_totals, new_totals, old_snapshot, new_snapshot) AS (
  VALUES
    (
      'beef',
      '{"calories":2900,"protein":132,"carbs":382,"fat":88}'::jsonb,
      '{"calories":2900,"protein":141,"carbs":375,"fat":87}'::jsonb,
      '{"name":"Beef day","base":["Milkshake","Grötbröd + cheese"],"meals":["Beef pasta ×2","146 g dry pasta each","1/6 cooked beef sauce batch each"],"macros":{"calories":2900,"protein":132,"carbs":382,"fat":88}}'::jsonb,
      '{"name":"Beef day","base":["Milkshake","Grötbröd + cheese"],"meals":["Beef pasta ×2","146 g dry ICA Spirali each","1/6 finished beef sauce batch each"],"macros":{"calories":2900,"protein":141,"carbs":375,"fat":87}}'::jsonb
    ),
    (
      'lentil',
      '{"calories":2880,"protein":126,"carbs":400,"fat":82}'::jsonb,
      '{"calories":2800,"protein":123,"carbs":362,"fat":81}'::jsonb,
      '{"name":"Lentil day","base":["Milkshake","Grötbröd + cheese"],"meals":["Lentil pasta ×2","146 g dry pasta each","1/6 lentil sauce batch each"],"macros":{"calories":2880,"protein":126,"carbs":400,"fat":82}}'::jsonb,
      '{"name":"Lentil day","base":["Milkshake","Grötbröd + cheese"],"meals":["Lentils + rice ×2","62.5 g dry Ben’s Original rice each","1/4 finished lentil batch each"],"macros":{"calories":2800,"protein":123,"carbs":362,"fat":81}}'::jsonb
    ),
    (
      'kebab',
      '{"calories":2920,"protein":140,"carbs":375,"fat":86}'::jsonb,
      '{"calories":2835,"protein":135,"carbs":343,"fat":95}'::jsonb,
      '{"name":"Chicken kebab day","base":["Milkshake","Grötbröd + cheese"],"meals":["Chicken kebab plate ×2","180 g dry rice each","1/6 kebab chicken batch each"],"macros":{"calories":2920,"protein":140,"carbs":375,"fat":86}}'::jsonb,
      '{"name":"Kebab day","base":["Milkshake","Grötbröd + cheese"],"meals":["Chicken kebab ×2","150 g chicken kebab each","62.5 g dry Ben’s Original rice each","2 slices Grötbröd each","10 g Heinz mayo each"],"macros":{"calories":2835,"protein":135,"carbs":343,"fat":95}}'::jsonb
    ),
    (
      'salmon',
      '{"calories":2890,"protein":134,"carbs":360,"fat":90}'::jsonb,
      '{"calories":2830,"protein":118,"carbs":380,"fat":89}'::jsonb,
      '{"name":"Salmon day","base":["Milkshake","Grötbröd + cheese"],"meals":["Salmon + potatoes ×2","400 g potatoes each","150 g salmon each"],"macros":{"calories":2890,"protein":134,"carbs":360,"fat":90}}'::jsonb,
      '{"name":"Salmon day","base":["Milkshake","Grötbröd + cheese"],"meals":["Salmon + rice ×2","125 g salmon each","150 g dry Ben’s Original rice each"],"macros":{"calories":2830,"protein":118,"carbs":380,"fat":89}}'::jsonb
    )
)
UPDATE public.bulk_days AS day
SET payload =
  day.payload
  || repair.new_totals
  || CASE
    WHEN day.payload ? 'mealSnapshot'
      AND day.payload->'mealSnapshot' <> 'null'::jsonb
    THEN jsonb_build_object('mealSnapshot', repair.new_snapshot)
    ELSE '{}'::jsonb
  END
FROM repairs AS repair
WHERE day.payload->>'mealPlan' = repair.plan_id
  AND day.payload @> repair.old_totals
  AND (
    NOT day.payload ? 'mealSnapshot'
    OR day.payload->'mealSnapshot' = 'null'::jsonb
    OR day.payload->'mealSnapshot' = repair.old_snapshot
  );

ALTER TABLE public.bulk_days ENABLE TRIGGER bulk_days_touch;

COMMIT;

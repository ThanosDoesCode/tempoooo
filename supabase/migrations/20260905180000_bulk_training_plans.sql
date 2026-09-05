-- Segment 4: immutable Tempo plan templates and isolated, user-owned plan copies.
-- Existing workout payloads are intentionally untouched.
CREATE TABLE public.bulk_training_plan_templates (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL,
  experience_level text NOT NULL CHECK (experience_level IN ('beginner','intermediate','advanced')),
  training_days_per_week integer NOT NULL CHECK (training_days_per_week BETWEEN 2 AND 6),
  required_equipment text[] NOT NULL DEFAULT '{}',
  split_summary text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bulk_training_plan_templates_id_ck CHECK (id = 'template:' || slug),
  CONSTRAINT bulk_training_plan_templates_name_ck CHECK (char_length(btrim(name)) BETWEEN 2 AND 80)
);

CREATE TABLE public.bulk_training_plan_template_days (
  id text PRIMARY KEY,
  template_id text NOT NULL REFERENCES public.bulk_training_plan_templates(id) ON DELETE CASCADE,
  day_order integer NOT NULL CHECK (day_order BETWEEN 1 AND 6),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  UNIQUE(template_id, day_order)
);

CREATE TABLE public.bulk_training_plan_template_exercises (
  id text PRIMARY KEY,
  template_day_id text NOT NULL REFERENCES public.bulk_training_plan_template_days(id) ON DELETE CASCADE,
  exercise_id text NOT NULL REFERENCES public.bulk_exercises(id) ON DELETE RESTRICT,
  exercise_order integer NOT NULL CHECK (exercise_order BETWEEN 1 AND 20),
  sets integer NOT NULL CHECK (sets BETWEEN 1 AND 10),
  rep_min integer NOT NULL CHECK (rep_min BETWEEN 1 AND 100),
  rep_max integer NOT NULL CHECK (rep_max BETWEEN 1 AND 100 AND rep_max >= rep_min),
  intended_unilateral_mode text NOT NULL DEFAULT 'bilateral' CHECK (intended_unilateral_mode IN ('bilateral','unilateral')),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 240),
  UNIQUE(template_day_id, exercise_order)
);

CREATE TABLE public.bulk_training_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_profile_id uuid NOT NULL REFERENCES public.bulk_profiles(id) ON DELETE CASCADE,
  source_template_id text REFERENCES public.bulk_training_plan_templates(id) ON DELETE SET NULL,
  plan_type text NOT NULL CHECK (plan_type IN ('generated','tempo_preset','custom')),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  experience_level text CHECK (experience_level IS NULL OR experience_level IN ('beginner','intermediate','advanced')),
  training_days_per_week integer NOT NULL CHECK (training_days_per_week BETWEEN 0 AND 6),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX bulk_training_plans_one_active_uidx
  ON public.bulk_training_plans(bulk_profile_id) WHERE active;
CREATE INDEX bulk_training_plans_profile_idx ON public.bulk_training_plans(bulk_profile_id, created_at DESC);

CREATE TABLE public.bulk_training_plan_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.bulk_training_plans(id) ON DELETE CASCADE,
  day_order integer NOT NULL CHECK (day_order BETWEEN 1 AND 6),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  UNIQUE(plan_id, day_order)
);

CREATE TABLE public.bulk_training_plan_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_day_id uuid NOT NULL REFERENCES public.bulk_training_plan_days(id) ON DELETE CASCADE,
  exercise_id text REFERENCES public.bulk_exercises(id) ON DELETE SET NULL,
  source_system_exercise_id text REFERENCES public.bulk_exercises(id) ON DELETE SET NULL,
  exercise_name text NOT NULL CHECK (char_length(btrim(exercise_name)) BETWEEN 2 AND 80),
  exercise_order integer NOT NULL CHECK (exercise_order BETWEEN 1 AND 20),
  sets integer NOT NULL CHECK (sets BETWEEN 1 AND 10),
  rep_min integer NOT NULL CHECK (rep_min BETWEEN 1 AND 100),
  rep_max integer NOT NULL CHECK (rep_max BETWEEN 1 AND 100 AND rep_max >= rep_min),
  intended_unilateral_mode text NOT NULL DEFAULT 'bilateral' CHECK (intended_unilateral_mode IN ('bilateral','unilateral')),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 240),
  UNIQUE(plan_day_id, exercise_order)
);
CREATE INDEX bulk_training_plan_days_plan_idx ON public.bulk_training_plan_days(plan_id, day_order);
CREATE INDEX bulk_training_plan_exercises_day_idx ON public.bulk_training_plan_exercises(plan_day_id, exercise_order);

CREATE TRIGGER bulk_training_plan_templates_touch BEFORE UPDATE ON public.bulk_training_plan_templates
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER bulk_training_plans_touch BEFORE UPDATE ON public.bulk_training_plans
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.bulk_training_plan_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulk_training_plan_template_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulk_training_plan_template_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulk_training_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulk_training_plan_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulk_training_plan_exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bulk plan templates read" ON public.bulk_training_plan_templates FOR SELECT TO authenticated
USING (active AND private.has_active_bulk());
CREATE POLICY "bulk plan template days read" ON public.bulk_training_plan_template_days FOR SELECT TO authenticated
USING (private.has_active_bulk() AND EXISTS (
  SELECT 1 FROM public.bulk_training_plan_templates t WHERE t.id = template_id AND t.active
));
CREATE POLICY "bulk plan template exercises read" ON public.bulk_training_plan_template_exercises FOR SELECT TO authenticated
USING (private.has_active_bulk() AND EXISTS (
  SELECT 1 FROM public.bulk_training_plan_template_days d
  JOIN public.bulk_training_plan_templates t ON t.id = d.template_id
  WHERE d.id = template_day_id AND t.active
));

CREATE POLICY "bulk training plans own" ON public.bulk_training_plans FOR ALL TO authenticated
USING (private.can_read_bulk(bulk_profile_id))
WITH CHECK (private.can_write_bulk(bulk_profile_id));
CREATE POLICY "bulk training plan days own" ON public.bulk_training_plan_days FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.bulk_training_plans p WHERE p.id = plan_id AND private.can_read_bulk(p.bulk_profile_id)
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.bulk_training_plans p WHERE p.id = plan_id AND private.can_write_bulk(p.bulk_profile_id)
));
CREATE POLICY "bulk training plan exercises own" ON public.bulk_training_plan_exercises FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.bulk_training_plan_days d JOIN public.bulk_training_plans p ON p.id = d.plan_id
  WHERE d.id = plan_day_id AND private.can_read_bulk(p.bulk_profile_id)
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.bulk_training_plan_days d JOIN public.bulk_training_plans p ON p.id = d.plan_id
  WHERE d.id = plan_day_id AND private.can_write_bulk(p.bulk_profile_id)
));

GRANT SELECT ON public.bulk_training_plan_templates, public.bulk_training_plan_template_days,
  public.bulk_training_plan_template_exercises TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bulk_training_plans, public.bulk_training_plan_days,
  public.bulk_training_plan_exercises TO authenticated;
GRANT ALL ON public.bulk_training_plan_templates, public.bulk_training_plan_template_days,
  public.bulk_training_plan_template_exercises, public.bulk_training_plans,
  public.bulk_training_plan_days, public.bulk_training_plan_exercises TO service_role;

CREATE TEMP TABLE bulk_plan_template_seed (
  slug text, name text, description text, level text, days integer, split_summary text
);
INSERT INTO bulk_plan_template_seed VALUES
  ('beginner-full-body-2','Beginner Full Body A/B','A manageable two-day introduction to balanced strength training.','beginner',2,'Full Body A / Full Body B'),
  ('beginner-full-body-3','Beginner Full Body A/B/C','Three balanced full-body sessions with straightforward movements.','beginner',3,'Full Body A / Full Body B / Full Body C'),
  ('beginner-upper-lower-4','Beginner Upper / Lower','Four focused sessions with repeat practice and manageable volume.','beginner',4,'Upper A / Lower A / Upper B / Lower B'),
  ('intermediate-full-body-3','Intermediate Full Body 3-Day','Three varied full-body sessions with balanced weekly volume.','intermediate',3,'Full Body A / Full Body B / Full Body C'),
  ('intermediate-upper-lower-4','Intermediate Upper / Lower A/B','Two upper and two lower sessions with complementary exercise selection.','intermediate',4,'Upper A / Lower A / Upper B / Lower B'),
  ('intermediate-hypertrophy-5','Intermediate Hypertrophy 5-Day','A balanced five-day split for consistent hypertrophy training.','intermediate',5,'Upper / Lower / Push / Pull / Legs'),
  ('advanced-upper-lower-4','Advanced Upper / Lower','Higher-volume upper and lower sessions across four days.','advanced',4,'Upper A / Lower A / Upper B / Lower B'),
  ('advanced-hypertrophy-5','Advanced PPL + Upper / Lower','A five-day split balancing specialization and repeat exposure.','advanced',5,'Push / Pull / Legs / Upper / Lower'),
  ('advanced-ppl-6','Advanced Push / Pull / Legs','Push, pull and legs repeated with complementary A/B sessions.','advanced',6,'Push A / Pull A / Legs A / Push B / Pull B / Legs B');

INSERT INTO public.bulk_training_plan_templates(id,slug,name,description,experience_level,training_days_per_week,split_summary)
SELECT 'template:' || slug, slug, name, description, level, days, split_summary
FROM bulk_plan_template_seed;

CREATE TEMP TABLE bulk_plan_day_seed(template_slug text, day_order integer, day_name text, focus text);
INSERT INTO bulk_plan_day_seed VALUES
  ('beginner-full-body-2',1,'Full Body A','full_a'),('beginner-full-body-2',2,'Full Body B','full_b'),
  ('beginner-full-body-3',1,'Full Body A','full_a'),('beginner-full-body-3',2,'Full Body B','full_b'),('beginner-full-body-3',3,'Full Body C','full_c'),
  ('beginner-upper-lower-4',1,'Upper A','upper_a'),('beginner-upper-lower-4',2,'Lower A','lower_a'),('beginner-upper-lower-4',3,'Upper B','upper_b'),('beginner-upper-lower-4',4,'Lower B','lower_b'),
  ('intermediate-full-body-3',1,'Full Body A','full_a_plus'),('intermediate-full-body-3',2,'Full Body B','full_b_plus'),('intermediate-full-body-3',3,'Full Body C','full_c_plus'),
  ('intermediate-upper-lower-4',1,'Upper A','upper_a_plus'),('intermediate-upper-lower-4',2,'Lower A','lower_a_plus'),('intermediate-upper-lower-4',3,'Upper B','upper_b_plus'),('intermediate-upper-lower-4',4,'Lower B','lower_b_plus'),
  ('intermediate-hypertrophy-5',1,'Upper','upper_a_plus'),('intermediate-hypertrophy-5',2,'Lower','lower_a_plus'),('intermediate-hypertrophy-5',3,'Push','push'),('intermediate-hypertrophy-5',4,'Pull','pull'),('intermediate-hypertrophy-5',5,'Legs','legs'),
  ('advanced-upper-lower-4',1,'Upper A','upper_a_advanced'),('advanced-upper-lower-4',2,'Lower A','lower_a_advanced'),('advanced-upper-lower-4',3,'Upper B','upper_b_advanced'),('advanced-upper-lower-4',4,'Lower B','lower_b_advanced'),
  ('advanced-hypertrophy-5',1,'Push','push_advanced'),('advanced-hypertrophy-5',2,'Pull','pull_advanced'),('advanced-hypertrophy-5',3,'Legs','legs_advanced'),('advanced-hypertrophy-5',4,'Upper','upper_advanced'),('advanced-hypertrophy-5',5,'Lower','lower_advanced'),
  ('advanced-ppl-6',1,'Push A','push_advanced'),('advanced-ppl-6',2,'Pull A','pull_advanced'),('advanced-ppl-6',3,'Legs A','legs_advanced'),('advanced-ppl-6',4,'Push B','push_b_advanced'),('advanced-ppl-6',5,'Pull B','pull_b_advanced'),('advanced-ppl-6',6,'Legs B','legs_b_advanced');

INSERT INTO public.bulk_training_plan_template_days(id,template_id,day_order,name)
SELECT 'template:' || template_slug || ':day:' || day_order, 'template:' || template_slug, day_order, day_name
FROM bulk_plan_day_seed;

CREATE TEMP TABLE bulk_plan_exercise_seed(
  focus text, exercise_order integer, exercise_slug text, sets integer, rep_min integer, rep_max integer, mode text
);
INSERT INTO bulk_plan_exercise_seed VALUES
  ('full_a',1,'incline-dumbbell-bench-press',3,8,12,'bilateral'),('full_a',2,'seated-cable-row',3,8,12,'bilateral'),('full_a',3,'goblet-squat',3,8,12,'bilateral'),('full_a',4,'seated-leg-curl',2,10,15,'bilateral'),('full_a',5,'dumbbell-lateral-raise',2,12,15,'bilateral'),('full_a',6,'cable-crunch',2,10,15,'bilateral'),
  ('full_b',1,'machine-chest-press',3,8,12,'bilateral'),('full_b',2,'wide-grip-lat-pulldown',3,8,12,'bilateral'),('full_b',3,'dumbbell-romanian-deadlift',3,8,12,'bilateral'),('full_b',4,'leg-extension',2,10,15,'bilateral'),('full_b',5,'rope-triceps-pushdown',2,10,15,'bilateral'),('full_b',6,'standing-calf-raise',3,10,15,'bilateral'),
  ('full_c',1,'flat-dumbbell-bench-press',3,8,12,'bilateral'),('full_c',2,'one-arm-dumbbell-row',3,8,12,'unilateral'),('full_c',3,'hack-squat',3,8,12,'bilateral'),('full_c',4,'dumbbell-hip-thrust',3,8,12,'bilateral'),('full_c',5,'seated-dumbbell-shoulder-press',2,8,12,'bilateral'),('full_c',6,'incline-dumbbell-curl',2,10,15,'bilateral'),('full_c',7,'hanging-leg-raise',2,8,15,'bilateral'),
  ('upper_a',1,'incline-dumbbell-bench-press',3,8,12,'bilateral'),('upper_a',2,'seated-cable-row',3,8,12,'bilateral'),('upper_a',3,'seated-dumbbell-shoulder-press',2,8,12,'bilateral'),('upper_a',4,'wide-grip-lat-pulldown',2,8,12,'bilateral'),('upper_a',5,'dumbbell-lateral-raise',2,12,15,'bilateral'),('upper_a',6,'rope-triceps-pushdown',2,10,15,'bilateral'),
  ('upper_b',1,'machine-chest-press',3,8,12,'bilateral'),('upper_b',2,'one-arm-dumbbell-row',3,8,12,'unilateral'),('upper_b',3,'pull-up',2,6,10,'bilateral'),('upper_b',4,'face-pull',2,12,15,'bilateral'),('upper_b',5,'incline-dumbbell-curl',2,10,15,'bilateral'),('upper_b',6,'rope-triceps-pushdown',2,10,15,'bilateral'),
  ('lower_a',1,'goblet-squat',3,8,12,'bilateral'),('lower_a',2,'dumbbell-romanian-deadlift',3,8,12,'bilateral'),('lower_a',3,'leg-extension',2,10,15,'bilateral'),('lower_a',4,'seated-leg-curl',2,10,15,'bilateral'),('lower_a',5,'standing-calf-raise',3,10,15,'bilateral'),('lower_a',6,'cable-crunch',2,10,15,'bilateral'),
  ('lower_b',1,'hack-squat',3,8,12,'bilateral'),('lower_b',2,'dumbbell-hip-thrust',3,8,12,'bilateral'),('lower_b',3,'lying-leg-curl',2,10,15,'bilateral'),('lower_b',4,'leg-extension',2,10,15,'bilateral'),('lower_b',5,'seated-calf-raise',3,10,15,'bilateral'),('lower_b',6,'hanging-leg-raise',2,8,15,'bilateral');

-- Intermediate and advanced focuses deliberately reuse stable movements while increasing volume.
INSERT INTO bulk_plan_exercise_seed
SELECT focus || '_plus', exercise_order, exercise_slug, least(sets + 1, 4), rep_min, rep_max, mode
FROM bulk_plan_exercise_seed WHERE focus IN ('full_a','full_b','full_c','upper_a','upper_b','lower_a','lower_b');
INSERT INTO bulk_plan_exercise_seed VALUES
  ('push',1,'incline-dumbbell-bench-press',3,6,10,'bilateral'),('push',2,'machine-chest-press',3,8,12,'bilateral'),('push',3,'seated-dumbbell-shoulder-press',3,8,12,'bilateral'),('push',4,'dumbbell-lateral-raise',3,12,15,'bilateral'),('push',5,'rope-triceps-pushdown',3,10,15,'bilateral'),('push',6,'cable-crunch',2,10,15,'bilateral'),
  ('pull',1,'pull-up',3,6,10,'bilateral'),('pull',2,'seated-cable-row',3,8,12,'bilateral'),('pull',3,'one-arm-dumbbell-row',3,8,12,'unilateral'),('pull',4,'face-pull',3,12,15,'bilateral'),('pull',5,'incline-dumbbell-curl',3,10,15,'bilateral'),('pull',6,'hanging-leg-raise',2,8,15,'bilateral'),
  ('legs',1,'high-bar-back-squat',3,6,10,'bilateral'),('legs',2,'barbell-romanian-deadlift',3,8,12,'bilateral'),('legs',3,'dumbbell-hip-thrust',3,8,12,'bilateral'),('legs',4,'leg-extension',3,10,15,'bilateral'),('legs',5,'seated-leg-curl',3,10,15,'bilateral'),('legs',6,'standing-calf-raise',4,10,15,'bilateral'),('legs',7,'cable-crunch',2,10,15,'bilateral');
INSERT INTO bulk_plan_exercise_seed
SELECT focus || '_advanced', exercise_order, exercise_slug, least(sets + 1, 5), rep_min, rep_max, mode
FROM bulk_plan_exercise_seed WHERE focus IN ('upper_a','upper_b','lower_a','lower_b','push','pull','legs');
INSERT INTO bulk_plan_exercise_seed
SELECT CASE focus WHEN 'upper_a' THEN 'upper_advanced' WHEN 'lower_a' THEN 'lower_advanced' END,
  exercise_order, exercise_slug, least(sets + 1, 5), rep_min, rep_max, mode
FROM bulk_plan_exercise_seed WHERE focus IN ('upper_a','lower_a');
INSERT INTO bulk_plan_exercise_seed
SELECT CASE focus WHEN 'push' THEN 'push_b_advanced' WHEN 'pull' THEN 'pull_b_advanced' WHEN 'legs' THEN 'legs_b_advanced' END,
  exercise_order, exercise_slug, least(sets + 1, 5), rep_min, rep_max, mode
FROM bulk_plan_exercise_seed WHERE focus IN ('push','pull','legs');

INSERT INTO public.bulk_training_plan_template_exercises(
  id,template_day_id,exercise_id,exercise_order,sets,rep_min,rep_max,intended_unilateral_mode
)
SELECT 'template:' || d.template_slug || ':day:' || d.day_order || ':exercise:' || e.exercise_order,
  'template:' || d.template_slug || ':day:' || d.day_order,
  'system:' || e.exercise_slug, e.exercise_order, e.sets, e.rep_min, e.rep_max, e.mode
FROM bulk_plan_day_seed d JOIN bulk_plan_exercise_seed e ON e.focus = d.focus;

UPDATE public.bulk_training_plan_templates t
SET required_equipment = required.items
FROM (
  SELECT d.template_id, pg_catalog.array_agg(DISTINCT equipment_item ORDER BY equipment_item) AS items
  FROM public.bulk_training_plan_template_days d
  JOIN public.bulk_training_plan_template_exercises pe ON pe.template_day_id = d.id
  JOIN public.bulk_exercises e ON e.id = pe.exercise_id
  CROSS JOIN LATERAL pg_catalog.unnest(e.equipment) equipment_item
  GROUP BY d.template_id
) required
WHERE t.id = required.template_id;

CREATE FUNCTION public.instantiate_bulk_training_plan(_template_id text, _plan_type text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  caller uuid := (SELECT auth.uid()); profile_id uuid; existing public.bulk_training_plans; result_id uuid;
  template public.bulk_training_plan_templates;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _template_id IS NULL OR _template_id = '' OR _plan_type NOT IN ('generated','tempo_preset')
    THEN RAISE EXCEPTION 'Invalid training plan selection'; END IF;
  SELECT p.id INTO profile_id FROM public.bulk_profiles p
  JOIN public.bulk_members m ON m.bulk_profile_id = p.id
  WHERE p.owner_id = caller AND m.user_id = caller AND m.role = 'owner' LIMIT 1;
  IF profile_id IS NULL THEN RAISE EXCEPTION 'Active Bulk profile required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(profile_id::text || ':training-plan', 0));
  SELECT * INTO existing FROM public.bulk_training_plans p WHERE p.bulk_profile_id = profile_id AND p.active;
  IF existing.id IS NOT NULL THEN
    IF existing.source_template_id = _template_id AND existing.plan_type = _plan_type THEN RETURN existing.id; END IF;
    RAISE EXCEPTION 'An active training plan already exists';
  END IF;
  SELECT * INTO template FROM public.bulk_training_plan_templates t WHERE t.id = _template_id AND t.active;
  IF template.id IS NULL THEN RAISE EXCEPTION 'Training plan template not found'; END IF;
  INSERT INTO public.bulk_training_plans(bulk_profile_id,source_template_id,plan_type,name,description,experience_level,training_days_per_week)
  VALUES(profile_id,template.id,_plan_type,template.name,template.description,template.experience_level,template.training_days_per_week)
  RETURNING id INTO result_id;
  INSERT INTO public.bulk_training_plan_days(plan_id,day_order,name)
  SELECT result_id,d.day_order,d.name FROM public.bulk_training_plan_template_days d WHERE d.template_id = template.id ORDER BY d.day_order;
  INSERT INTO public.bulk_training_plan_exercises(plan_day_id,exercise_id,source_system_exercise_id,exercise_name,exercise_order,sets,rep_min,rep_max,intended_unilateral_mode,notes)
  SELECT ud.id,te.exercise_id,te.exercise_id,e.name,te.exercise_order,te.sets,te.rep_min,te.rep_max,te.intended_unilateral_mode,te.notes
  FROM public.bulk_training_plan_template_days td
  JOIN public.bulk_training_plan_template_exercises te ON te.template_day_id = td.id
  JOIN public.bulk_training_plan_days ud ON ud.plan_id = result_id AND ud.day_order = td.day_order
  JOIN public.bulk_exercises e ON e.id = te.exercise_id
  WHERE td.template_id = template.id ORDER BY td.day_order,te.exercise_order;
  RETURN result_id;
END;
$function$;

CREATE FUNCTION public.create_empty_bulk_training_plan(_name text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE caller uuid := (SELECT auth.uid()); profile_id uuid; existing public.bulk_training_plans; result_id uuid; clean_name text := btrim(_name);
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF clean_name IS NULL OR char_length(clean_name) NOT BETWEEN 2 AND 80 THEN RAISE EXCEPTION 'Plan name must be between 2 and 80 characters'; END IF;
  SELECT p.id INTO profile_id FROM public.bulk_profiles p
  JOIN public.bulk_members m ON m.bulk_profile_id = p.id
  WHERE p.owner_id = caller AND m.user_id = caller AND m.role = 'owner' LIMIT 1;
  IF profile_id IS NULL THEN RAISE EXCEPTION 'Active Bulk profile required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(profile_id::text || ':training-plan', 0));
  SELECT * INTO existing FROM public.bulk_training_plans p WHERE p.bulk_profile_id = profile_id AND p.active;
  IF existing.id IS NOT NULL THEN
    IF existing.plan_type = 'custom' AND existing.source_template_id IS NULL AND existing.name = clean_name THEN RETURN existing.id; END IF;
    RAISE EXCEPTION 'An active training plan already exists';
  END IF;
  INSERT INTO public.bulk_training_plans(bulk_profile_id,plan_type,name,training_days_per_week)
  VALUES(profile_id,'custom',clean_name,0) RETURNING id INTO result_id;
  RETURN result_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.instantiate_bulk_training_plan(text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_empty_bulk_training_plan(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.instantiate_bulk_training_plan(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_empty_bulk_training_plan(text) TO authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.workout_templates, public.workout_template_exercises FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.workout_templates, public.workout_template_exercises FROM authenticated;
GRANT SELECT ON TABLE public.workout_templates, public.workout_template_exercises TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.workout_templates, public.workout_template_exercises TO service_role;

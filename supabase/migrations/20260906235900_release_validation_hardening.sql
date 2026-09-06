-- Segment 14: bound direct Challenge activity input without rewriting history.
-- NOT VALID preserves any legacy rows; PostgreSQL still checks all new writes.
ALTER TABLE public.challenge_activities
  ADD CONSTRAINT challenge_activities_note_length_ck
  CHECK (note IS NULL OR char_length(note) <= 500) NOT VALID,
  ADD CONSTRAINT challenge_activities_evidence_path_length_ck
  CHECK (char_length(evidence_path) <= 500) NOT VALID,
  ADD CONSTRAINT challenge_activities_extra_evidence_paths_ck
  CHECK (
    cardinality(extra_evidence_paths) <= 3
    AND char_length(array_to_string(extra_evidence_paths, '')) <= 1500
  ) NOT VALID;

ALTER TABLE public.challenge_payments
  ADD CONSTRAINT challenge_payments_evidence_path_length_ck
  CHECK (
    payment_evidence_path IS NULL
    OR char_length(payment_evidence_path) <= 500
  ) NOT VALID;

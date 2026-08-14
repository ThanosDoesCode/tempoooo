DROP POLICY IF EXISTS "challenge evidence delete" ON storage.objects;
CREATE POLICY "challenge evidence delete" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'challenge-evidence'
  AND (storage.foldername(name))[2] = (auth.uid())::text
  AND private.is_challenge_member(public.safe_uuid((storage.foldername(name))[1]))
);
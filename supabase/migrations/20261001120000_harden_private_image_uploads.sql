-- Keep private image buckets owner/member-scoped while adding server-enforced
-- upload size and MIME boundaries. Existing objects and paths are unchanged.
UPDATE storage.buckets
SET public = false,
    file_size_limit = 15728640,
    allowed_mime_types = ARRAY[
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/heic',
      'image/heif'
    ]::text[]
WHERE id IN ('challenge-evidence', 'bulk-progress-photos', 'payment-evidence');

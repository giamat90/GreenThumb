-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 002 — Supabase Storage for plant photos
-- Run: supabase db push  (or apply via Supabase dashboard)
-- ─────────────────────────────────────────────────────────────────────────────

-- Create the storage bucket (public so photo URLs work without signed tokens)
INSERT INTO storage.buckets (id, name, public)
VALUES ('plant-photos', 'plant-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Policy: authenticated users can upload to their own folder only
-- Path format enforced: {user_id}/{plant_id}.jpg
CREATE POLICY "Users can upload their own plant photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'plant-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Policy: anyone can view photos (public bucket, needed for photo_url in the app)
CREATE POLICY "Plant photos are publicly viewable"
ON storage.objects FOR SELECT
USING (bucket_id = 'plant-photos');

-- Policy: users can delete their own photos (for plant deletion)
CREATE POLICY "Users can delete their own plant photos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'plant-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

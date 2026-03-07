-- Allow authenticated users to upload growth photos
CREATE POLICY "Users can upload growth photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'plant-photos' AND
  (storage.foldername(name))[1] = 'growth'
);

-- Allow authenticated users to read growth photos
CREATE POLICY "Users can read growth photos"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'plant-photos' AND
  (storage.foldername(name))[1] = 'growth'
);

-- Allow authenticated users to delete their growth photos
CREATE POLICY "Users can delete growth photos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'plant-photos' AND
  (storage.foldername(name))[1] = 'growth'
);

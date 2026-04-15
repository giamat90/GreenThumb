-- Migration 019: allow mutual followers to view each other's plants
-- A viewer can read another user's plants only if:
--   viewer follows owner  (follows WHERE follower_id = viewer AND following_id = owner)
--   owner follows viewer  (follows WHERE follower_id = owner  AND following_id = viewer)
-- Multiple SELECT policies are combined with OR, so the existing
-- "Users can view own plants" policy continues to work unchanged.

CREATE POLICY "Mutual followers can view each other plants"
ON public.plants FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.follows f1
    INNER JOIN public.follows f2
      ON f1.follower_id = f2.following_id
      AND f1.following_id = f2.follower_id
    WHERE f1.follower_id = auth.uid()
      AND f1.following_id = plants.user_id
  )
);

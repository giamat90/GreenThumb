-- 022_plant_kudos.sql

-- ── Kudos given to a plant by a user ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS plant_kudos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plant_id uuid NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, plant_id)
);
CREATE INDEX IF NOT EXISTS plant_kudos_plant_id_idx ON plant_kudos(plant_id);
CREATE INDEX IF NOT EXISTS plant_kudos_user_id_idx ON plant_kudos(user_id);

-- ── Denormalized count on plants ─────────────────────────────────────────
ALTER TABLE plants ADD COLUMN IF NOT EXISTS kudos_count integer DEFAULT 0;

-- ── RLS for plant_kudos ──────────────────────────────────────────────────
ALTER TABLE plant_kudos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plant_kudos_read" ON plant_kudos
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "plant_kudos_insert" ON plant_kudos FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND user_id <> (SELECT p.user_id FROM plants p WHERE p.id = plant_id)
    AND (
      EXISTS (
        SELECT 1 FROM posts
        WHERE posts.plant_id = plant_kudos.plant_id
          AND posts.is_public = true
      )
      OR EXISTS (
        SELECT 1 FROM follows f1
        INNER JOIN follows f2
          ON f1.follower_id = f2.following_id
          AND f1.following_id = f2.follower_id
        WHERE f1.follower_id = auth.uid()
          AND f1.following_id = (SELECT p.user_id FROM plants p WHERE p.id = plant_kudos.plant_id)
      )
    )
  );

CREATE POLICY "plant_kudos_delete" ON plant_kudos
  FOR DELETE USING (auth.uid() = user_id);

-- ── Count triggers (mirror 015_likes_count_trigger.sql) ──────────────────
CREATE OR REPLACE FUNCTION increment_plant_kudos_count() RETURNS trigger AS $$
BEGIN
  UPDATE plants SET kudos_count = kudos_count + 1 WHERE id = NEW.plant_id;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION decrement_plant_kudos_count() RETURNS trigger AS $$
BEGIN
  UPDATE plants SET kudos_count = GREATEST(kudos_count - 1, 0) WHERE id = OLD.plant_id;
  RETURN OLD;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER plant_kudos_after_insert AFTER INSERT ON plant_kudos
  FOR EACH ROW EXECUTE FUNCTION increment_plant_kudos_count();
CREATE TRIGGER plant_kudos_after_delete AFTER DELETE ON plant_kudos
  FOR EACH ROW EXECUTE FUNCTION decrement_plant_kudos_count();

-- ── Widen plants SELECT: public-post plants become readable ──────────────
-- Only exposes plants the owner has already chosen to make public by
-- tagging them in a public post. Private plants stay private.
CREATE POLICY "Public-post plants are visible"
  ON public.plants FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM posts
      WHERE posts.plant_id = plants.id
        AND posts.is_public = true
    )
  );

-- ── Backfill (no-op for new table, defensive) ────────────────────────────
UPDATE plants p SET kudos_count = (
  SELECT COUNT(*) FROM plant_kudos WHERE plant_id = p.id
);

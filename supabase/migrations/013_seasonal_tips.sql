-- ─── Seasonal tips cache ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS seasonal_tips_cache (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month       integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  year        integer NOT NULL,
  season      text NOT NULL CHECK (season IN ('spring','summer','autumn','winter')),
  month_name  text NOT NULL,
  general_tips jsonb NOT NULL DEFAULT '[]',
  plant_tips   jsonb NOT NULL DEFAULT '[]',
  location    text NOT NULL DEFAULT '',
  created_at  timestamptz DEFAULT now(),
  UNIQUE(user_id, month, year)
);

ALTER TABLE seasonal_tips_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "seasonal_tips_read_own"
  ON seasonal_tips_cache FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "seasonal_tips_insert_own"
  ON seasonal_tips_cache FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "seasonal_tips_update_own"
  ON seasonal_tips_cache FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "seasonal_tips_delete_own"
  ON seasonal_tips_cache FOR DELETE
  USING (auth.uid() = user_id);

-- Add plant_ids column to seasonal_tips_cache so cache can be invalidated
-- when the user's plant set changes (plant added or removed).
ALTER TABLE seasonal_tips_cache
  ADD COLUMN IF NOT EXISTS plant_ids jsonb DEFAULT '[]';

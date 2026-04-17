-- Add community notifications preference to profiles.
-- Defaults to true (opt-out model, consistent with social app conventions).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS community_notifications boolean DEFAULT true;

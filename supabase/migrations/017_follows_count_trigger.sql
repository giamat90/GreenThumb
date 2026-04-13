-- Migration 017: keep user_profiles followers/following counts in sync via triggers
--
-- Previously, inserting or deleting a row in the follows table never updated
-- user_profiles.followers_count or user_profiles.following_count, so follower
-- counts always stayed at 0.

-- ── Trigger functions ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION increment_follow_counts()
RETURNS TRIGGER AS $$
BEGIN
  -- The person being followed gains a follower
  UPDATE user_profiles SET followers_count = followers_count + 1 WHERE id = NEW.following_id;
  -- The person who followed gains one more "following"
  UPDATE user_profiles SET following_count = following_count + 1 WHERE id = NEW.follower_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION decrement_follow_counts()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE user_profiles SET followers_count = GREATEST(0, followers_count - 1) WHERE id = OLD.following_id;
  UPDATE user_profiles SET following_count = GREATEST(0, following_count - 1) WHERE id = OLD.follower_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Triggers ─────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS on_follow_insert ON follows;
CREATE TRIGGER on_follow_insert
  AFTER INSERT ON follows
  FOR EACH ROW EXECUTE FUNCTION increment_follow_counts();

DROP TRIGGER IF EXISTS on_follow_delete ON follows;
CREATE TRIGGER on_follow_delete
  AFTER DELETE ON follows
  FOR EACH ROW EXECUTE FUNCTION decrement_follow_counts();

-- ── Backfill existing data ───────────────────────────────────────────────────

UPDATE user_profiles p
SET followers_count = (
  SELECT COUNT(*) FROM follows f WHERE f.following_id = p.id
);

UPDATE user_profiles p
SET following_count = (
  SELECT COUNT(*) FROM follows f WHERE f.follower_id = p.id
);

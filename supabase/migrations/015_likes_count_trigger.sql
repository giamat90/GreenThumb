-- Migration 015: keep posts.likes_count in sync via triggers
--
-- Previously, liking/unliking a post only wrote to post_likes but never
-- touched posts.likes_count, so every user except the one who performed
-- the action saw a permanently stale count.

-- ── Trigger functions ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION increment_post_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION decrement_post_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE posts SET likes_count = GREATEST(0, likes_count - 1) WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Triggers ─────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS on_post_like_insert ON post_likes;
CREATE TRIGGER on_post_like_insert
  AFTER INSERT ON post_likes
  FOR EACH ROW EXECUTE FUNCTION increment_post_likes_count();

DROP TRIGGER IF EXISTS on_post_like_delete ON post_likes;
CREATE TRIGGER on_post_like_delete
  AFTER DELETE ON post_likes
  FOR EACH ROW EXECUTE FUNCTION decrement_post_likes_count();

-- ── Backfill existing data ───────────────────────────────────────────────────
-- Recalculate likes_count for all posts from actual post_likes rows,
-- fixing any counts that drifted before this migration.

UPDATE posts p
SET likes_count = (
  SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id
);

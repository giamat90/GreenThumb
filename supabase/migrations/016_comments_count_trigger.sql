-- Migration 016: keep posts.comments_count in sync via triggers
--
-- Previously, inserting a comment into post_comments never updated
-- posts.comments_count, so all users except the commenter always
-- saw a stale count.

-- ── Trigger functions ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION increment_post_comments_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION decrement_post_comments_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE posts SET comments_count = GREATEST(0, comments_count - 1) WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Triggers ─────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS on_post_comment_insert ON post_comments;
CREATE TRIGGER on_post_comment_insert
  AFTER INSERT ON post_comments
  FOR EACH ROW EXECUTE FUNCTION increment_post_comments_count();

DROP TRIGGER IF EXISTS on_post_comment_delete ON post_comments;
CREATE TRIGGER on_post_comment_delete
  AFTER DELETE ON post_comments
  FOR EACH ROW EXECUTE FUNCTION decrement_post_comments_count();

-- ── Backfill existing data ───────────────────────────────────────────────────
-- Recalculate comments_count for all posts from actual post_comments rows,
-- fixing any counts that drifted before this migration.

UPDATE posts p
SET comments_count = (
  SELECT COUNT(*) FROM post_comments pc WHERE pc.post_id = p.id
);

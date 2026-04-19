-- ─── Post Reactions (024) ────────────────────────────────────────────────────
-- Replaces the simple heart like system with a 4-type plant-themed reaction
-- system. post_likes is retained for backward compatibility (migration 015
-- trigger still fires) but is no longer written to by the app.

CREATE TABLE IF NOT EXISTS post_reactions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       uuid        NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reaction_type text        NOT NULL CHECK (reaction_type IN ('sprouting', 'blooming', 'hydrated', 'green_thumb')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_reactions_post_id ON post_reactions(post_id);
CREATE INDEX IF NOT EXISTS idx_post_reactions_user_id ON post_reactions(user_id);

-- Migrate existing likes as 'sprouting' reactions
INSERT INTO post_reactions (post_id, user_id, reaction_type, created_at)
SELECT post_id, user_id, 'sprouting', created_at
FROM post_likes
ON CONFLICT (post_id, user_id) DO NOTHING;

-- View: per-post reaction counts
CREATE OR REPLACE VIEW post_reaction_counts AS
SELECT
  post_id,
  COALESCE(COUNT(*) FILTER (WHERE reaction_type = 'sprouting'),   0)::int AS sprouting,
  COALESCE(COUNT(*) FILTER (WHERE reaction_type = 'blooming'),    0)::int AS blooming,
  COALESCE(COUNT(*) FILTER (WHERE reaction_type = 'hydrated'),    0)::int AS hydrated,
  COALESCE(COUNT(*) FILTER (WHERE reaction_type = 'green_thumb'), 0)::int AS green_thumb,
  COUNT(*)::int AS total
FROM post_reactions
GROUP BY post_id;

-- View: total kudos (reactions) received per user across all their posts
CREATE OR REPLACE VIEW user_kudos_total AS
SELECT
  p.user_id,
  COUNT(*)::int AS total_kudos
FROM post_reactions pr
JOIN posts p ON p.id = pr.post_id
GROUP BY p.user_id;

-- RLS
ALTER TABLE post_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reactions_read"
  ON post_reactions FOR SELECT USING (true);

CREATE POLICY "reactions_insert"
  ON post_reactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "reactions_delete"
  ON post_reactions FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "reactions_update"
  ON post_reactions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

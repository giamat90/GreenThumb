-- ─── Community fix: explicit FK from posts → user_profiles ──────────────────

-- Add named FK from posts.user_id → user_profiles.id so Supabase can resolve
-- the join in .select("*, user_profiles!posts_user_id_fkey(*)")
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posts_user_id_fkey'
  ) THEN
    ALTER TABLE posts
      ADD CONSTRAINT posts_user_id_fkey
      FOREIGN KEY (user_id)
      REFERENCES user_profiles(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- Ensure user_profiles.id has a named FK to auth.users (may already exist inline)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_id_fkey'
  ) THEN
    ALTER TABLE user_profiles
      ADD CONSTRAINT user_profiles_id_fkey
      FOREIGN KEY (id)
      REFERENCES auth.users(id)
      ON DELETE CASCADE;
  END IF;
END $$;

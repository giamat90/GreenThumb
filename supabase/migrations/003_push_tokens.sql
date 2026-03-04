-- Add push notification token column to profiles.
-- Used to store the Expo push token for server-side push delivery
-- (future: Supabase scheduled functions can use this to send reminders).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS push_token text;

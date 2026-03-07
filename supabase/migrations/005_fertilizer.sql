ALTER TABLE plants ADD COLUMN IF NOT EXISTS fertilizer_interval_days INTEGER DEFAULT 14;
ALTER TABLE plants ADD COLUMN IF NOT EXISTS last_fertilized_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE plants ADD COLUMN IF NOT EXISTS next_fertilizer_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE plants ADD COLUMN IF NOT EXISTS fertilizer_type TEXT DEFAULT 'liquid';

CREATE TABLE fertilizer_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  plant_id UUID REFERENCES plants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  fertilized_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  fertilizer_type TEXT,
  notes TEXT
);

ALTER TABLE fertilizer_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own fertilizer logs"
  ON fertilizer_logs FOR ALL
  USING (auth.uid() = user_id);

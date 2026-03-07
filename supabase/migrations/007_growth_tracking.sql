CREATE TABLE growth_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  plant_id UUID REFERENCES plants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  photo_url TEXT,
  height_cm DECIMAL(6,1),
  notes TEXT,
  logged_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE growth_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own growth logs"
  ON growth_logs FOR ALL
  USING (auth.uid() = user_id);

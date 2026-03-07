CREATE TABLE placement_analyses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  plant_id UUID REFERENCES plants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  overall TEXT NOT NULL,
  score INTEGER NOT NULL,
  light JSONB NOT NULL,
  humidity JSONB NOT NULL,
  temperature JSONB NOT NULL,
  summary TEXT NOT NULL,
  tips JSONB NOT NULL,
  window_direction TEXT,
  room_type TEXT,
  light_level TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE placement_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own placement analyses"
  ON placement_analyses FOR ALL
  USING (auth.uid() = user_id);

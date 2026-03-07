CREATE TABLE repotting_analyses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  plant_id UUID REFERENCES plants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  recommendation TEXT NOT NULL,
  urgency_score INTEGER NOT NULL,
  reasons JSONB NOT NULL,
  best_time TEXT,
  pot_size TEXT,
  soil_mix TEXT,
  steps JSONB NOT NULL,
  warnings JSONB,
  summary TEXT NOT NULL,
  current_pot_size TEXT,
  current_pot_material TEXT,
  observed_signs JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE repotting_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own repotting analyses"
  ON repotting_analyses FOR ALL
  USING (auth.uid() = user_id);

-- Pruning analyses table
CREATE TABLE pruning_analyses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plant_id        UUID NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  recommendation  TEXT NOT NULL CHECK (recommendation IN ('prune_now', 'prune_soon', 'wait')),
  urgency_score   INTEGER NOT NULL CHECK (urgency_score BETWEEN 1 AND 10),
  reasons         JSONB NOT NULL DEFAULT '[]',
  best_time       TEXT,
  branches_to_remove JSONB NOT NULL DEFAULT '[]',
  tools_needed    JSONB NOT NULL DEFAULT '[]',
  steps           JSONB NOT NULL DEFAULT '[]',
  aftercare       JSONB NOT NULL DEFAULT '[]',
  summary         TEXT NOT NULL,
  last_pruned     TEXT,
  growth_stage    TEXT,
  goal            TEXT,
  signs           JSONB DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE pruning_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own pruning analyses"
  ON pruning_analyses FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can read own pruning analyses"
  ON pruning_analyses FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own pruning analyses"
  ON pruning_analyses FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

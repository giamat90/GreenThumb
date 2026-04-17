-- Add measurement units preference to profiles
-- 'metric' = cm, °C, kg  |  'imperial' = inches, °F, lb
-- Default is 'metric' (covers the majority of GreenThumb users in EMEA/APAC/LATAM)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS units text DEFAULT 'metric'
    CHECK (units IN ('metric', 'imperial'));

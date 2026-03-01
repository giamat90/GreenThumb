-- GreenThumb initial schema
-- Run this in the Supabase SQL editor to create all tables

-- Profiles (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id              uuid REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  display_name    text,
  avatar_url      text,
  subscription    text DEFAULT 'free' CHECK (subscription IN ('free', 'pro')),
  timezone        text,
  city            text,
  lat             float,
  lng             float,
  created_at      timestamptz DEFAULT now()
);

-- Plants
CREATE TABLE IF NOT EXISTS public.plants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  name            text NOT NULL,
  species         text,
  common_name     text,
  photo_url       text,
  pot_size        text CHECK (pot_size IN ('small', 'medium', 'large')),
  location        text CHECK (location IN ('indoor', 'outdoor', 'balcony')),
  soil_type       text CHECK (soil_type IN ('standard', 'succulent', 'orchid')),
  last_watered_at timestamptz,
  next_watering   timestamptz,
  health_score    int DEFAULT 100 CHECK (health_score >= 0 AND health_score <= 100),
  care_profile    jsonb,
  notes           text,
  created_at      timestamptz DEFAULT now()
);

-- Watering Events
CREATE TABLE IF NOT EXISTS public.watering_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id        uuid REFERENCES public.plants(id) ON DELETE CASCADE NOT NULL,
  user_id         uuid REFERENCES public.profiles(id) NOT NULL,
  watered_at      timestamptz DEFAULT now(),
  amount_ml       int,
  notes           text
);

-- Diagnoses
CREATE TABLE IF NOT EXISTS public.diagnoses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id        uuid REFERENCES public.plants(id) ON DELETE CASCADE NOT NULL,
  user_id         uuid REFERENCES public.profiles(id) NOT NULL,
  photo_url       text,
  result          jsonb,
  severity        text CHECK (severity IN ('healthy', 'warning', 'critical')),
  created_at      timestamptz DEFAULT now()
);

-- Care Events
CREATE TABLE IF NOT EXISTS public.care_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id        uuid REFERENCES public.plants(id) ON DELETE CASCADE NOT NULL,
  user_id         uuid REFERENCES public.profiles(id) NOT NULL,
  type            text CHECK (type IN ('fertilize', 'repot', 'prune', 'mist')) NOT NULL,
  scheduled_for   timestamptz,
  completed_at    timestamptz,
  notes           text
);

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watering_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnoses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.care_events ENABLE ROW LEVEL SECURITY;

-- Profiles: users can only read/update their own profile
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Allow the trigger to insert profiles on signup
CREATE POLICY "Service role can insert profiles"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Plants: users can only CRUD their own plants
CREATE POLICY "Users can view own plants"
  ON public.plants FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own plants"
  ON public.plants FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own plants"
  ON public.plants FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own plants"
  ON public.plants FOR DELETE
  USING (auth.uid() = user_id);

-- Watering Events: users can only CRUD their own
CREATE POLICY "Users can view own watering events"
  ON public.watering_events FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own watering events"
  ON public.watering_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own watering events"
  ON public.watering_events FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own watering events"
  ON public.watering_events FOR DELETE
  USING (auth.uid() = user_id);

-- Diagnoses: users can only CRUD their own
CREATE POLICY "Users can view own diagnoses"
  ON public.diagnoses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own diagnoses"
  ON public.diagnoses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own diagnoses"
  ON public.diagnoses FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own diagnoses"
  ON public.diagnoses FOR DELETE
  USING (auth.uid() = user_id);

-- Care Events: users can only CRUD their own
CREATE POLICY "Users can view own care events"
  ON public.care_events FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own care events"
  ON public.care_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own care events"
  ON public.care_events FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own care events"
  ON public.care_events FOR DELETE
  USING (auth.uid() = user_id);

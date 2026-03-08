-- Add follow-up and watering adjustment columns to diagnoses table
ALTER TABLE diagnoses ADD COLUMN IF NOT EXISTS follow_up_date timestamptz;
ALTER TABLE diagnoses ADD COLUMN IF NOT EXISTS follow_up_diagnosis_id uuid REFERENCES diagnoses(id);
ALTER TABLE diagnoses ADD COLUMN IF NOT EXISTS watering_adjusted boolean DEFAULT false;
ALTER TABLE diagnoses ADD COLUMN IF NOT EXISTS watering_adjustment_days integer;

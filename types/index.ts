export type Subscription = "free" | "pro";

export type PlantLocation = "indoor" | "outdoor" | "balcony";

export type PotSize = "small" | "medium" | "large";

export type SoilType = "standard" | "succulent" | "orchid";

export type CareEventType = "fertilize" | "repot" | "prune" | "mist";

export type DiagnosisSeverity = "healthy" | "warning" | "critical";

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  subscription: Subscription;
  timezone: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
}

export interface Plant {
  id: string;
  user_id: string;
  name: string;
  species: string | null;
  common_name: string | null;
  photo_url: string | null;
  pot_size: PotSize | null;
  location: PlantLocation | null;
  soil_type: SoilType | null;
  last_watered_at: string | null;
  next_watering: string | null;
  health_score: number;
  care_profile: Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
  fertilizer_interval_days: number | null;
  last_fertilized_at: string | null;
  next_fertilizer_at: string | null;
  fertilizer_type: string | null;
}

export interface WateringEvent {
  id: string;
  plant_id: string;
  user_id: string;
  watered_at: string;
  amount_ml: number | null;
  notes: string | null;
}

export interface Diagnosis {
  id: string;
  plant_id: string;
  user_id: string;
  photo_url: string | null;
  result: Record<string, unknown> | null;
  severity: DiagnosisSeverity;
  created_at: string;
}

export interface CareEvent {
  id: string;
  plant_id: string;
  user_id: string;
  type: CareEventType;
  scheduled_for: string | null;
  completed_at: string | null;
  notes: string | null;
}

export interface GrowthLog {
  id: string;
  plant_id: string;
  user_id: string;
  photo_url: string | null;
  height_cm: number | null;
  notes: string | null;
  logged_at: string;
}

export interface FertilizerLog {
  id: string;
  plant_id: string;
  user_id: string;
  fertilized_at: string;
  fertilizer_type: string | null;
  notes: string | null;
}

export interface RepottingAnalysis {
  id: string;
  plant_id: string;
  user_id: string;
  recommendation: "repot_now" | "repot_soon" | "wait";
  urgency_score: number;
  reasons: string[];
  best_time: string | null;
  pot_size: string | null;
  soil_mix: string | null;
  steps: string[];
  warnings: string[] | null;
  summary: string;
  current_pot_size: string | null;
  current_pot_material: string | null;
  observed_signs: string[] | null;
  created_at: string;
}

export interface PruningAnalysis {
  id: string;
  plant_id: string;
  user_id: string;
  recommendation: "prune_now" | "prune_soon" | "wait";
  urgency_score: number;
  reasons: string[];
  best_time: string | null;
  branches_to_remove: string[];
  tools_needed: string[];
  steps: string[];
  aftercare: string[];
  summary: string;
  last_pruned: string | null;
  growth_stage: string | null;
  goal: string | null;
  signs: string[] | null;
  created_at: string;
}

export interface PlacementAnalysis {
  id: string;
  plant_id: string;
  user_id: string;
  overall: "good" | "warning" | "poor";
  score: number;
  light: { status: string; advice: string };
  humidity: { status: string; advice: string };
  temperature: { status: string; advice: string };
  summary: string;
  tips: string[];
  window_direction: string | null;
  room_type: string | null;
  light_level: string | null;
  created_at: string;
}

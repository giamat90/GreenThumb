export const COLORS = {
  primary: "#2D6A4F",
  secondary: "#52B788",
  lightgreen: "#D8F3DC",
  cream: "#F8F9FA",
  textPrimary: "#1B1B1B",
  textSecondary: "#6B7280",
  warning: "#F59E0B",
  danger: "#EF4444",
  success: "#10B981",
} as const;

export const CONFIG = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
  plantIdBaseUrl: "https://api.plant.id/v3",
  openWeatherBaseUrl: "https://api.openweathermap.org/data/2.5",
} as const;

export const PLANT_LIMITS = {
  free: {
    plants: 3,
    identifications_per_month: 5,
  },
  pro: {
    plants: Infinity,
    identifications_per_month: Infinity,
  },
} as const;

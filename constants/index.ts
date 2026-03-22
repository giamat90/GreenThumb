export const COLORS = {
  // ── Brand greens ──────────────────────────────────────────────────────────
  primary:        "#3E7428",  // forest green (logo)
  primaryDark:    "#2A5414",  // dark green (logo)
  primaryLight:   "#C8E6A0",  // soft green tint
  secondary:      "#6BA83A",  // medium green accent
  lightgreen:     "#E8F5D0",  // light green for cards/badges

  // ── Backgrounds ───────────────────────────────────────────────────────────
  cream:          "#F6EFDD",  // warm cream (logo background) — used everywhere as bg
  background:     "#F6EFDD",  // alias for cream
  backgroundLight:"#FAF6EE",  // slightly lighter cream for nested surfaces

  // ── Typography ────────────────────────────────────────────────────────────
  textPrimary:    "#1A1A1A",
  textSecondary:  "#666666",
  text:           "#1A1A1A",  // alias for textPrimary
  textMuted:      "#666666",  // alias for textSecondary

  // ── Borders & chrome ──────────────────────────────────────────────────────
  border:         "#E8DFC8",  // warm cream-toned border
  white:          "#FFFFFF",

  // ── Semantic ──────────────────────────────────────────────────────────────
  success:        "#3E7428",
  warning:        "#F57C00",
  danger:         "#D32F2F",
  error:          "#D32F2F",  // alias for danger
} as const;

export const CONFIG = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
  plantIdBaseUrl: "https://api.plant.id/v3",
  openWeatherBaseUrl: "https://api.openweathermap.org/data/2.5",
} as const;

export const PLANT_LIMITS = {
  free: {
    identifications_per_month: 5,
  },
  pro: {
    identifications_per_month: Infinity,
  },
} as const;

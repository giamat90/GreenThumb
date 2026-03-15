import { supabase } from "@/lib/supabase";
import { deviceLanguage } from "@/lib/i18n";
import { fetchWithRetry } from "@/lib/errorHandling";
import type { Plant } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlantTip {
  plant_name: string;
  tips: string[];
  urgency: "info" | "warning" | "urgent";
}

export interface SeasonalTips {
  season: "spring" | "summer" | "autumn" | "winter";
  month_name: string;
  general_tips: string[];
  plant_tips: PlantTip[];
  location: string;
  cached_at?: string;
}

// ─── Season helper ────────────────────────────────────────────────────────────

export function getCurrentSeason(
  month: number,
  isNorthern: boolean
): "spring" | "summer" | "autumn" | "winter" {
  const northernSeason = (m: number): SeasonalTips["season"] => {
    if (m >= 3 && m <= 5) return "spring";
    if (m >= 6 && m <= 8) return "summer";
    if (m >= 9 && m <= 11) return "autumn";
    return "winter";
  };
  const s = northernSeason(month);
  if (isNorthern) return s;
  const invert: Record<SeasonalTips["season"], SeasonalTips["season"]> = {
    spring: "autumn",
    summer: "winter",
    autumn: "spring",
    winter: "summer",
  };
  return invert[s];
}

export function seasonEmoji(season: SeasonalTips["season"]): string {
  return { spring: "🌱", summer: "☀️", autumn: "🍂", winter: "❄️" }[season];
}

// ─── Cache ────────────────────────────────────────────────────────────────────

export async function getCachedTips(userId: string): Promise<SeasonalTips | null> {
  try {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const { data, error } = await supabase
      .from("seasonal_tips_cache")
      .select("*")
      .eq("user_id", userId)
      .eq("month", month)
      .eq("year", year)
      .single();

    if (error || !data) return null;

    return {
      season: data.season as SeasonalTips["season"],
      month_name: data.month_name,
      general_tips: data.general_tips as string[],
      plant_tips: data.plant_tips as PlantTip[],
      location: data.location,
      cached_at: data.created_at,
    };
  } catch {
    return null;
  }
}

async function saveTipsToCache(
  userId: string,
  tips: SeasonalTips,
  month: number,
  year: number
): Promise<void> {
  try {
    await supabase.from("seasonal_tips_cache").upsert(
      {
        user_id: userId,
        month,
        year,
        season: tips.season,
        month_name: tips.month_name,
        general_tips: tips.general_tips,
        plant_tips: tips.plant_tips,
        location: tips.location,
        created_at: new Date().toISOString(),
      },
      { onConflict: "user_id,month,year" }
    );
  } catch (err) {
    console.warn("seasonalTips: failed to save cache", err);
  }
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

export async function fetchSeasonalTips(
  userId: string,
  plants: Plant[],
  location: string,
  month: number
): Promise<SeasonalTips> {
  const lang = deviceLanguage();

  console.log("[SeasonalTips] fetchSeasonalTips called — location:", location, "month:", month, "plants:", plants.length, "lang:", lang);

  const plantPayload = plants.map((p) => ({
    name: p.name,
    species: p.species,
    health_score: p.health_score,
    watering_interval_days:
      (p.care_profile as Record<string, unknown> | null)?.watering_interval_days as number | null,
    last_watered_at: p.last_watered_at,
  }));

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase configuration missing");
  }

  const requestBody = { plants: plantPayload, location, month, language: lang };
  console.log("[SeasonalTips] calling edge function, body:", JSON.stringify(requestBody).slice(0, 200));

  // Wrap the edge function call with automatic retry (exponential backoff)
  // to handle transient network blips or cold-start latency on the function.
  const fnData = await fetchWithRetry(async () => {
    const response = await fetch(`${supabaseUrl}/functions/v1/seasonal-tips`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    console.log("[SeasonalTips] response status:", response.status);

    if (!response.ok) {
      const errText = await response.text();
      console.error("[SeasonalTips] edge function error:", response.status, errText);
      throw new Error(`Edge function returned ${response.status}: ${errText.slice(0, 200)}`);
    }

    return response.json();
  }, 2);

  const tips: SeasonalTips = { ...fnData, location };
  await saveTipsToCache(userId, tips, month, new Date().getFullYear());
  console.log("[SeasonalTips] tips saved to cache, season:", tips.season, "general_tips:", tips.general_tips?.length);
  return tips;
}

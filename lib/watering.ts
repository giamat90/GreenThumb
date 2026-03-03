// Weather-aware watering calculation engine.
// Adjusts base watering intervals using real weather data.

import type { Plant } from "@/types";
import type { WeatherData } from "@/lib/weather";

export interface WateringCalculation {
  nextWateringDate: Date;
  adjustmentReason: string;
  adjustmentType: "none" | "delayed" | "moved_earlier";
  daysAdjusted: number;
}

// ─── Base intervals ───────────────────────────────────────────────────────────

const BASE_INTERVAL_DAYS: Record<string, number> = {
  frequent: 2,
  average: 5,
  minimum: 10,
};

function getBaseInterval(plant: Plant): number {
  const watering = (plant.care_profile as Record<string, string> | null)?.watering ?? "average";
  return BASE_INTERVAL_DAYS[watering] ?? 5;
}

// ─── Main calculation ─────────────────────────────────────────────────────────

export function calculateNextWatering(params: {
  plant: Plant;
  weather: WeatherData;
  lastWateredAt: Date;
}): WateringCalculation {
  const { plant, weather, lastWateredAt } = params;
  const location = plant.location ?? "indoor";
  const base = getBaseInterval(plant);

  let tempAdj = 0;
  let humidityAdj = 0;
  let rainAdj = 0;
  let rainReason = "";
  let adjustmentType: WateringCalculation["adjustmentType"] = "none";

  // ── Temperature adjustments ─────────────────────────────────────────────────
  if (weather.temperature > 30) {
    tempAdj = -1;
  } else if (weather.temperature > 25) {
    tempAdj = -0.5;
  } else if (weather.temperature < 10) {
    tempAdj = 2;
  } else if (weather.temperature < 15) {
    tempAdj = 1;
  }

  // ── Humidity adjustments ────────────────────────────────────────────────────
  if (weather.humidity < 30) {
    humidityAdj = -1;
  } else if (weather.humidity > 70) {
    humidityAdj = 1;
  }

  // ── Rain adjustments (outdoor only) ────────────────────────────────────────
  if (location === "outdoor") {
    if (weather.rainExpected && weather.rainAmountMm > 5) {
      rainAdj = 3;
      rainReason = "Rain expected soon — skipping watering";
      adjustmentType = "delayed";
    } else if (weather.rainExpected && weather.rainAmountMm > 2) {
      rainAdj = 1;
      rainReason = "Light rain expected";
      adjustmentType = "delayed";
    }
  }

  // ── Apply location multipliers ───────────────────────────────────────────────
  let totalAdj: number;

  if (location === "outdoor") {
    totalAdj = tempAdj + humidityAdj + rainAdj;
  } else if (location === "balcony") {
    // Temperature + rain at 50% strength; humidity ignored
    totalAdj = tempAdj * 0.5 + rainAdj * 0.5;
    if (rainAdj > 0) {
      // Still show rain reason for balcony, but softened
      rainReason = rainReason || "";
    }
  } else {
    // indoor: only temperature at 30% strength, no rain/humidity
    totalAdj = tempAdj * 0.3;
    rainAdj = 0;
    rainReason = "";
    humidityAdj = 0;
  }

  // ── Clamp to [1, base × 2] ──────────────────────────────────────────────────
  const rawInterval = base + totalAdj;
  const interval = Math.round(Math.max(1, Math.min(base * 2, rawInterval)));
  const daysAdjusted = interval - base;

  // ── Build human-readable reason ─────────────────────────────────────────────
  let adjustmentReason = "Normal schedule";

  if (rainReason) {
    adjustmentReason = rainReason;
  } else if (daysAdjusted < 0) {
    adjustmentType = "moved_earlier";
    if (weather.temperature > 25) {
      adjustmentReason = "Hot weather — watering sooner";
    } else if (weather.humidity < 30) {
      adjustmentReason = "Dry air — watering sooner";
    } else {
      adjustmentReason = "Weather conditions — watering sooner";
    }
  } else if (daysAdjusted > 0 && !rainReason) {
    adjustmentType = "delayed";
    if (weather.temperature < 15) {
      adjustmentReason = "Cool weather — watering less often";
    } else if (weather.humidity > 70) {
      adjustmentReason = "Humid air — watering less often";
    } else {
      adjustmentReason = "Weather conditions — watering less often";
    }
  }

  const nextWateringDate = new Date(lastWateredAt);
  nextWateringDate.setDate(nextWateringDate.getDate() + interval);

  return {
    nextWateringDate,
    adjustmentReason,
    adjustmentType: daysAdjusted === 0 ? "none" : adjustmentType,
    daysAdjusted,
  };
}

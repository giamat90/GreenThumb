import { supabase } from "@/lib/supabase";
import { calculateNextWatering } from "@/lib/watering";
import type { Plant } from "@/types";
import type { WeatherData } from "@/lib/weather";

export interface SyncResult {
  updated: number;
  plants: Plant[];
}

/**
 * Recalculates next_watering for every plant using current weather data.
 * Only writes to Supabase if the new date differs from the stored one by
 * more than 12 hours, to avoid unnecessary writes on every app open.
 */
export async function syncAllPlantSchedules(
  plants: Plant[],
  weather: WeatherData,
  updatePlantInStore: (id: string, updates: Partial<Plant>) => void
): Promise<SyncResult> {
  const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
  const updatedPlants: Plant[] = [];

  for (const plant of plants) {
    // Skip plants that have never been watered — no baseline to calculate from
    if (!plant.last_watered_at) continue;

    const lastWateredAt = new Date(plant.last_watered_at);
    const { nextWateringDate } = calculateNextWatering({
      plant,
      weather,
      lastWateredAt,
    });

    const storedNext = plant.next_watering ? new Date(plant.next_watering) : null;
    const diffMs = storedNext
      ? Math.abs(nextWateringDate.getTime() - storedNext.getTime())
      : Infinity;

    if (diffMs > TWELVE_HOURS_MS) {
      const nextIso = nextWateringDate.toISOString();

      // Fire-and-forget the DB write; don't block or throw on error
      supabase
        .from("plants")
        .update({ next_watering: nextIso })
        .eq("id", plant.id)
        .then(({ error }) => {
          if (error) console.error(`syncWatering: failed to update ${plant.id}:`, error.message);
        });

      const updated = { ...plant, next_watering: nextIso };
      updatePlantInStore(plant.id, { next_watering: nextIso });
      updatedPlants.push(updated);
    }
  }

  return { updated: updatedPlants.length, plants: updatedPlants };
}

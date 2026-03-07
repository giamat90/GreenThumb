import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { usePlantsStore } from "@/store/plants";
import { useUserStore } from "@/store/user";
import { getDaysUntilFertilizer, getFertilizerStatus } from "@/lib/fertilizer";
import type { FertilizerStatus } from "@/lib/fertilizer";
import type { Plant } from "@/types";

export type WateringStatus = "overdue" | "today" | "soon" | "ok";
export type { FertilizerStatus };

export interface PlantWithStatus extends Plant {
  daysUntilWatering: number | null;
  wateringStatus: WateringStatus | null;
  wateredToday: boolean;
  daysUntilFertilizer: number | null;
  fertilizerStatus: FertilizerStatus;
}

function getDaysUntilWatering(nextWatering: string | null): number | null {
  if (!nextWatering) return null;
  const now = new Date();
  const next = new Date(nextWatering);
  const diffMs = next.getTime() - now.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function getWateringStatus(days: number | null): WateringStatus | null {
  if (days === null) return null;
  if (days === 0) return "overdue";
  if (days === 1) return "today";
  if (days <= 3) return "soon";
  return "ok";
}

function checkWateredToday(lastWateredAt: string | null): boolean {
  if (!lastWateredAt) return false;
  const today = new Date();
  const watered = new Date(lastWateredAt);
  return (
    today.getFullYear() === watered.getFullYear() &&
    today.getMonth() === watered.getMonth() &&
    today.getDate() === watered.getDate()
  );
}

export function usePlants() {
  const { profile } = useUserStore();
  const { plants, setPlants } = usePlantsStore();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlants = useCallback(async () => {
    if (!profile) return;
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from("plants")
        .select("*")
        .eq("user_id", profile.id)
        .order("created_at", { ascending: false });

      if (fetchError) throw fetchError;
      setPlants((data ?? []) as Plant[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load plants");
    } finally {
      setIsLoading(false);
    }
  }, [profile, setPlants]);

  useEffect(() => {
    fetchPlants();
  }, [fetchPlants]);

  const plantsWithStatus: PlantWithStatus[] = plants.map((plant) => {
    const days = getDaysUntilWatering(plant.next_watering);
    return {
      ...plant,
      daysUntilWatering: days,
      wateringStatus: getWateringStatus(days),
      wateredToday: checkWateredToday(plant.last_watered_at),
      daysUntilFertilizer: getDaysUntilFertilizer(plant.next_fertilizer_at ?? null),
      fertilizerStatus: getFertilizerStatus(plant),
    };
  });

  return { plants: plantsWithStatus, isLoading, error, refetch: fetchPlants };
}

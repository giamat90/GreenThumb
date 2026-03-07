import type { Plant } from "@/types";

export type FertilizerStatus = "due" | "upcoming" | "ok";

/**
 * Returns the recommended fertilizer interval in days based on plant species
 * and the current month (0 = January). Growing season (Mar–Aug) gets shorter
 * intervals; dormant season doubles them.
 */
export function calculateFertilizerInterval(
  species: string | null,
  currentMonth: number
): number {
  const isGrowingSeason = currentMonth >= 2 && currentMonth <= 7; // Mar(2)–Aug(7)
  const s = (species ?? "").toLowerCase();

  const isCactiSucculent =
    s.includes("cact") || s.includes("succulent") ||
    s.includes("aloe") || s.includes("echeveria") ||
    s.includes("sedum") || s.includes("crassula");

  const isTropical =
    s.includes("monstera") || s.includes("pothos") ||
    s.includes("philodendron") || s.includes("ficus") ||
    s.includes("tropical");

  if (isCactiSucculent) return isGrowingSeason ? 30 : 60;
  if (isTropical) return isGrowingSeason ? 14 : 28;
  return isGrowingSeason ? 14 : 28;
}

export function getDaysUntilFertilizer(nextFertilizerAt: string | null): number | null {
  if (!nextFertilizerAt) return null;
  const now = new Date();
  const next = new Date(nextFertilizerAt);
  const diffMs = next.getTime() - now.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

export function getFertilizerStatus(plant: Plant): FertilizerStatus {
  const days = getDaysUntilFertilizer(plant.next_fertilizer_at ?? null);
  if (days === null) return "ok";
  if (days <= 0) return "due";
  if (days <= 3) return "upcoming";
  return "ok";
}

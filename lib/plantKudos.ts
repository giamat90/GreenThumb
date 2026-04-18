import { supabase } from "@/lib/supabase";

export async function togglePlantKudos(
  plantId: string,
  userId: string,
  currentlyKudoed: boolean
): Promise<void> {
  if (currentlyKudoed) {
    const { error } = await supabase
      .from("plant_kudos")
      .delete()
      .eq("user_id", userId)
      .eq("plant_id", plantId);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("plant_kudos")
      .insert({ user_id: userId, plant_id: plantId });
    if (error) throw error;
  }
}

export async function fetchKudoedPlantIds(
  userId: string,
  plantIds: string[]
): Promise<Set<string>> {
  if (plantIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("plant_kudos")
    .select("plant_id")
    .eq("user_id", userId)
    .in("plant_id", plantIds);
  if (error) return new Set();
  return new Set((data ?? []).map((r) => r.plant_id as string));
}

import { supabase } from "@/lib/supabase";
import { CONFIG } from "@/constants";

export interface PlantSuggestion {
  id: string;
  name: string; // scientific name
  commonNames: string[];
  probability: number; // 0–1
  careProfile: {
    watering: "frequent" | "average" | "minimum";
    light: string;
    soilType: string;
  };
}

export interface IdentificationResult {
  isPlant: boolean;
  suggestions: PlantSuggestion[];
}

/**
 * Sends a base64 image to our Supabase Edge Function, which proxies Plant.id v3.
 * The Plant.id API key is kept server-side — it is NEVER sent to the client.
 */
export async function identifyPlant(
  base64Image: string
): Promise<IdentificationResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("You must be logged in to identify plants.");
  }

  const edgeFunctionUrl = `${CONFIG.supabaseUrl}/functions/v1/identify-plant`;

  const response = await fetch(edgeFunctionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: CONFIG.supabaseAnonKey,
    },
    body: JSON.stringify({ image: base64Image }),
  });

  const data: unknown = await response.json();

  if (!response.ok) {
    const errorData = data as { error?: string };
    throw new Error(
      errorData.error ?? "Failed to identify plant. Please try again."
    );
  }

  return data as IdentificationResult;
}

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
  base64Image: string,
  language?: string
): Promise<IdentificationResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("You must be logged in to identify plants.");
  }

  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const edgeFunctionUrl = `${CONFIG.supabaseUrl}/functions/v1/identify-plant`;

  const requestBody = JSON.stringify({ image: base64Image, language });
  const requestBodyKb = Math.round(requestBody.length / 1024);
  console.log("[PlantID] calling identify...");
  console.log("[PlantID] request body size:", requestBodyKb, "KB");
  console.log("[PlantID] edge function url:", edgeFunctionUrl);

  const response = await fetch(edgeFunctionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: requestBody,
  });

  console.log("[PlantID] response status:", response.status);
  console.log("[PlantID] response ok:", response.ok);

  const data: unknown = await response.json();
  console.log("[PlantID] response data:", JSON.stringify(data).slice(0, 500));

  if (!response.ok) {
    const errorData = data as { error?: string };
    throw new Error(
      errorData.error ?? "Failed to identify plant. Please try again."
    );
  }

  return data as IdentificationResult;
}

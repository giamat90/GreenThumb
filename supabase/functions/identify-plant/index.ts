// Deno edge function — runs on Supabase's Deno runtime, NOT Node.js.
// The PLANT_ID_API_KEY secret must be set via: supabase secrets set PLANT_ID_API_KEY=...

import { corsHeaders } from "./cors.ts";

// ─── Plant.id v3 API response shape ───────────────────────────────────────────

interface PlantIdWatering {
  min?: number;
  max?: number;
}

interface PlantIdDetails {
  common_names?: string[];
  watering?: PlantIdWatering;
  best_light_condition?: string;
  best_soil_type_url?: string;
  toxicity?: string;
}

interface PlantIdSuggestion {
  id: string;
  name: string;
  probability: number;
  details?: PlantIdDetails;
}

interface PlantIdResponse {
  result: {
    is_plant: {
      binary: boolean;
      probability: number;
    };
    classification: {
      suggestions: PlantIdSuggestion[];
    };
  };
  status: string;
}

// ─── Our app's response shape ──────────────────────────────────────────────────

type WateringFrequency = "frequent" | "average" | "minimum";

interface PlantSuggestion {
  id: string;
  name: string;
  commonNames: string[];
  probability: number;
  careProfile: {
    watering: WateringFrequency;
    light: string;
    soilType: string;
  };
}

interface IdentificationResult {
  isPlant: boolean;
  suggestions: PlantSuggestion[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Plant.id returns watering as { min, max } in days between watering events.
 * A lower number = water more frequently. We bucket into three tiers:
 *   frequent  → every 2 days  (min <= 3)
 *   average   → every 5 days  (4–7)
 *   minimum   → every 10 days (8+)
 */
function mapWateringFrequency(
  watering?: PlantIdWatering
): WateringFrequency {
  if (!watering) return "average";
  const interval = watering.min ?? watering.max ?? 7;
  if (interval <= 3) return "frequent";
  if (interval <= 7) return "average";
  return "minimum";
}

/**
 * Plant.id provides a URL to a soil image rather than a descriptive label.
 * We extract a human-readable name from the URL slug as a best-effort.
 * Example: ".../loamy-soil" → "Loamy Soil"
 */
function extractSoilLabel(url?: string): string {
  if (!url) return "Well-draining";
  const match = url.match(/\/([^/]+)\/?$/);
  if (match) {
    return match[1]
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return "Well-draining";
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight sent by the mobile app
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse and validate request body
    const body = (await req.json()) as { image?: string; language?: string };

    // Log received payload size to diagnose body-limit issues
    const imageKb = body.image ? Math.round(body.image.length / 1024) : 0;
    const decodedKb = body.image ? Math.round(body.image.length * 0.75 / 1024) : 0;
    console.log("[identify-plant] received image base64 size:", imageKb, "KB");
    console.log("[identify-plant] decoded image size:", decodedKb, "KB");
    console.log("[identify-plant] language:", body.language ?? "en");

    if (!body.image || typeof body.image !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing required field: image (base64 string)" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Read the API key — only available server-side, never sent to the client
    const apiKey = Deno.env.get("PLANT_ID_API_KEY");
    if (!apiKey) {
      console.error("PLANT_ID_API_KEY secret is not set");
      return new Response(
        JSON.stringify({ error: "Plant ID API is not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Call Plant.id v3 identification endpoint
    const lang = body.language && body.language !== "en" ? body.language : undefined;
    const langParam = lang ? `&language=${encodeURIComponent(lang)}` : "";
    console.log("[identify-plant] calling Plant.id API...");
    console.log("[identify-plant] Plant.id key prefix:", Deno.env.get("PLANT_ID_API_KEY")?.substring(0, 8) + "...");
    const plantIdResponse = await fetch(
      `https://api.plant.id/v3/identification?details=common_names,watering,best_light_condition&classification_level=species${langParam}`,
      {
        method: "POST",
        headers: {
          "Api-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ images: [body.image] }),
      }
    );

    console.log("[identify-plant] Plant.id response status:", plantIdResponse.status);
    console.log("[identify-plant] Plant.id response ok:", plantIdResponse.ok);

    if (!plantIdResponse.ok) {
      const errorBody = await plantIdResponse.text();
      console.error("[identify-plant] Plant.id error body:", errorBody.slice(0, 500));
      return new Response(
        JSON.stringify({
          error: `Plant identification service error (HTTP ${plantIdResponse.status}): ${errorBody.slice(0, 200)}`,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const plantIdData = (await plantIdResponse.json()) as PlantIdResponse;

    // If the image doesn't contain a plant, return early with isPlant: false
    console.log("[identify-plant] is_plant:", plantIdData.result.is_plant.binary, "(probability:", plantIdData.result.is_plant.probability, ")");
    if (!plantIdData.result.is_plant.binary) {
      console.log("[identify-plant] no plant detected, returning isPlant: false");
      const result: IdentificationResult = { isPlant: false, suggestions: [] };
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Map the top 3 suggestions into our app's format
    const suggestions: PlantSuggestion[] =
      plantIdData.result.classification.suggestions
        .slice(0, 3)
        .map((s) => ({
          id: s.id,
          name: s.name,
          commonNames: s.details?.common_names ?? [],
          probability: s.probability,
          careProfile: {
            watering: mapWateringFrequency(s.details?.watering),
            light: s.details?.best_light_condition ?? "Bright indirect light",
            soilType: extractSoilLabel(s.details?.best_soil_type_url),
          },
        }));

    const result: IdentificationResult = { isPlant: true, suggestions };
    console.log("[identify-plant] success — returning", suggestions.length, "suggestions");

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Function error:", (error as Error).message, (error as Error).stack);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

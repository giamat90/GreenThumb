// Deno edge function — runs on Supabase's Deno runtime, NOT Node.js.
// ANTHROPIC_API_KEY must be set via: supabase secrets set ANTHROPIC_API_KEY=...

import { corsHeaders } from "./cors.ts";

// ─── Request types ────────────────────────────────────────────────────────────

interface PlacementRequestBody {
  plantName: string;
  species: string;
  careProfile: Record<string, unknown> | null;
  windowDirection: "north" | "south" | "east" | "west" | "none";
  roomType: string;
  lightLevel: "bright direct" | "bright indirect" | "medium" | "low";
  photoBase64?: string; // optional base64 JPEG of the spot
}

// ─── Response types ───────────────────────────────────────────────────────────

type FactorStatus = "good" | "warning" | "poor";

interface PlacementFactor {
  status: FactorStatus;
  advice: string;
}

interface PlacementResult {
  overall: FactorStatus;
  score: number;
  light: PlacementFactor;
  humidity: PlacementFactor;
  temperature: PlacementFactor;
  summary: string;
  tips: string[];
}

// ─── Anthropic API types (minimal) ───────────────────────────────────────────

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicImageBlock {
  type: "image";
  source: { type: "base64"; media_type: "image/jpeg"; data: string };
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicImageBlock;

interface AnthropicResponse {
  content: AnthropicTextBlock[];
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
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

    const body = (await req.json()) as Partial<PlacementRequestBody>;

    if (!body.plantName || !body.windowDirection || !body.roomType || !body.lightLevel) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: plantName, windowDirection, roomType, lightLevel" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      console.error("ANTHROPIC_API_KEY secret is not set");
      return new Response(
        JSON.stringify({ error: "Placement advisor service is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build the care requirements section from the plant's care_profile
    const care = body.careProfile ?? {};
    const careLines = [
      care.light ? `- Light requirement: ${care.light}` : "- Light requirement: unknown",
      care.watering ? `- Watering needs: ${care.watering}` : null,
      care.humidity ? `- Humidity preference: ${care.humidity}` : null,
      care.temperature ? `- Temperature range: ${care.temperature}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const windowDesc: Record<string, string> = {
      north: "north-facing (low/indirect light all day)",
      south: "south-facing (bright direct light most of the day)",
      east: "east-facing (gentle morning direct sun)",
      west: "west-facing (strong afternoon direct sun)",
      none: "no window nearby (artificial light only)",
    };

    const textPrompt = `You are an expert botanist and indoor plant placement specialist.

PLANT INFORMATION:
- Name: ${body.plantName}
- Species: ${body.species || "unknown"}
${careLines}

CURRENT PLACEMENT:
- Room: ${body.roomType}
- Window: ${windowDesc[body.windowDirection] ?? body.windowDirection}
- Observed light level: ${body.lightLevel}${body.photoBase64 ? "\n- A photo of the spot has been provided — analyze the visible light conditions and surroundings." : ""}

Evaluate whether this is a good spot for the plant across three factors: light, humidity, and temperature.

Respond ONLY with this exact JSON structure, no other text:
{
  "overall": "good" | "warning" | "poor",
  "score": 0-100,
  "light": { "status": "good" | "warning" | "poor", "advice": "one sentence of specific advice" },
  "humidity": { "status": "good" | "warning" | "poor", "advice": "one sentence of specific advice" },
  "temperature": { "status": "good" | "warning" | "poor", "advice": "one sentence of specific advice" },
  "summary": "One sentence overall verdict about the placement",
  "tips": ["actionable tip 1", "actionable tip 2", "actionable tip 3"]
}

Score: 85-100 = good, 60-84 = warning, 0-59 = poor. The overall field must match the score band.`;

    // Build message content, optionally with the spot photo for vision analysis
    const userContent: AnthropicContentBlock[] = [];

    if (body.photoBase64) {
      userContent.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: body.photoBase64 },
      });
    }

    userContent.push({ type: "text", text: textPrompt });

    console.log(`Analyzing placement for: ${body.plantName} in ${body.roomType} (${body.windowDirection} window)`);

    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 800,
        system: "You are an expert botanist and indoor plant placement specialist. Always respond in valid JSON format only.",
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      console.error("Anthropic API error:", errText);
      return new Response(
        JSON.stringify({ error: "AI analysis service temporarily unavailable" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const claudeData = (await anthropicResponse.json()) as AnthropicResponse;
    const rawText = claudeData.content[0]?.text ?? "";

    // Strip any markdown code fences that may wrap the JSON
    const jsonText = rawText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();

    let result: PlacementResult;
    try {
      result = JSON.parse(jsonText) as PlacementResult;
    } catch (parseErr) {
      console.error("Failed to parse AI JSON:", rawText, parseErr);
      return new Response(
        JSON.stringify({ error: "Could not parse placement analysis response" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Coerce overall to a valid value based on score if needed
    const validStatuses: FactorStatus[] = ["good", "warning", "poor"];
    if (!validStatuses.includes(result.overall)) {
      result.overall = result.score >= 85 ? "good" : result.score >= 60 ? "warning" : "poor";
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Function error:", (error as Error).message);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

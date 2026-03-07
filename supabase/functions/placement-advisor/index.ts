// Deno edge function — runs on Supabase's Deno runtime, NOT Node.js.
// ANTHROPIC_API_KEY must be set via: supabase secrets set ANTHROPIC_API_KEY=...

import { corsHeaders } from "./cors.ts";

// ─── Request types ────────────────────────────────────────────────────────────

interface PhotoInput {
  base64: string; // base64 encoded JPEG
  part: string;   // "Window / Light Source" | "Full Room View" | "Placement Spot" | "Current Plant Location"
}

interface PlacementRequestBody {
  plantName: string;
  species: string;
  careProfile: Record<string, unknown> | null;
  windowDirection: "north" | "south" | "east" | "west" | "none";
  roomType: string;
  lightLevel: "bright direct" | "bright indirect" | "medium" | "low";
  photos?: PhotoInput[]; // optional — analysis works from form data alone
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

    const photos = body.photos ?? [];
    const hasPhotos = photos.length > 0;
    const partLabels = photos.map((p) => p.part).join(", ");

    const photoLine = hasPhotos
      ? `\nPHOTOS PROVIDED (${photos.length}): ${partLabels}
Cross-reference the visual evidence with the form data above:
- Window / Light Source: assess actual window size, sheer curtains, obstructions → real light intensity vs. reported level
- Full Room View: judge room depth, ceiling height, reflective surfaces → how far light penetrates
- Placement Spot: check shadows, proximity to drafts, heaters, or AC vents → temperature and light consistency
- Current Plant Location: compare current vs. proposed spot to identify whether a move will be an improvement`
      : "";

    const textPrompt = `You are an expert botanist and indoor plant placement specialist.

PLANT INFORMATION:
- Name: ${body.plantName}
- Species: ${body.species || "unknown"}
${careLines}

CURRENT PLACEMENT:
- Room: ${body.roomType}
- Window: ${windowDesc[body.windowDirection] ?? body.windowDirection}
- Observed light level: ${body.lightLevel}
${photoLine}

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

    // Build message content — labeled image blocks first, then the text prompt
    const userContent: AnthropicContentBlock[] = [];

    for (const photo of photos) {
      userContent.push({ type: "text", text: `[Photo: ${photo.part}]` });
      userContent.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: photo.base64 },
      });
    }

    userContent.push({ type: "text", text: textPrompt });

    console.log(
      `Analyzing placement for: ${body.plantName} in ${body.roomType} (${body.windowDirection} window)` +
      (hasPhotos ? `, ${photos.length} photo(s): ${partLabels}` : ", no photos")
    );

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
        system: "You are an expert botanist and indoor plant placement specialist. When photos are provided, cross-reference visual evidence with the form data for the most accurate placement assessment. Always respond in valid JSON format only.",
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

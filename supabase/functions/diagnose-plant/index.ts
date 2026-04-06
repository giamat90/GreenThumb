// Deno edge function — runs on Supabase's Deno runtime, NOT Node.js.
// ANTHROPIC_API_KEY must be set via: supabase secrets set ANTHROPIC_API_KEY=...
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by Supabase.

import { corsHeaders } from "./cors.ts";

// ─── Request / response types ─────────────────────────────────────────────────

interface PhotoInput {
  base64: string; // base64 encoded JPEG
  part: string;   // e.g. "Leaves", "Overall Plant", "Stem & Base", "Soil"
}

interface DiagnoseRequestBody {
  photos: PhotoInput[]; // array of photos (at least 1 required — Leaves)
  plantId: string;      // uuid
  userId: string;       // uuid
  plantName: string;
  species: string;
  language?: string;    // BCP-47 language code, e.g. "en", "it", "es"
}

interface Treatment {
  action: string;
  priority: "immediate" | "soon" | "optional";
  detail: string;
}

interface DiagnosisResult {
  severity: "healthy" | "warning" | "critical";
  condition: string;
  confidence: number;
  description: string;
  causes: string[];
  treatments: Treatment[];
  prevention: string[];
  healthScore: number;
}

// ─── Anthropic API types (minimal — only what we use) ─────────────────────────

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicImageSource {
  type: "base64";
  media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string;
}

interface AnthropicImageBlock {
  type: "image";
  source: AnthropicImageSource;
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicImageBlock;

interface AnthropicResponse {
  content: AnthropicTextBlock[];
  stop_reason: string;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
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
    const body = (await req.json()) as Partial<DiagnoseRequestBody>;

    if (
      !body.photos ||
      !Array.isArray(body.photos) ||
      body.photos.length === 0 ||
      !body.plantId ||
      !body.userId ||
      !body.plantName
    ) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: photos (array), plantId, userId, plantName" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      console.error("ANTHROPIC_API_KEY secret is not set");
      return new Response(
        JSON.stringify({ error: "Diagnosis service is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const speciesLabel = body.species?.trim() || "unknown species";
    const photoCount = body.photos.length;
    const partLabels = body.photos.map((p) => p.part).join(", ");

    console.log(`Calling Claude for plant: ${body.plantName} (${speciesLabel}), photos: ${photoCount} [${partLabels}]`);

    // Build the vision message — one labeled text block + image block per photo
    const userContent: AnthropicContentBlock[] = [];

    for (const photo of body.photos) {
      userContent.push({
        type: "text",
        text: `[Photo: ${photo.part}]`,
      });
      userContent.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: photo.base64,
        },
      });
    }

    userContent.push({
      type: "text",
      text: `You have been given ${photoCount} photo(s) of ${body.plantName} (${speciesLabel}): ${partLabels}.
Cross-reference visual symptoms across all provided views to identify diseases, pests, nutrient deficiencies, or other health issues.
Examples of cross-referencing: yellowing leaves + dry soil = likely underwatering; brown leaf edges + wet soil = likely overwatering; spots on leaves + webbing = spider mites; pale new growth + dark older leaves = iron deficiency.
Respond ONLY with this exact JSON structure, no other text:
{
  "severity": "healthy" | "warning" | "critical",
  "condition": "brief condition name or Healthy",
  "confidence": 0.0-1.0,
  "description": "detailed explanation of what you see across all photos",
  "causes": ["cause1", "cause2"],
  "treatments": [
    {
      "action": "specific action to take",
      "priority": "immediate" | "soon" | "optional",
      "detail": "how to do it"
    }
  ],
  "prevention": ["prevention tip 1", "prevention tip 2"],
  "healthScore": 0-100
}`,
    });

    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 1024,
        system:
          "You are an expert botanist and plant pathologist. Analyze plant images for diseases, pests, nutrient deficiencies, and other health issues. When multiple photos from different angles are provided, cross-reference symptoms across all views for a more accurate diagnosis. Always respond in valid JSON format only." +
          (body.language && body.language !== "en" ? `\n\nIMPORTANT: Write all text values in your JSON response (descriptions, causes, treatments, prevention) in ${body.language} language.` : ""),
        messages: [{ role: "user", content: userContent }],
      }),
    });

    console.log("Claude response status:", anthropicResponse.status);

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      console.error("Claude API error:", errText);
      return new Response(
        JSON.stringify({ error: "AI diagnosis service temporarily unavailable" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const claudeData = (await anthropicResponse.json()) as AnthropicResponse;
    const rawText = claudeData.content[0]?.text ?? "";

    // Strip any markdown code fences Claude might add despite the instruction
    const jsonText = rawText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();

    let diagnosis: DiagnosisResult;
    try {
      diagnosis = JSON.parse(jsonText) as DiagnosisResult;
    } catch (parseErr) {
      console.error("Failed to parse Claude JSON:", rawText, parseErr);
      return new Response(
        JSON.stringify({ error: "Could not parse diagnosis response" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate severity is one of our expected values
    if (!["healthy", "warning", "critical"].includes(diagnosis.severity)) {
      diagnosis.severity = "warning";
    }

    // Diagnosis is persisted client-side (app/diagnosis/[id].tsx) which includes
    // follow_up_date, watering_adjusted, and watering_adjustment_days fields.
    // Do NOT save here to avoid duplicate entries.

    return new Response(JSON.stringify(diagnosis), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Function error:", (error as Error).message, (error as Error).stack);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

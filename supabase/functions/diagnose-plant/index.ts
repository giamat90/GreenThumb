// Deno edge function — runs on Supabase's Deno runtime, NOT Node.js.
// ANTHROPIC_API_KEY must be set via: supabase secrets set ANTHROPIC_API_KEY=...
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by Supabase.

import { corsHeaders } from "./cors.ts";

// ─── Request / response types ─────────────────────────────────────────────────

interface DiagnoseRequestBody {
  image: string;       // base64 encoded photo
  plantId: string;     // uuid — used to save the diagnosis row
  userId: string;      // uuid
  plantName: string;
  species: string;
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

    if (!body.image || !body.plantId || !body.userId || !body.plantName) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: image, plantId, userId, plantName" }),
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

    // Build the vision message with the plant photo
    const userContent: AnthropicContentBlock[] = [
      {
        type: "image",
        source: {
          type: "base64",
          // The client always sends JPEG-compressed images
          media_type: "image/jpeg",
          data: body.image,
        },
      },
      {
        type: "text",
        text: `Analyze this photo of ${body.plantName} (${speciesLabel}).
Identify any diseases, pests, deficiencies, or health issues.
Respond ONLY with this exact JSON structure, no other text:
{
  "severity": "healthy" | "warning" | "critical",
  "condition": "brief condition name or Healthy",
  "confidence": 0.0-1.0,
  "description": "detailed explanation of what you see",
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
      },
    ];

    console.log(`Calling Claude for plant: ${body.plantName} (${speciesLabel})`);

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
          "You are an expert botanist and plant pathologist. Analyze plant images for diseases, pests, nutrient deficiencies, and other health issues. Always respond in valid JSON format only.",
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

    // ── Persist the diagnosis to Supabase ─────────────────────────────────────
    // We use the auto-injected service role key so we can bypass RLS for the insert.
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (supabaseUrl && serviceRoleKey) {
      const insertResponse = await fetch(`${supabaseUrl}/rest/v1/diagnoses`, {
        method: "POST",
        headers: {
          "apikey": serviceRoleKey,
          "Authorization": `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal",
        },
        body: JSON.stringify({
          plant_id: body.plantId,
          user_id: body.userId,
          result: diagnosis,
          severity: diagnosis.severity,
          // photo_url is omitted here — the client stores the photo locally
          // and passes back the URL after upload if needed. For MVP we skip it.
        }),
      });

      if (!insertResponse.ok) {
        // Non-fatal — log but still return the diagnosis to the client
        console.error("Failed to save diagnosis:", await insertResponse.text());
      }
    } else {
      console.warn("Supabase env vars not available — diagnosis not persisted");
    }

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

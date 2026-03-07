// Deno edge function — runs on Supabase's Deno runtime, NOT Node.js.
// ANTHROPIC_API_KEY must be set via: supabase secrets set ANTHROPIC_API_KEY=...

import { corsHeaders } from "./cors.ts";

// ─── Request types ────────────────────────────────────────────────────────────

interface RepottingRequestBody {
  plantName: string;
  species?: string;
  currentPotSize: string;
  currentPotMaterial: string;
  lastRepotted: string;
  observedSigns: string[];
  photoBase64?: string;
}

// ─── Response types ───────────────────────────────────────────────────────────

interface RepottingResult {
  recommendation: "repot_now" | "repot_soon" | "wait";
  urgency_score: number;
  reasons: string[];
  best_time: string;
  pot_size: string;
  soil_mix: string;
  steps: string[];
  warnings: string[];
  summary: string;
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

    const body = (await req.json()) as Partial<RepottingRequestBody>;

    if (!body.plantName || !body.currentPotSize || !body.currentPotMaterial || !body.lastRepotted) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: plantName, currentPotSize, currentPotMaterial, lastRepotted" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      console.error("ANTHROPIC_API_KEY secret is not set");
      return new Response(
        JSON.stringify({ error: "Repotting advisor service is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const signsText = body.observedSigns && body.observedSigns.length > 0
      ? body.observedSigns.map((s) => `- ${s}`).join("\n")
      : "- No specific signs observed";

    const textPrompt = `You are an expert botanist and horticulturist specialising in indoor plant care and repotting.

PLANT INFORMATION:
- Name: ${body.plantName}
- Species: ${body.species || "unknown"}

CURRENT POT:
- Size: ${body.currentPotSize}
- Material: ${body.currentPotMaterial}
- Last repotted: ${body.lastRepotted}

OBSERVED SIGNS:
${signsText}
${body.photoBase64 ? "\nA photo of the plant has been provided — analyze the visible roots, pot, and plant size for additional clues." : ""}

Based on this information, assess whether this plant needs repotting now, soon, or can wait.

Respond ONLY with this exact JSON structure, no other text:
{
  "recommendation": "repot_now" | "repot_soon" | "wait",
  "urgency_score": 0-100,
  "reasons": ["specific reason 1", "specific reason 2"],
  "best_time": "e.g. Spring (March-May)",
  "pot_size": "e.g. 2 inches larger than current",
  "soil_mix": "e.g. Well-draining potting mix with perlite",
  "steps": ["step 1", "step 2", "step 3", "step 4", "step 5"],
  "warnings": ["important warning if any — empty array if none"],
  "summary": "One sentence verdict about whether and when to repot"
}

Scoring guide: 85-100 = repot_now, 50-84 = repot_soon, 0-49 = wait.
The recommendation field must match the score band.`;

    const userContent: AnthropicContentBlock[] = [];

    if (body.photoBase64) {
      userContent.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: body.photoBase64 },
      });
    }

    userContent.push({ type: "text", text: textPrompt });

    console.log(`Analyzing repotting for: ${body.plantName} in ${body.currentPotSize} ${body.currentPotMaterial} pot`);

    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 1000,
        system: "You are an expert botanist specialising in indoor plant repotting. Always respond in valid JSON format only.",
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

    let result: RepottingResult;
    try {
      result = JSON.parse(jsonText) as RepottingResult;
    } catch (parseErr) {
      console.error("Failed to parse AI JSON:", rawText, parseErr);
      return new Response(
        JSON.stringify({ error: "Could not parse repotting analysis response" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Coerce recommendation from score if invalid
    const validRecs = ["repot_now", "repot_soon", "wait"];
    if (!validRecs.includes(result.recommendation)) {
      result.recommendation =
        result.urgency_score >= 85 ? "repot_now"
        : result.urgency_score >= 50 ? "repot_soon"
        : "wait";
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

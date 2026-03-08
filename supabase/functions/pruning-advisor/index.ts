// Deno edge function — runs on Supabase's Deno runtime, NOT Node.js.
// ANTHROPIC_API_KEY must be set via: supabase secrets set ANTHROPIC_API_KEY=...

import { corsHeaders } from "./cors.ts";

// ─── Request types ────────────────────────────────────────────────────────────

interface PhotoInput {
  base64: string; // base64 encoded JPEG
  part: string;   // "Overall Shape" | "Problem Area" | "Branch Detail" | "Base & Stem"
}

interface PruningRequestBody {
  plantName: string;
  plantSpecies?: string;
  lastPruned: string;       // e.g. "Never", "< 1 month", "> 1 year"
  growthStage: "dormant" | "growing" | "flowering";
  goal: "shape" | "size" | "health" | "bushing";
  signs: string[];           // observed signs
  photos?: PhotoInput[];     // optional — analysis works from form data alone
}

// ─── Response types ───────────────────────────────────────────────────────────

interface PruningResult {
  recommendation: "prune_now" | "prune_soon" | "wait";
  urgency_score: number;       // 1–10
  reasons: string[];
  best_time: string;
  branches_to_remove: string[];
  tools_needed: string[];
  steps: string[];
  aftercare: string[];
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

    const body = (await req.json()) as Partial<PruningRequestBody>;

    if (!body.plantName || !body.lastPruned || !body.growthStage || !body.goal) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: plantName, lastPruned, growthStage, goal" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      console.error("ANTHROPIC_API_KEY secret is not set");
      return new Response(
        JSON.stringify({ error: "Pruning advisor service is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const signsText = body.signs && body.signs.length > 0
      ? body.signs.map((s) => `- ${s}`).join("\n")
      : "- No specific signs observed";

    const goalLabel: Record<string, string> = {
      shape: "Improve shape and aesthetics",
      size: "Control size",
      health: "Improve plant health (remove dead/diseased growth)",
      bushing: "Encourage bushier, fuller growth",
    };

    const photos = body.photos ?? [];
    const hasPhotos = photos.length > 0;
    const partLabels = photos.map((p) => p.part).join(", ");

    const photoLine = hasPhotos
      ? `\nPHOTOS PROVIDED (${photos.length}): ${partLabels}
Cross-reference visual evidence with the form data:
- Dead/brown branches in photo = prune now regardless of season
- Actively growing new shoots + crossing branches = prune soon
- Dormant plant with no obvious dead growth = wait for spring
- Visible finished flower heads / seed pods = excellent time to prune
- Overall Shape photo: assess balance, legginess, crossing branches
- Problem Area: confirm the sign observed in the form
- Branch Detail: identify if branch is dead, diseased, or just dormant
- Base & Stem: assess structural health, suckers, or root sprouts`
      : "";

    const textPrompt = `You are an expert botanist and horticulturist specialising in pruning indoor and outdoor plants.

PLANT INFORMATION:
- Name: ${body.plantName}
- Species: ${body.plantSpecies || "unknown"}

PRUNING CONTEXT:
- Last pruned: ${body.lastPruned}
- Growth stage: ${body.growthStage}
- Pruning goal: ${goalLabel[body.goal] ?? body.goal}

OBSERVED SIGNS:
${signsText}
${photoLine}

Based on all the information, assess whether this plant needs pruning now, soon, or can wait.

Respond ONLY with this exact JSON structure, no other text:
{
  "recommendation": "prune_now" | "prune_soon" | "wait",
  "urgency_score": 1-10,
  "reasons": ["specific reason 1", "specific reason 2"],
  "best_time": "e.g. Early spring before new growth, or After flowering",
  "branches_to_remove": ["description of branch/area to remove 1", "..."],
  "tools_needed": ["tool 1", "tool 2"],
  "steps": ["step 1", "step 2", "step 3"],
  "aftercare": ["aftercare tip 1", "aftercare tip 2"],
  "summary": "One sentence verdict about whether and when to prune"
}

Scoring guide: 8-10 = prune_now, 4-7 = prune_soon, 1-3 = wait.
The recommendation field must match the score band.
If recommendation is "wait", branches_to_remove can be an empty array.`;

    // Build content: labeled image blocks first, then the text prompt
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
      `Analyzing pruning for: ${body.plantName} (${body.growthStage}, goal: ${body.goal})` +
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
        max_tokens: 1000,
        system: "You are an expert botanist specialising in plant pruning. When photos are provided, cross-reference visual evidence with the form data for the most accurate pruning assessment. Always respond in valid JSON format only.",
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

    let result: PruningResult;
    try {
      result = JSON.parse(jsonText) as PruningResult;
    } catch (parseErr) {
      console.error("Failed to parse AI JSON:", rawText, parseErr);
      return new Response(
        JSON.stringify({ error: "Could not parse pruning analysis response" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Coerce recommendation from score if invalid
    const validRecs = ["prune_now", "prune_soon", "wait"];
    if (!validRecs.includes(result.recommendation)) {
      result.recommendation =
        result.urgency_score >= 8 ? "prune_now"
        : result.urgency_score >= 4 ? "prune_soon"
        : "wait";
    }

    // Clamp score to 1–10
    result.urgency_score = Math.max(1, Math.min(10, Math.round(result.urgency_score)));

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

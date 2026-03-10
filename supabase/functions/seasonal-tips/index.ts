// Deno edge function — runs on Supabase's Deno runtime, NOT Node.js.
// ANTHROPIC_API_KEY must be set via: supabase secrets set ANTHROPIC_API_KEY=...

import { corsHeaders } from "./cors.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlantInput {
  name: string;
  species: string | null;
  health_score: number;
  watering_interval_days: number | null;
  last_watered_at: string | null;
}

interface RequestBody {
  plants: PlantInput[];
  location: string;
  month: number; // 1–12
  language?: string;
}

interface PlantTip {
  plant_name: string;
  tips: string[];
  urgency: "info" | "warning" | "urgent";
}

interface SeasonalTipsResult {
  season: "spring" | "summer" | "autumn" | "winter";
  month_name: string;
  general_tips: string[];
  plant_tips: PlantTip[];
}

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicResponse {
  content: AnthropicTextBlock[];
  stop_reason: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSeason(month: number, isNorthern: boolean): SeasonalTipsResult["season"] {
  // Northern hemisphere seasons
  const northernSeason = (m: number): SeasonalTipsResult["season"] => {
    if (m >= 3 && m <= 5) return "spring";
    if (m >= 6 && m <= 8) return "summer";
    if (m >= 9 && m <= 11) return "autumn";
    return "winter";
  };
  const s = northernSeason(month);
  if (isNorthern) return s;
  // Southern hemisphere: invert
  const invert: Record<SeasonalTipsResult["season"], SeasonalTipsResult["season"]> = {
    spring: "autumn",
    summer: "winter",
    autumn: "spring",
    winter: "summer",
  };
  return invert[s];
}

function isNorthernHemisphere(location: string): boolean {
  // Simple heuristic: southern hemisphere country/city names
  const southern = ["australia", "new zealand", "brazil", "argentina", "chile",
    "south africa", "peru", "colombia", "ecuador", "bolivia", "paraguay",
    "uruguay", "sydney", "melbourne", "buenos aires", "cape town", "johannesburg",
    "santiago", "lima", "bogotá", "bogota", "auckland", "wellington"];
  const loc = location.toLowerCase();
  return !southern.some((s) => loc.includes(s));
}

function monthName(month: number): string {
  const names = ["January","February","March","April","May","June",
    "July","August","September","October","November","December"];
  return names[month - 1] ?? "Unknown";
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

    const body = (await req.json()) as Partial<RequestBody>;

    if (!body.month || !body.location) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: month, location" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    console.log("[seasonal-tips] API key present:", !!apiKey);
    if (!apiKey) {
      console.error("[seasonal-tips] ANTHROPIC_API_KEY secret is not set");
      return new Response(
        JSON.stringify({ error: "Seasonal tips service is not configured — ANTHROPIC_API_KEY missing" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const month = body.month;
    const location = body.location;
    const language = body.language ?? "en";
    const plants = body.plants ?? [];
    const northern = isNorthernHemisphere(location);
    const season = getSeason(month, northern);
    const mName = monthName(month);

    const plantsDesc = plants.length > 0
      ? plants.map((p) =>
          `- ${p.name} (${p.species ?? "unknown species"}): health ${p.health_score}/100, ` +
          `watering every ${p.watering_interval_days ?? "unknown"} days, ` +
          `last watered ${p.last_watered_at ? new Date(p.last_watered_at).toDateString() : "unknown"}`
        ).join("\n")
      : "No plants provided.";

    const languageInstruction = language !== "en"
      ? `\n\nIMPORTANT: Write ALL text values in your JSON response in ${language} language.`
      : "";

    const systemPrompt = `You are an expert botanist and plant care advisor. Give practical, concise seasonal care tips for houseplants and garden plants.${languageInstruction}`;

    const userPrompt = `Give seasonal plant care tips for ${mName} in ${location} (${season} season, ${northern ? "Northern" : "Southern"} hemisphere).

Plants to advise on:
${plantsDesc}

Respond ONLY with this exact JSON structure, no other text:
{
  "season": "${season}",
  "month_name": "${mName}",
  "general_tips": ["tip1", "tip2", "tip3", "tip4"],
  "plant_tips": [
    {
      "plant_name": "plant name",
      "tips": ["tip1", "tip2"],
      "urgency": "info" | "warning" | "urgent"
    }
  ]
}

Rules:
- general_tips: 3–4 practical tips for the season and location climate (reference ${location} weather patterns)
- plant_tips: one entry per plant provided, matching the exact plant_name given
- urgency: "urgent" if health_score < 40 or overdue watering, "warning" if health_score 40–69, "info" otherwise
- Each tip: max 2 sentences, actionable and specific
- Do not add markdown or any text outside the JSON`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("[seasonal-tips] Anthropic API error status:", response.status, "body:", err);
      return new Response(JSON.stringify({ error: "AI service error", detail: err.slice(0, 300) }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResponse = (await response.json()) as AnthropicResponse;
    const rawText = aiResponse.content[0]?.text ?? "";

    // Extract JSON from response
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("No JSON found in AI response:", rawText);
      return new Response(JSON.stringify({ error: "Invalid AI response format" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = JSON.parse(jsonMatch[0]) as SeasonalTipsResult;

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[seasonal-tips] unhandled error:", msg);
    return new Response(JSON.stringify({ error: "Internal server error", detail: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

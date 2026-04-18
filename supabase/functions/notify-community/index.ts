// Deno edge function — runs on Supabase's Deno runtime, NOT Node.js.
// Sends a push notification to the recipient of a community action
// (like, comment, or follow) via the Expo Push API.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "./cors.ts";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface RequestBody {
  type: "like" | "comment" | "follow" | "kudos";
  postId?: string;        // required for like / comment
  targetUserId?: string;  // required for follow
  plantId?: string;       // required for kudos
  commentText?: string;   // optional for comment
}

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // ── 1. Extract actor from JWT ──────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: actor }, error: authError } = await admin.auth.getUser(token);
    if (authError || !actor) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const actorId = actor.id;

    // ── 2. Parse body ──────────────────────────────────────────────────────
    const body: RequestBody = await req.json();
    const { type, postId, targetUserId, plantId, commentText } = body;
    let plantName: string | null = null;

    // ── 3. Determine recipientId ───────────────────────────────────────────
    let recipientId: string | null = null;

    if (type === "like" || type === "comment") {
      if (!postId) {
        return new Response(JSON.stringify({ error: "postId required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: post } = await admin
        .from("posts")
        .select("user_id")
        .eq("id", postId)
        .maybeSingle();
      recipientId = (post as { user_id: string } | null)?.user_id ?? null;
    } else if (type === "follow") {
      if (!targetUserId) {
        return new Response(JSON.stringify({ error: "targetUserId required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      recipientId = targetUserId;
    } else if (type === "kudos") {
      if (!plantId) {
        return new Response(JSON.stringify({ error: "plantId required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: plant } = await admin
        .from("plants")
        .select("user_id, name")
        .eq("id", plantId)
        .maybeSingle();
      const p = plant as { user_id: string; name: string | null } | null;
      recipientId = p?.user_id ?? null;
      plantName = p?.name ?? "your plant";
    }

    if (!recipientId) {
      return new Response(JSON.stringify({ ok: true, skipped: "no recipient" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 4. Prevent self-notification ──────────────────────────────────────
    if (actorId === recipientId) {
      return new Response(JSON.stringify({ ok: true, skipped: "self-action" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 5. Fetch recipient preferences + push token ────────────────────────
    const { data: recipientProfile } = await admin
      .from("profiles")
      .select("push_token, community_notifications")
      .eq("id", recipientId)
      .maybeSingle();

    const rp = recipientProfile as {
      push_token: string | null;
      community_notifications: boolean | null;
    } | null;

    if (!rp?.push_token) {
      return new Response(JSON.stringify({ ok: true, skipped: "no push token" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // community_notifications defaults to true when null (DB default)
    if (rp.community_notifications === false) {
      return new Response(JSON.stringify({ ok: true, skipped: "notifications disabled" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 6. Fetch actor username ────────────────────────────────────────────
    const { data: actorProfile } = await admin
      .from("user_profiles")
      .select("username")
      .eq("id", actorId)
      .maybeSingle();

    const actorUsername: string =
      (actorProfile as { username: string | null } | null)?.username ?? "Someone";
    const handle = `@${actorUsername}`;

    // ── 7. Build notification content ─────────────────────────────────────
    let title: string;
    let notifBody: string;
    let notifType: string;
    const notifData: Record<string, string> = { actorId };

    if (type === "like") {
      title = "💚 New like";
      notifBody = `${handle} liked your post`;
      notifType = "community_like";
      notifData.postId = postId!;
    } else if (type === "comment") {
      title = "💬 New comment";
      const preview = commentText
        ? `"${commentText.slice(0, 80)}${commentText.length > 80 ? "…" : ""}"`
        : "commented on your post";
      notifBody = `${handle}: ${preview}`;
      notifType = "community_comment";
      notifData.postId = postId!;
    } else if (type === "follow") {
      title = "👤 New follower";
      notifBody = `${handle} started following you`;
      notifType = "community_follow";
    } else {
      title = "🌱 New kudos";
      notifBody = `${handle} gave kudos to ${plantName ?? "your plant"}`;
      notifType = "community_kudos";
      notifData.plantId = plantId!;
    }

    notifData.type = notifType;

    // ── 8. Send via Expo Push API ─────────────────────────────────────────
    const pushPayload = {
      to: rp.push_token,
      title,
      body: notifBody,
      data: notifData,
      sound: "default",
      channelId: "community",
    };

    const pushRes = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pushPayload),
    });

    const pushJson = await pushRes.json();

    // Log DeviceNotRegistered errors so they're visible in Supabase logs
    // but do not return an error to the client.
    const pushData = (pushJson as { data?: { status?: string; details?: { error?: string } } })?.data;
    if (pushData?.details?.error === "DeviceNotRegistered") {
      console.warn(`notify-community: DeviceNotRegistered for user ${recipientId}`);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("notify-community: unexpected error", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

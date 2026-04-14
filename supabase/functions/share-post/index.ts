// Deno edge function — publicly accessible (deployed with --no-verify-jwt)
// Returns a 302 redirect to an Android intent:// URL.
// Chrome on Android follows the redirect and opens the GreenThumb app directly.
// If the app is not installed, Android falls back to the Play Store via browser_fallback_url.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.giamat90.greenthumb";
const PACKAGE = "com.giamat90.greenthumb";

serve(async (req: Request) => {
  const url = new URL(req.url);
  const postId = url.searchParams.get("id");

  if (!postId) {
    return new Response("Missing post ID", { status: 400 });
  }

  const encodedId = encodeURIComponent(postId);

  // intent:// URL with browser_fallback_url: Chrome follows this redirect and
  // opens the app via the greenthumb:// scheme. If the app is not installed,
  // Android redirects to the Play Store automatically.
  const intentUrl =
    `intent://community/post/${encodedId}#Intent;scheme=greenthumb;package=${PACKAGE};S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`;

  return new Response(null, {
    status: 302,
    headers: { "Location": intentUrl },
  });
});

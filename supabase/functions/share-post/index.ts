// Deno edge function — publicly accessible (deployed with --no-verify-jwt)
// Serves an HTML redirect page that opens the GreenThumb app via custom scheme,
// or shows a Play Store fallback if the app is not installed.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.giamat90.greenthumb";

serve(async (req: Request) => {
  const url = new URL(req.url);
  const postId = url.searchParams.get("id");

  if (!postId) {
    return new Response("Missing post ID", { status: 400 });
  }

  const deepLink = `greenthumb://community/post/${encodeURIComponent(postId)}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GreenThumb</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #F6EFDD;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      text-align: center;
    }
    .icon { font-size: 64px; margin-bottom: 16px; }
    h1 { color: #3E7428; font-size: 28px; margin-bottom: 8px; }
    .sub { color: #666; font-size: 16px; margin-bottom: 32px; }
    .btn {
      display: block;
      width: 100%;
      max-width: 280px;
      padding: 14px 24px;
      border-radius: 28px;
      text-decoration: none;
      font-size: 16px;
      font-weight: 600;
      margin: 8px auto;
    }
    .btn-primary { background: #3E7428; color: #fff; }
    .btn-secondary {
      background: transparent;
      color: #3E7428;
      border: 2px solid #3E7428;
    }
    #fallback { display: none; }
  </style>
  <script>
    window.addEventListener("load", function () {
      // Attempt to open the app via custom scheme
      window.location.href = "${deepLink}";
      // If still on this page after 2s, the app is not installed
      setTimeout(function () {
        document.getElementById("opening").style.display = "none";
        document.getElementById("fallback").style.display = "block";
      }, 2000);
    });
  </script>
</head>
<body>
  <div class="icon">🌿</div>
  <h1>GreenThumb</h1>
  <div id="opening">
    <p class="sub">Opening your post\u2026</p>
  </div>
  <div id="fallback">
    <p class="sub">Don't have GreenThumb yet?</p>
    <a href="${deepLink}" class="btn btn-primary">Open in App</a>
    <a href="${PLAY_STORE_URL}" class="btn btn-secondary">Get it on Google Play</a>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});

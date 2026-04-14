// Deno edge function — publicly accessible (deployed with --no-verify-jwt)
// Serves a landing page that lets the recipient open the post in the GreenThumb
// app via an Android intent:// link (works in Chrome / WhatsApp in-app browser),
// with a Play Store fallback for users who don't have the app installed.

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

  // intent:// link: works natively in Chrome and Chrome Custom Tabs (used by WhatsApp).
  // Tells Android to open greenthumb://community/post/<id> in the GreenThumb app.
  // If the app is not installed, Android falls back to the Play Store URL.
  const intentUrl =
    `intent://community/post/${encodedId}#Intent;scheme=greenthumb;package=${PACKAGE};S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`;

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
  </style>
</head>
<body>
  <div class="icon">&#127807;</div>
  <h1>GreenThumb</h1>
  <p class="sub">Tap below to view this post in the app.</p>
  <a href="${intentUrl}" class="btn btn-primary">Open in GreenThumb</a>
  <a href="${PLAY_STORE_URL}" class="btn btn-secondary">Get it on Google Play</a>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});

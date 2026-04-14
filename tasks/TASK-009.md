# TASK-009: Fix post sharing — link should open the app, not the Play Store

## Status: DONE

## Overview
When a user shares a post from the community feed, the shared message contains only plain text and a Play Store URL. Recipients who tap it land on the Play Store page even if they already have GreenThumb installed. The fix is a Supabase edge function (`share-post`) that serves a lightweight HTML redirect page at an HTTPS URL. This URL is tappable in any messaging app (WhatsApp, Telegram, etc.), opens the browser briefly, then redirects to `greenthumb://community/post/<id>` if the app is installed, or shows a Play Store button if not.

## User story
As a community user, I want to share a post so that recipients who have GreenThumb installed are taken directly to that post inside the app when they tap the link.

## Acceptance criteria
- [ ] Tapping the shared link in WhatsApp opens the browser, then immediately launches the app on the correct post
- [ ] Tapping the shared link when the app is NOT installed shows a landing page with a "Get it on Google Play" button
- [ ] The shared message includes caption text (if any) + the HTTPS link
- [ ] Both the feed share button and the post detail share button use the new link
- [ ] The edge function is publicly accessible (no auth required)
- [ ] No change to existing Pull-to-refresh or community feed behaviour

## Technical plan

### Root cause
`Share.share({ message })` in both `community.tsx` and `post/[id].tsx` embeds only a Play Store HTTPS URL, which always opens the Play Store. There is no in-app deep link in the message. Custom scheme URLs (`greenthumb://`) are not rendered as tappable hyperlinks in messaging apps — only HTTPS links are. Solution: host a public HTTPS redirect page via a Supabase edge function, then share that URL.

### Architecture
```
User taps "Share" in app
  → Share.share({ message: caption + "\n\n" + shareUrl })
  → Recipient taps HTTPS link in WhatsApp
  → Browser opens edge function page
  → JS immediately attempts: window.location = "greenthumb://community/post/<id>"
  → App installed? → Android OS intercepts, launches GreenThumb, navigates to post
  → App not installed? → After 2s, fallback HTML shows "Open in App" + "Get on Play Store"
```

### Files to create
| File | Purpose |
|------|---------|
| `supabase/functions/share-post/index.ts` | Public edge function that serves HTML redirect page |

### Files to modify
| File | Change |
|------|--------|
| `app/(tabs)/community.tsx` | Update `handleShare` to build HTTPS share URL and pass it as message |
| `app/community/post/[id].tsx` | Update share button `onPress` to build HTTPS share URL and pass it as message |

### Database changes
None.

### Edge functions
New: `share-post` — serves an HTML redirect page. Must be deployed with `--no-verify-jwt` since the recipient's browser has no Supabase auth token.

### i18n keys
None. The message is built in code; no new translatable strings needed. Existing `community.sharedVia` key is no longer included in post share messages (still used for invite flow).

## Implementation steps

### Step 1 — Create `supabase/functions/share-post/index.ts`

No imports from other functions needed (pure Deno `serve`, no CORS required — this serves HTML pages, not JSON).

```typescript
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
    <p class="sub">Opening your post…</p>
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
```

### Step 2 — Update `handleShare` in `app/(tabs)/community.tsx`

Replace the existing `handleShare` (lines ~423–429):
```typescript
const handleShare = useCallback(async (postId: string) => {
  const post = [...discoverPosts, ...followingPosts].find((p) => p.id === postId);
  const shareUrl = `https://uhiyipkjrtqvfvtgerbo.supabase.co/functions/v1/share-post?id=${postId}`;
  const message = post?.caption
    ? `${post.caption}\n\n${shareUrl}`
    : shareUrl;
  await Share.share({ message });
}, [discoverPosts, followingPosts]);
```

Remove the `t` dependency from this callback (no longer uses i18n).

### Step 3 — Update share button `onPress` in `app/community/post/[id].tsx`

Replace the existing share `onPress` handler (lines ~235–240):
```typescript
onPress={async () => {
  const shareUrl = `https://uhiyipkjrtqvfvtgerbo.supabase.co/functions/v1/share-post?id=${post.id}`;
  const message = post.caption
    ? `${post.caption}\n\n${shareUrl}`
    : shareUrl;
  await Share.share({ message });
}}
```

### Step 4 — Remove unused `t` import side-effect in `community.tsx` (if applicable)
After removing the `t` call from `handleShare`, verify whether `t` is still used elsewhere in that component. It is — it is used in many other places — so no change needed there.

## ⚡ Manual Deploy Step

The Developer instance must NOT run deploy commands. Giacomo must run the following after the code is committed:

```bash
# Step 1 — Link project (first time only, skip if done)
npx supabase login
npx supabase link --project-ref uhiyipkjrtqvfvtgerbo

# Step 2 — Deploy the function (--no-verify-jwt makes it publicly accessible)
npx supabase functions deploy share-post --no-verify-jwt
```

Verify it works:
```
curl "https://uhiyipkjrtqvfvtgerbo.supabase.co/functions/v1/share-post?id=test123"
```
Should return HTML with a redirect to `greenthumb://community/post/test123`.

## Testing checklist
- [ ] Share a post from Discover feed → verify message contains HTTPS link
- [ ] Share from post detail screen → same
- [ ] Tap the HTTPS link on a device with the app installed → verify app opens on the correct post
- [ ] Tap the HTTPS link on a device WITHOUT the app → verify Play Store button is shown
- [ ] `curl` the edge function URL → returns valid HTML (200)
- [ ] Works on free tier
- [ ] Works on Pro tier
- [ ] No hardcoded pixel values introduced
- [ ] No layout regressions

## Dependencies
None.

## Implementation notes
Created `supabase/functions/share-post/index.ts` — a public Deno edge function that serves an HTML redirect page. The page uses `window.location.href` to fire the `greenthumb://community/post/<id>` deep link on load; after 2s if the page is still visible, the fallback section shows "Open in App" and "Get it on Google Play" buttons.

Updated `handleShare` in `community.tsx` and the share `onPress` in `post/[id].tsx` to build the HTTPS share URL and use it as the message body (prepended with caption when present). Removed the `t("community.sharedVia")` usage from both — the `sharedVia` i18n key is preserved in all locale files unchanged.

The `Deno` / URL-import TS errors on the new edge function are identical to pre-existing errors on all other edge functions — expected, as the local TS compiler doesn't understand Deno's module system.

**⚡ Awaiting manual deploy:** `npx supabase functions deploy share-post --no-verify-jwt`

## Notes
- The Supabase project URL `uhiyipkjrtqvfvtgerbo.supabase.co` is hardcoded in the share URL. If the project is ever migrated, this string must be updated.
- `--no-verify-jwt` is intentional and necessary — the redirect page is opened in an anonymous browser by the recipient.
- The `greenthumb://` custom scheme is already registered in `android/app/src/main/AndroidManifest.xml` (intent filter), so no native changes are needed.
- Future improvement: If GreenThumb acquires a custom domain (e.g. greenthumb.app), Android App Links can replace this approach for a seamless no-browser-hop experience.
- The `community.sharedVia` i18n key (which contained the Play Store URL) is no longer appended to post share messages, but the key is kept in locales as it may be reused elsewhere.

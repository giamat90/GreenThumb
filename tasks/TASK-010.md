# TASK-010: Community push notifications (likes, comments, follows)

## Status: DONE

## Overview
When a user receives a like or comment on one of their posts, or gets a new follower, they should receive a remote push notification. The feature is controlled by a toggle in the Notification Settings section (available to all users, free and Pro). Notifications are delivered server-side via the Expo Push API, called from a new Supabase edge function `notify-community`. The actor's username is shown in the notification body.

## User story
As a community user, I want to be notified (via push notification) when someone likes or comments on my post, or starts following me, so I can engage with my community in real time.

## Acceptance criteria
- [ ] User receives a push notification when someone likes their post: "💚 New like / @username liked your post"
- [ ] User receives a push notification when someone comments on their post: "💬 New comment / @username: \"comment text\""
- [ ] User receives a push notification when someone follows them: "👤 New follower / @username started following you"
- [ ] No notification is sent when a user likes/comments on their own post or follows themselves (edge case)
- [ ] Notification tap on a like/comment navigates directly to the post (`/community/post/[id]`)
- [ ] Notification tap on a follow navigates to the actor's public profile (`/community/profile/[id]`)
- [ ] A "Community Notifications" toggle appears in the Notification Settings section of the profile screen
- [ ] Toggle defaults to ON; persists to `profiles.community_notifications` in Supabase
- [ ] When toggled OFF, no community push notifications are sent to that user
- [ ] No notification is sent if recipient has no push token (e.g. never granted permission)

## Technical plan

### Architecture
```
User A likes / comments / follows
  → App inserts row into post_likes / post_comments / follows (existing)
  → App fires fetch() to `notify-community` edge function (fire-and-forget, no await)
  → Edge function:
      1. Verifies JWT, extracts actorId
      2. Fetches actor's username from user_profiles
      3. Determines recipientId (post owner for like/comment; targetUserId for follow)
      4. Skips if actorId === recipientId
      5. Reads recipient's push_token + community_notifications from profiles (service role)
      6. Skips if push_token is null or community_notifications is false
      7. POSTs to https://exp.host/--/api/v2/push/send
  → User B receives push notification on their device
```

### Files to create
| File | Purpose |
|------|---------|
| `supabase/functions/notify-community/index.ts` | Edge function — validates JWT, looks up tokens, calls Expo Push API |
| `supabase/functions/notify-community/cors.ts` | Standard CORS headers (copy pattern from other functions) |
| `supabase/functions/notify-community/config.toml` | `verify_jwt = true` |
| `lib/communityNotifications.ts` | Thin client helper — `sendCommunityNotification()` fire-and-forget fetch |

### Files to modify
| File | Change |
|------|--------|
| `supabase/migrations/021_community_notifications_pref.sql` | Add `community_notifications boolean DEFAULT true` to profiles |
| `types/index.ts` | Add `community_notifications?: boolean` field to `Profile` interface |
| `components/ui/NotificationSettings.tsx` | Add Community Notifications section with toggle |
| `app/community/post/[id].tsx` | After like insert — call `sendCommunityNotification`; after comment insert — call `sendCommunityNotification` |
| `app/community/profile/[id].tsx` | After follow insert — call `sendCommunityNotification` |
| `hooks/useNotifications.ts` | Add "community" Android notification channel |
| `app/_layout.tsx` | Handle `community_like`, `community_comment`, `community_follow` notification taps for deep navigation |
| `locales/en.json` | 2 new keys under `notifications` |
| `locales/it.json` | Same |
| `locales/es.json` | Same |
| `locales/fr.json` | Same |
| `locales/de.json` | Same |
| `locales/pt.json` | Same |
| `locales/nl.json` | Same |
| `locales/pl.json` | Same |
| `locales/ja.json` | Same |
| `locales/zh.json` | Same |

### Database changes
**Migration 021** — `supabase/migrations/021_community_notifications_pref.sql`:
```sql
-- Add community notifications preference to profiles.
-- Defaults to true (opt-out model, consistent with social app conventions).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS community_notifications boolean DEFAULT true;
```

### Edge function
New: `notify-community` — requires JWT, uses service role internally to read push tokens.  
No new secrets needed — the Expo Push API accepts unauthenticated requests.

### i18n keys
Add to the `"notifications"` object in all 10 locale files:

| Locale | `communityNotifications` | `communityNotificationsDesc` |
|--------|--------------------------|------------------------------|
| en | "Community Notifications" | "Likes, comments and new followers" |
| it | "Notifiche community" | "Mi piace, commenti e nuovi follower" |
| es | "Notificaciones de comunidad" | "Me gusta, comentarios y nuevos seguidores" |
| fr | "Notifications communauté" | "J'aime, commentaires et nouveaux abonnés" |
| de | "Community-Benachrichtigungen" | "Likes, Kommentare und neue Follower" |
| pt | "Notificações da comunidade" | "Curtidas, comentários e novos seguidores" |
| nl | "Community-meldingen" | "Likes, reacties en nieuwe volgers" |
| pl | "Powiadomienia społeczności" | "Polubienia, komentarze i nowi obserwujący" |
| ja | "コミュニティ通知" | "いいね、コメント、新しいフォロワー" |
| zh | "社区通知" | "点赞、评论和新关注者" |

---

## Implementation steps

### Step 1 — Migration `021_community_notifications_pref.sql`

Create `supabase/migrations/021_community_notifications_pref.sql`:
```sql
-- Add community notifications preference to profiles.
-- Defaults to true (opt-out model, consistent with social app conventions).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS community_notifications boolean DEFAULT true;
```

### Step 2 — Update `types/index.ts`

In the `Profile` interface (currently line 15), add after the `units` field:
```typescript
community_notifications?: boolean;
```

### Step 3 — Create `lib/communityNotifications.ts`

```typescript
import { supabase } from "@/lib/supabase";

type CommunityNotifPayload =
  | { type: "like"; postId: string }
  | { type: "comment"; postId: string; commentText: string }
  | { type: "follow"; targetUserId: string };

/**
 * Fire-and-forget call to the notify-community edge function.
 * Never throws — failures are silently swallowed so they never
 * interrupt the like / comment / follow action.
 */
export function sendCommunityNotification(payload: CommunityNotifPayload): void {
  (async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
      const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

      fetch(`${supabaseUrl}/functions/v1/notify-community`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: anonKey,
        },
        body: JSON.stringify(payload),
      }).catch(() => {
        // network errors are silently ignored
      });
    } catch {
      // session errors are silently ignored
    }
  })();
}
```

### Step 4 — Create `supabase/functions/notify-community/cors.ts`

```typescript
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
```

### Step 5 — Create `supabase/functions/notify-community/config.toml`

```toml
[functions.notify-community]
verify_jwt = true
```

### Step 6 — Create `supabase/functions/notify-community/index.ts`

```typescript
// Deno edge function — runs on Supabase's Deno runtime, NOT Node.js.
// Sends a push notification to the recipient of a community action
// (like, comment, or follow) via the Expo Push API.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "./cors.ts";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface RequestBody {
  type: "like" | "comment" | "follow";
  postId?: string;       // required for like / comment
  targetUserId?: string; // required for follow
  commentText?: string;  // optional for comment
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
    const { type, postId, targetUserId, commentText } = body;

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
    } else {
      title = "👤 New follower";
      notifBody = `${handle} started following you`;
      notifType = "community_follow";
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
```

### Step 7 — Update `app/community/post/[id].tsx`

Import the helper at the top:
```typescript
import { sendCommunityNotification } from "@/lib/communityNotifications";
```

In `handleLike` (currently around line 141), after the successful `supabase.from("post_likes").insert(...)` call (i.e., inside the `else` branch where `!wasLiked`), add:
```typescript
sendCommunityNotification({ type: "like", postId: post.id });
```

The full `handleLike` else branch becomes:
```typescript
} else {
  await supabase.from("post_likes").insert({ user_id: profile.id, post_id: post.id });
  sendCommunityNotification({ type: "like", postId: post.id });
}
```

In `handleSubmitComment` (currently around line 156), after `const { data, error } = await supabase.from("post_comments").insert(...)` succeeds and the `newComment` is built (after `setCommentText("")`), add:
```typescript
sendCommunityNotification({ type: "comment", postId: post.id, commentText: commentText.trim() });
```

### Step 8 — Update `app/community/profile/[id].tsx`

Import the helper at the top:
```typescript
import { sendCommunityNotification } from "@/lib/communityNotifications";
```

In `handleFollow` (currently around line 126), inside the `else` branch (not following → start following), after the `supabase.from("follows").insert(...)` line succeeds, add:
```typescript
sendCommunityNotification({ type: "follow", targetUserId: userId });
```

The `handleFollow` insert block becomes:
```typescript
} else {
  await supabase.from("follows").insert({ follower_id: currentProfile.id, following_id: userId });
  sendCommunityNotification({ type: "follow", targetUserId: userId });
  // ... existing plants re-fetch logic ...
}
```

### Step 9 — Update `hooks/useNotifications.ts`

In `fetchAndSaveToken`, inside the `if (Platform.OS === "android")` block, add a second `setNotificationChannelAsync` call after the existing "watering" channel:

```typescript
await Notifications.setNotificationChannelAsync("community", {
  name: "Community",
  importance: Notifications.AndroidImportance.DEFAULT,
  vibrationPattern: [0, 150, 150, 150],
  lightColor: "#6BA83A",
  sound: "default",
});
```

### Step 10 — Update `app/_layout.tsx`

In the `addNotificationResponseReceivedListener` callback (currently around line 249), extend the if/else chain to handle community notification taps:

```typescript
const data = response.notification.request.content.data as {
  plantId?: string;
  type?: string;
  condition?: string;
  postId?: string;
  actorId?: string;
};
if (data?.type === "watering" && data.plantId) {
  router.push(`/plant/${data.plantId}`);
} else if (data?.type === "followup_diagnosis" && data.plantId) {
  router.push({
    pathname: "/diagnosis/[id]",
    params: { id: data.plantId, isFollowUp: "true", previousCondition: data.condition ?? "" },
  });
} else if (
  (data?.type === "community_like" || data?.type === "community_comment") &&
  data.postId
) {
  router.push({ pathname: "/community/post/[id]", params: { id: data.postId } });
} else if (data?.type === "community_follow" && data.actorId) {
  router.push({ pathname: "/community/profile/[id]", params: { id: data.actorId } });
}
```

### Step 11 — Update `components/ui/NotificationSettings.tsx`

**11a. Add imports** at the top:
```typescript
import { Heart } from "lucide-react-native";
import { useUserStore } from "@/store/user";
import { supabase } from "@/lib/supabase";
```

**11b. Add state** inside the component, near the existing state declarations:
```typescript
const { profile, setProfile } = useUserStore();
const [communityEnabled, setCommunityEnabled] = useState(true);
const [isSavingCommunity, setIsSavingCommunity] = useState(false);
```

**11c. Load community_notifications from profile** in the existing `useEffect` that runs on mount. After the `load()` function's existing body, read from `profile`:
```typescript
// community_notifications comes from the DB profile (default true)
const communityPref = profile?.community_notifications;
setCommunityEnabled(communityPref !== false); // treat null/undefined as true
```

Also add `profile` to the `useEffect` dependency array so it re-syncs if the profile loads after mount.

The updated `useEffect` should be:
```typescript
useEffect(() => {
  async function load() {
    const [enabledRaw, hourRaw, minuteRaw, calRaw, lastRaw] = await Promise.all([
      AsyncStorage.getItem(NOTIFICATIONS_ENABLED_KEY),
      AsyncStorage.getItem(REMINDER_TIME_KEY),
      AsyncStorage.getItem(REMINDER_MINUTES_KEY),
      AsyncStorage.getItem(CALENDAR_SYNC_ENABLED_KEY),
      AsyncStorage.getItem(CALENDAR_LAST_SYNCED_KEY),
    ]);
    setEnabled(enabledRaw !== "false");
    if (hourRaw) setReminderHour(parseInt(hourRaw, 10));
    if (minuteRaw) setReminderMinute(parseInt(minuteRaw, 10));
    setCalendarEnabled(calRaw === "true");
    setLastSynced(lastRaw);
    setCommunityEnabled(profile?.community_notifications !== false);
  }
  load();
}, [profile]); // eslint-disable-line react-hooks/exhaustive-deps
```

**11d. Add toggle handler**:
```typescript
async function handleCommunityToggle(value: boolean) {
  if (!profile?.id) return;
  setCommunityEnabled(value);
  setIsSavingCommunity(true);
  try {
    const { error } = await supabase
      .from("profiles")
      .update({ community_notifications: value })
      .eq("id", profile.id);
    if (error) throw error;
    setProfile({ ...profile, community_notifications: value });
  } catch (err) {
    // Revert on failure
    setCommunityEnabled(!value);
    console.warn("NotificationSettings: failed to save community_notifications", err);
  } finally {
    setIsSavingCommunity(false);
  }
}
```

**11e. Add JSX section** — insert a new section between the watering reminders card and the calendar sync section (between the closing `</View>` of the watering card and the `<Text style={[styles.sectionTitle, { marginTop: 24 }]}>{t("calendar.calendarSync")}</Text>` line):

```tsx
{/* ── Community Notifications section ──────────────────────────── */}
<Text style={[styles.sectionTitle, { marginTop: 24 }]}>{t("community.tab")}</Text>
<View style={styles.card}>
  <View style={styles.row}>
    <View style={styles.rowLeft}>
      <View style={styles.iconWrap}>
        <Heart size={18} color={COLORS.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{t("notifications.communityNotifications")}</Text>
        <Text style={styles.rowSubLabel}>
          {t("notifications.communityNotificationsDesc")}
        </Text>
      </View>
    </View>
    {isSavingCommunity ? (
      <ActivityIndicator size="small" color={COLORS.primary} />
    ) : (
      <Switch
        value={communityEnabled}
        onValueChange={handleCommunityToggle}
        trackColor={{ false: "#E5E7EB", true: COLORS.secondary }}
        thumbColor="#fff"
        accessibilityLabel="Toggle community notifications"
      />
    )}
  </View>
</View>
```

### Step 12 — Add i18n keys to all 10 locale files

In each locale file, add the following two keys to the `"notifications"` object:

**en.json:**
```json
"communityNotifications": "Community Notifications",
"communityNotificationsDesc": "Likes, comments and new followers"
```

**it.json:**
```json
"communityNotifications": "Notifiche community",
"communityNotificationsDesc": "Mi piace, commenti e nuovi follower"
```

**es.json:**
```json
"communityNotifications": "Notificaciones de comunidad",
"communityNotificationsDesc": "Me gusta, comentarios y nuevos seguidores"
```

**fr.json:**
```json
"communityNotifications": "Notifications communauté",
"communityNotificationsDesc": "J'aime, commentaires et nouveaux abonnés"
```

**de.json:**
```json
"communityNotifications": "Community-Benachrichtigungen",
"communityNotificationsDesc": "Likes, Kommentare und neue Follower"
```

**pt.json:**
```json
"communityNotifications": "Notificações da comunidade",
"communityNotificationsDesc": "Curtidas, comentários e novos seguidores"
```

**nl.json:**
```json
"communityNotifications": "Community-meldingen",
"communityNotificationsDesc": "Likes, reacties en nieuwe volgers"
```

**pl.json:**
```json
"communityNotifications": "Powiadomienia społeczności",
"communityNotificationsDesc": "Polubienia, komentarze i nowi obserwujący"
```

**ja.json:**
```json
"communityNotifications": "コミュニティ通知",
"communityNotificationsDesc": "いいね、コメント、新しいフォロワー"
```

**zh.json:**
```json
"communityNotifications": "社区通知",
"communityNotificationsDesc": "点赞、评论和新关注者"
```

---

## ⚡ Manual Deploy Step

After the Developer commits the code, Giacomo must deploy the new edge function:

```bash
# Step 1 — Link project (skip if already done)
npx supabase login
npx supabase link --project-ref uhiyipkjrtqvfvtgerbo

# Step 2 — Deploy
npx supabase functions deploy notify-community
```

Verify (replace TOKEN with a valid JWT from the app):
```bash
curl -X POST https://uhiyipkjrtqvfvtgerbo.supabase.co/functions/v1/notify-community \
  -H "Authorization: Bearer TOKEN" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"follow","targetUserId":"NON_EXISTENT_ID"}'
# Should return: {"ok":true,"skipped":"no push token"} or similar
```

---

## Testing checklist
- [ ] Like a post from another account → receiver gets push notification with actor's username
- [ ] Comment on a post from another account → receiver gets notification with comment preview
- [ ] Follow a user from another account → receiver gets notification with actor's username
- [ ] Like your own post → no notification sent
- [ ] Toggle OFF community notifications → no more community pushes arrive
- [ ] Toggle ON again → pushes resume
- [ ] Tap like/comment notification → opens the correct post screen
- [ ] Tap follow notification → opens actor's public profile
- [ ] No crash when actor or recipient has no user_profiles row
- [ ] Works on free tier
- [ ] No hardcoded pixel values introduced
- [ ] i18n toggle label renders correctly in Italian (no overflow)
- [ ] No layout regressions on profile screen

## Dependencies
None. This is self-contained.

## Implementation notes
All 12 steps implemented as specified:
- Migration `021_community_notifications_pref.sql` adds `community_notifications boolean DEFAULT true` to `profiles`
- `lib/communityNotifications.ts` — fire-and-forget helper using direct `fetch()` with anon key pattern (per CLAUDE.md critical rule #2)
- Edge function `notify-community` (index.ts + cors.ts + config.toml) — JWT-verified, uses service role to read push tokens and preferences across any user, calls Expo Push API. `verify_jwt = true` in config.toml
- `app/community/post/[id].tsx` — `sendCommunityNotification` called after like insert and after comment insert (comment text trimmed and passed for preview)
- `app/community/profile/[id].tsx` — called after follow insert
- `hooks/useNotifications.ts` — added "community" Android notification channel alongside existing "watering" channel
- `app/_layout.tsx` — notification response handler extended to navigate to post on `community_like`/`community_comment` taps, and to actor's profile on `community_follow` tap
- `components/ui/NotificationSettings.tsx` — new "Community" section with Heart icon toggle, reads/writes `profiles.community_notifications` via Supabase; loading spinner during save; `profile` added to `useEffect` dependency array so preference syncs correctly after profile loads
- All 10 locale files updated with `communityNotifications` and `communityNotificationsDesc` keys
- TypeScript check: no new errors introduced (Deno edge function errors are identical pre-existing pattern across all functions)

## Notes
- The Expo Push API (`exp.host/--/api/v2/push/send`) does not require auth for basic usage — no new secrets needed.
- `community_notifications` is stored in `profiles` (not AsyncStorage) so the server can check it. The toggle in the UI writes directly to Supabase.
- Push notification text is English-only (server-side). Localising server push content would require storing each user's language preference, which is not in scope.
- The `notify-community` function uses `SUPABASE_SERVICE_ROLE_KEY` (automatically injected by Supabase into all edge functions) to read any user's `push_token` and `community_notifications` — bypassing RLS, which is correct for server-to-server lookups.
- `sendCommunityNotification` is truly fire-and-forget: it does not `await` the `fetch()`. If the network is unavailable, the notification is simply not sent — this is acceptable for a social notification feature.
- `DeviceNotRegistered` errors from Expo are logged server-side but not surfaced to the client. A future improvement could clear stale push tokens from the DB when this error occurs.
- The `commentText` in the comment payload is the raw text from the client — the edge function truncates it to 80 characters for the preview. This is acceptable as it's just a display string, not trusted data.

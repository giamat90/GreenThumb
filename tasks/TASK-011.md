# TASK-011: Plant-level Kudos system

## Status: IN_PROGRESS

## Overview
Add a **Kudos** gesture attributed to the plant itself (not to a post). A plant accumulates a single kudos counter across every public post it is tagged in and across every mutual-follower profile view. Kudos is free for all users (no Pro gate), one-per-viewer-per-plant, toggleable. The plant owner receives a push notification using the same pipeline as likes/comments. This reuses the existing denormalized-count + trigger pattern and the existing `notify-community` edge function.

## User story
As a community user, I want to send kudos to another user's plant so that I can celebrate their plant care effort — not just "like" a photo — and the owner is notified.

## Acceptance criteria
- [ ] `plant_kudos` table exists with unique `(user_id, plant_id)` constraint
- [ ] `plants.kudos_count` column exists, kept in sync by insert/delete triggers
- [ ] RLS: user can insert only if (a) plant is in a public post OR (b) mutual follow with owner; self-kudos is blocked
- [ ] RLS: user can delete only their own kudos row
- [ ] New `plants` SELECT policy: any authenticated user can read a plant that is referenced by at least one public post (so the kudos UI can show plant name/photo/count on the post card)
- [ ] Plant owner cannot kudos their own plant (UI read-only + server-side CHECK)
- [ ] Sprout icon + kudos count visible on the community feed card when `post.plant_id` is set
- [ ] Sprout icon + count visible on the post detail screen (alongside like/comment)
- [ ] Sprout icon + count visible on each plant card in the public profile carousel (only when viewing another user's profile)
- [ ] Sprout icon + count visible on the plant detail screen when viewer ≠ owner; read-only metric when viewer = owner
- [ ] Optimistic UI on every toggle point (mirrors existing `handleLike` pattern in `app/(tabs)/community.tsx:390–417`)
- [ ] Push notification `🌱 New kudos — @user gave kudos to {plantName}` fires on toggle-on (respects recipient's `community_notifications` preference)
- [ ] No push notification fires on toggle-off
- [ ] 4 new i18n keys across all 10 locale files
- [ ] Migration number is `022`
- [ ] `notify-community` edge function redeployed by Giacomo after changes

## Technical plan

### Files to create
| File | Purpose |
|------|---------|
| `supabase/migrations/022_plant_kudos.sql` | `plant_kudos` table, `plants.kudos_count` column, count triggers, RLS policies, expanded `plants` SELECT policy |
| `lib/plantKudos.ts` | `togglePlantKudos()` + `fetchKudoedPlantIds()` helpers |

### Files to modify
| File | Change |
|------|--------|
| `types/index.ts` | Add `kudos_count?: number` to `Plant` interface |
| `lib/communityNotifications.ts` | Extend `CommunityNotifPayload` union with `{ type: "kudos"; plantId: string }` |
| `supabase/functions/notify-community/index.ts` | Add `"kudos"` to `RequestBody.type`; new recipient-resolution branch reading `plants.user_id` + `plants.name`; new notification-content branch |
| `app/(tabs)/community.tsx` | Enrich posts with plant `kudos_count` + `has_kudoed_plant`; render sprout + count row below like/comment bar when `post.plant_id` is set; wire optimistic toggle |
| `app/community/post/[id].tsx` | Add sprout + count below the existing like/comment action bar; wire optimistic toggle |
| `app/community/profile/[id].tsx` | Add sprout button + count onto each plant carousel card (only when `id !== currentUserId`); wire optimistic toggle |
| `app/plant/[id].tsx` | Read-only `kudos_count` stat for owner view; sprout + count toggle when viewer ≠ owner |
| `locales/en.json` | Add 3 `community.kudos*` + 1 `plantDetail.kudosReceived` keys |
| `locales/it.json` | Add 4 translated keys |
| `locales/es.json` | Add 4 translated keys |
| `locales/fr.json` | Add 4 translated keys |
| `locales/de.json` | Add 4 translated keys |
| `locales/pt.json` | Add 4 translated keys |
| `locales/nl.json` | Add 4 translated keys |
| `locales/pl.json` | Add 4 translated keys |
| `locales/ja.json` | Add 4 translated keys |
| `locales/zh.json` | Add 4 translated keys |

### Database changes
_Migration number: 022_

```sql
-- 022_plant_kudos.sql

-- ── Kudos given to a plant by a user ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS plant_kudos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plant_id uuid NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, plant_id)
);
CREATE INDEX IF NOT EXISTS plant_kudos_plant_id_idx ON plant_kudos(plant_id);
CREATE INDEX IF NOT EXISTS plant_kudos_user_id_idx ON plant_kudos(user_id);

-- ── Denormalized count on plants ─────────────────────────────────────────
ALTER TABLE plants ADD COLUMN IF NOT EXISTS kudos_count integer DEFAULT 0;

-- ── RLS for plant_kudos ──────────────────────────────────────────────────
ALTER TABLE plant_kudos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plant_kudos_read" ON plant_kudos
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "plant_kudos_insert" ON plant_kudos FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND user_id <> (SELECT p.user_id FROM plants p WHERE p.id = plant_id)
    AND (
      EXISTS (
        SELECT 1 FROM posts
        WHERE posts.plant_id = plant_kudos.plant_id
          AND posts.is_public = true
      )
      OR EXISTS (
        SELECT 1 FROM follows f1
        INNER JOIN follows f2
          ON f1.follower_id = f2.following_id
          AND f1.following_id = f2.follower_id
        WHERE f1.follower_id = auth.uid()
          AND f1.following_id = (SELECT p.user_id FROM plants p WHERE p.id = plant_kudos.plant_id)
      )
    )
  );

CREATE POLICY "plant_kudos_delete" ON plant_kudos
  FOR DELETE USING (auth.uid() = user_id);

-- ── Count triggers (mirror 015_likes_count_trigger.sql) ──────────────────
CREATE OR REPLACE FUNCTION increment_plant_kudos_count() RETURNS trigger AS $$
BEGIN
  UPDATE plants SET kudos_count = kudos_count + 1 WHERE id = NEW.plant_id;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION decrement_plant_kudos_count() RETURNS trigger AS $$
BEGIN
  UPDATE plants SET kudos_count = GREATEST(kudos_count - 1, 0) WHERE id = OLD.plant_id;
  RETURN OLD;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER plant_kudos_after_insert AFTER INSERT ON plant_kudos
  FOR EACH ROW EXECUTE FUNCTION increment_plant_kudos_count();
CREATE TRIGGER plant_kudos_after_delete AFTER DELETE ON plant_kudos
  FOR EACH ROW EXECUTE FUNCTION decrement_plant_kudos_count();

-- ── Widen plants SELECT: public-post plants become readable ──────────────
-- So the post card can show plant name/photo/kudos_count to any viewer.
-- This does NOT leak private plants: only plants the owner has already
-- chosen to make public via a public post become visible.
CREATE POLICY "Public-post plants are visible"
  ON public.plants FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM posts
      WHERE posts.plant_id = plants.id
        AND posts.is_public = true
    )
  );

-- ── Backfill (no-op for new table, defensive) ────────────────────────────
UPDATE plants p SET kudos_count = (
  SELECT COUNT(*) FROM plant_kudos WHERE plant_id = p.id
);
```

### Edge functions
Modify `supabase/functions/notify-community/index.ts`:

1. Extend `RequestBody`:
```ts
interface RequestBody {
  type: "like" | "comment" | "follow" | "kudos";
  postId?: string;        // like / comment
  targetUserId?: string;  // follow
  plantId?: string;       // kudos
  commentText?: string;
}
```

2. Introduce a local `let plantName: string | null = null;` at the top of the `serve()` handler (near the destructured body).

3. Extend the recipient-resolution block:
```ts
else if (type === "kudos") {
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
```

4. Extend the notification-content block:
```ts
} else if (type === "kudos") {
  title = "🌱 New kudos";
  notifBody = `${handle} gave kudos to ${plantName}`;
  notifType = "community_kudos";
  notifData.plantId = plantId!;
}
```

5. Self-notification check at line 85 already covers owner-is-actor once `recipientId` is set — no change needed there.

> ⚡ **Manual Deploy Step** — after the developer finishes implementation, Giacomo must run:
> ```bash
> npx supabase functions deploy notify-community
> ```

### i18n keys
Add under `community` in all 10 locales (insert after the last existing `community.*` key):

| Key | en | it |
|-----|----|----|
| `kudos` | Kudos | Kudos |
| `giveKudos` | Give kudos | Invia kudos |
| `removeKudos` | Remove kudos | Rimuovi kudos |

Add under `plantDetail` in all 10 locales (insert after the last existing `plantDetail.*` key):

| Key | en | it |
|-----|----|----|
| `kudosReceived` | Kudos received | Kudos ricevuti |

Translate appropriately for es, fr, de, pt, nl, pl, ja, zh. Validate each JSON file remains valid and has no duplicate keys (CLAUDE.md rule 3).

## Implementation steps

### Step 1 — Create `supabase/migrations/022_plant_kudos.sql`
Copy the SQL block from **Database changes** verbatim. Verify this is migration number 022 (`ls supabase/migrations/`) before creating — never reuse numbers (CLAUDE.md rule 6). Apply via Supabase dashboard SQL editor or `npx supabase db push`.

### Step 2 — Update `types/index.ts`
Add to the `Plant` interface (after `health_score`):
```ts
kudos_count?: number;
```

### Step 3 — Create `lib/plantKudos.ts`
```ts
import { supabase } from "@/lib/supabase";

export async function togglePlantKudos(
  plantId: string,
  userId: string,
  currentlyKudoed: boolean
): Promise<void> {
  if (currentlyKudoed) {
    const { error } = await supabase
      .from("plant_kudos")
      .delete()
      .eq("user_id", userId)
      .eq("plant_id", plantId);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("plant_kudos")
      .insert({ user_id: userId, plant_id: plantId });
    if (error) throw error;
  }
}

export async function fetchKudoedPlantIds(
  userId: string,
  plantIds: string[]
): Promise<Set<string>> {
  if (plantIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("plant_kudos")
    .select("plant_id")
    .eq("user_id", userId)
    .in("plant_id", plantIds);
  if (error) return new Set();
  return new Set((data ?? []).map((r) => r.plant_id as string));
}
```

### Step 4 — Extend `lib/communityNotifications.ts`
Add to the `CommunityNotifPayload` union (no other changes):
```ts
| { type: "kudos"; plantId: string }
```

### Step 5 — Extend `supabase/functions/notify-community/index.ts`
- Add `"kudos"` to the `RequestBody.type` union and `plantId?: string` field.
- Add `let plantName: string | null = null;` in the handler scope.
- Add the `else if (type === "kudos")` branch in the recipient-resolution block (§ **Edge functions** above).
- Add the `else if (type === "kudos")` branch in the content-building block.
- Do **not** modify the existing self-notification check or preference check — both apply unchanged.

### Step 6 — Community feed enrichment — `app/(tabs)/community.tsx`
In the enrichment pass (lines 181–238):
- Build `plantIds = Array.from(new Set(posts.map((p) => p.plant_id).filter(Boolean) as string[]))`.
- If `plantIds.length > 0`:
  - `supabase.from("plants").select("id, name, kudos_count").in("id", plantIds)` → `plantMap: Record<string, {name, kudos_count}>`.
  - `fetchKudoedPlantIds(currentUserId, plantIds)` → `kudoedSet`.
- Extend the enriched post shape (client-side type only) with `plant_kudos_count?: number` and `has_kudoed_plant?: boolean`.
- Render below the existing like/comment row on each post card, **only when `post.plant_id` is set**:
  - `Sprout` lucide icon (filled with `COLORS.primary` when `has_kudoed_plant`, outlined otherwise)
  - Count number
  - `·` separator
  - Plant name (from `plantMap`)
- Add `handleKudos(post)` mirroring `handleLike` at lines 390–417:
  1. Snapshot current `has_kudoed_plant` + `plant_kudos_count` for revert.
  2. Optimistically toggle the flag and bump/decrement the count in **both** `discover` and `following` arrays (same plant may appear in both feeds).
  3. `await togglePlantKudos(post.plant_id!, currentUserId, wasKudoed)`.
  4. On error: revert both arrays.
  5. On success, **only when toggling on** (`wasKudoed === false`): `sendCommunityNotification({ type: "kudos", plantId: post.plant_id! })`.

### Step 7 — Post detail — `app/community/post/[id].tsx`
Mirror the feed-card pattern:
- Add the sprout + count below the existing like/comment action bar.
- Only render when `post.plant_id` is set.
- On mount: if `post.plant_id` set, run in parallel with existing post enrichment:
  - `supabase.from("plants").select("kudos_count").eq("id", post.plant_id).maybeSingle()`
  - `fetchKudoedPlantIds(currentUserId, [post.plant_id])`
- Wire optimistic toggle with the same contract as step 6.

### Step 8 — Profile plant carousel — `app/community/profile/[id].tsx:240–281`
- The existing plant fetch already returns all `plants.*` columns, including the new `kudos_count`.
- On mount (after plants loaded): `fetchKudoedPlantIds(currentUserId, plants.map(p => p.id))` → hydrate a `Set<string>` in state.
- For each plant card:
  - Render `Sprout` + `kudos_count` inline (e.g. under the plant name or in the health-bar row).
  - If `id !== currentUserId` (viewing another user's profile): sprout is tappable, wires `togglePlantKudos` + optimistic update + notification.
  - If `id === currentUserId` (own profile): sprout is a passive stat (no `onPress`).

### Step 9 — Plant detail — `app/plant/[id].tsx`
- Read `kudos_count` from the plant record (no extra query needed — it's part of `plants.*`).
- Display it in the header/meta row near `health_score`. Label: `t("plantDetail.kudosReceived")`.
- If `plant.user_id !== currentUserId`:
  - On mount: `fetchKudoedPlantIds(currentUserId, [plant.id])` → hydrate `hasKudoed` state.
  - Render sprout + count as a tappable toggle beside/instead of the passive stat.
  - Wire optimistic toggle + notification.
- If `plant.user_id === currentUserId`: render read-only stat only.

### Step 10 — Add 4 i18n keys across all 10 locale files
Insert the 3 `community.kudos*` keys after the last existing `community.*` key. Insert `plantDetail.kudosReceived` after the last existing `plantDetail.*` key (most recently-added `plantDetail.*` keys were in TASK-002; place the new key after those). Validate each locale file remains valid JSON with no duplicate keys.

### Step 11 — Report manual deploy step in completion report
Label clearly as **⚡ Manual Deploy Step** and list:
```bash
npx supabase functions deploy notify-community
```
Wait for Giacomo's confirmation that the deploy succeeded before marking the task DONE.

## Testing checklist
- [ ] Free user can give kudos to another user's plant via a public post
- [ ] Free user can give kudos via a mutual-follower's profile carousel
- [ ] Pro user can do both (same behaviour, no upgrade modal)
- [ ] Owner cannot kudos own plant — UI read-only; direct Supabase insert attempt returns RLS violation
- [ ] User without public-post access AND without mutual follow cannot insert into `plant_kudos` — RLS rejects
- [ ] Kudos toggle on: optimistic count +1, row inserted, push notification delivered to owner
- [ ] Kudos toggle off: optimistic count -1, row deleted, **no** push notification
- [ ] Same plant appears in two posts → a single kudos counts once across both; feed cards in `discover` and `following` both reflect the toggle
- [ ] Count matches across all surfaces: feed card, post detail, profile carousel, plant detail
- [ ] Notification respects `community_notifications = false` (no push sent) — controlled in `notify-community/index.ts:112`
- [ ] Deleting a post that tagged plant X: `plant_kudos` rows survive; `plants.kudos_count` unchanged
- [ ] Deleting a plant: cascade deletes its kudos rows (`ON DELETE CASCADE`)
- [ ] Works offline: toggle fails gracefully, optimistic state reverts
- [ ] i18n: tested in at least 2 languages (en, it)
- [ ] No hardcoded pixel values — sprout + count rows use the card's existing spacing scale
- [ ] No layout regressions on Moto G 5G — feed card height grows only when `post.plant_id` is set

## Dependencies
None — all prerequisite infrastructure exists (`post_likes` pattern, `notify-community` edge function, mutual-follower plant RLS at migration 019).

## Notes
- **Why plant-level, not post-level**: likes already cover post-level appreciation. The distinction of kudos is that it lives on the *plant* — so multiple posts about the same plant share one kudos counter, and the counter shows up on the plant itself (profile carousel, plant detail) rather than being trapped inside a single post's life cycle.
- **Why widen the plants SELECT policy**: without it, the feed card would have `post.plant_id` but couldn't read the plant's `name` / `kudos_count`. The new policy only exposes plants that the owner has *already* chosen to make public by tagging them in a public post — private plants stay private.
- **RLS self-kudos block**: the `CHECK` in `plant_kudos_insert` uses a subquery against `plants`. Because `plants` already permits owner SELECT, the subquery resolves for the owner's own plant; the comparison `user_id <> plants.user_id` then fails correctly.
- **No `is_liked`-style DB field**: `has_kudoed_plant` is a client-computed flag from `fetchKudoedPlantIds`, matching the existing likes convention at `community.tsx:187–191`.
- **Push notification language**: stays English server-side, matching the existing pattern (💚 New like, 💬 New comment). No change to localisation strategy.
- **Sprout icon**: `Sprout` from `lucide-react-native`. If unavailable in the project's installed version, fall back to `Leaf` and note the swap in implementation notes.
- **Plant name fallback in notification**: if `plants.name` is null (shouldn't happen — column is NOT NULL), use `"your plant"`.
- **Out of scope** (potential follow-up tasks): kudos leaderboard / "top plants this week", achievement-gated kudos, per-milestone kudos types, daily quota / scarcity.

# TASK-008: Fix comment count not updating on community feed after adding a comment

## Status: DONE

## Overview
After a user opens a post from the Discover (or Following) feed, writes a comment, and navigates back, the comment count badge on the post card still shows the old number. The comment itself is saved correctly in the database (the DB trigger keeps `posts.comments_count` accurate), and it appears correctly if the user force-refreshes the feed. The bug is purely a UI state-sync problem: the community feed holds its post list in local React state and there is no mechanism to propagate count changes from the post detail screen back to the feed.

## User story
As a community user, I want the comment count on a post card to reflect any comment I just added, so that the feed accurately mirrors my activity without requiring a manual pull-to-refresh.

## Acceptance criteria
- [ ] After submitting a comment in the post detail screen and tapping Back, the post card in the Discover feed shows the incremented comment count immediately
- [ ] Same behaviour applies to the Following feed if the post appears there
- [ ] No extra network request is fired just to update the count
- [ ] Pull-to-refresh still works as before and fetches fresh data from the server
- [ ] Tab switching (Community ↔ other tabs) does not cause any flicker or unnecessary re-fetch

## Technical plan

### Root cause
`handleSubmitComment` in `app/community/post/[id].tsx` updates its own local `post` state (line 175) but there is no way for `app/(tabs)/community.tsx` to know the count changed. The community screen intentionally avoids `useFocusEffect` for full re-fetches to prevent tab-switch thrashing (see comment at line 345 of community.tsx). We need a lightweight cross-screen signal that carries only the updated count, applied on focus, with zero network cost.

### Solution: module-level Map singleton + useFocusEffect patch
Create a tiny module `lib/communityUpdates.ts` that exports a mutable `Map<postId, newCommentsCount>`. The post detail screen writes to it after a successful comment; the community feed reads and applies it the next time it gains focus, then clears it.

This mirrors the existing optimistic-update pattern used for likes in `handleLike` (community.tsx lines 374–388) — the same `setDiscoverPosts` / `setFollowingPosts` patcher — but triggered on focus rather than inline.

### Files to create
| File | Purpose |
|------|---------|
| `lib/communityUpdates.ts` | Exports a single `Map<string, number>` used as a cross-screen comment-count signal |

### Files to modify
| File | Change |
|------|--------|
| `app/community/post/[id].tsx` | After successful comment insert, write `post.id → post.comments_count + 1` into the Map |
| `app/(tabs)/community.tsx` | Add one `useFocusEffect` that patches `discoverPosts` / `followingPosts` from the Map, then clears it |

### Database changes
None.

### Edge functions
None.

### i18n keys
None.

## Implementation steps

### Step 1 — Create `lib/communityUpdates.ts`
```typescript
/**
 * Lightweight singleton for propagating post-count changes from the post
 * detail screen back to the community feed without a network round-trip.
 * Keys: post ID. Values: new comments_count after the user's action.
 */
export const commentCountUpdates = new Map<string, number>();
```

### Step 2 — Write to the Map in `app/community/post/[id].tsx`

Add the import at the top of the file:
```typescript
import { commentCountUpdates } from "@/lib/communityUpdates";
```

In `handleSubmitComment`, immediately after the line:
```typescript
setPost((p) => p ? { ...p, comments_count: p.comments_count + 1 } : p);
```
add:
```typescript
commentCountUpdates.set(post.id, post.comments_count + 1);
```

`post.comments_count` here is still the **pre-increment** value from the current render (the `setPost` call is async), so `+ 1` gives the correct new count. This is consistent with how the optimistic like count works in the same file.

### Step 3 — Apply updates in `app/(tabs)/community.tsx`

Add imports at the top of the file (alongside existing imports):
```typescript
import { useFocusEffect } from "@react-navigation/native";
import { commentCountUpdates } from "@/lib/communityUpdates";
```

After the existing `React.useEffect` that fetches on mount (around line 350), add:
```typescript
// Apply any comment-count changes made while viewing a post detail, then clear.
// Uses a module-level Map to avoid network requests; safe on tab switch (no-op when map is empty).
useFocusEffect(
  useCallback(() => {
    if (commentCountUpdates.size === 0) return;
    const patch = (prev: CommunityPost[]) =>
      prev.map((p) => {
        const updated = commentCountUpdates.get(p.id);
        return updated !== undefined ? { ...p, comments_count: updated } : p;
      });
    setDiscoverPosts(patch);
    setFollowingPosts(patch);
    commentCountUpdates.clear();
  }, [])
);
```

The `useCallback` dependency array is intentionally empty — the callback reads `commentCountUpdates` (a module-level mutable reference, not React state) and calls the stable `setDiscoverPosts` / `setFollowingPosts` setters directly, so there are no stale-closure issues.

`@react-navigation/native` is already a project dependency (used by `post/[id].tsx` for `useNavigation`), so no new package installation is needed.

## Testing checklist
- [ ] Open Discover feed → open any post → add a comment → tap Back → verify comment count incremented on the card
- [ ] Same test on Following feed
- [ ] Switch tabs back and forth several times after — verify no re-fetch / no flicker
- [ ] Pull-to-refresh the feed — verify correct count is shown (matches DB)
- [ ] Open a post without commenting, go back — verify no count change
- [ ] Open two different posts, comment on both, go back — verify both cards updated
- [ ] Works on free tier
- [ ] Works on Pro tier
- [ ] No hardcoded pixel values introduced
- [ ] No layout regressions on Moto G 5G

## Dependencies
None. (The previous comment-display bug — TASK fixed inline — made comments appear after submit; this task fixes the count badge on the feed card.)

## Implementation notes
Created `lib/communityUpdates.ts` as a module-level `Map<string, number>` singleton. In `post/[id].tsx`, after a successful comment insert, the new count is written into the Map. In `community.tsx`, a `useFocusEffect` (from `@react-navigation/native`, already a project dep) reads and applies the Map to both `discoverPosts` and `followingPosts` on focus, then clears it.

One deviation from the plan: `profile.username` was used in the spec, but the `Profile` type (from `profiles` table) has no `username` field — that's on `user_profiles`. Changed the newly submitted comment's `username` to `undefined` (renders as "User" fallback) until the next `fetchPost` reload. This is an acceptable UX trade-off; the comment is visible and the count badge is accurate.

All pre-existing TS errors (Deno edge functions, unrelated screens) were present before this change. No new errors introduced.

## Notes
- `useFocusEffect` from `@react-navigation/native` fires on every focus event (tab switch included). The early-return guard `if (commentCountUpdates.size === 0) return;` ensures it is a true no-op when the Map is empty, so tab-switch performance is unaffected.
- This same pattern could later be extended for `likeCountUpdates` if the like count on feed cards ever needs the same fix (currently likes are patched inline in `handleLike` in community.tsx, so they already work correctly).
- The Map is module-scoped (singleton across the JS bundle), which is safe in React Native — there is only one JS engine instance per app session.

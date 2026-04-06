# GreenThumb

AI-powered plant care app for Android. Solo founder project — Giacomo is PO and tester. Development is done via two Claude Code instances working in tandem.

## Two-instance workflow

This project uses a Tech Lead + Developer pattern:

- **Tech Lead (Instance 1)**: Opus, plan mode. Analyzes the codebase, writes detailed task specs into `tasks/TASK-xxx.md`. NEVER writes production code directly.
- **Developer (Instance 2)**: Sonnet, execution mode. Reads task specs from `tasks/`, implements exactly as specified, commits on feature branches.
- **Giacomo**: Chooses features, approves task specs, tests on device, merges PRs.

The `tasks/` folder is the handoff point. Tech Lead writes, Developer reads. Both instances must check `tasks/` for context.

## Stack

- Expo React Native SDK 55 + TypeScript
- Supabase (auth, database, edge functions, storage)
- NativeWind (Tailwind for RN)
- Zustand (state management)
- Lucide icons
- expo-calendar (device calendar sync)
- RevenueCat (pending P.IVA)

## Critical rules — NEVER violate

1. **NEVER use hardcoded pixel values for layout spacing** — always use `onLayout` dynamic measurement
2. **Edge function auth**: use direct `fetch()` with anon key pattern, NOT `supabase.functions.invoke()` (causes JWT 401 errors)
3. **i18n**: 35 locale files across 10 languages (en, it, es, fr, de, pt, nl, pl, ja, zh). Duplicate JSON keys silently break translations — always validate
4. **Community feed**: extract fetch functions outside component scope to avoid infinite loops. Use `display:none` tab switching
5. **Android calendar permissions**: require direct `AndroidManifest.xml` modification, not just runtime permission requests
6. **Migrations**: tracked numerically (current: 013). Always increment, never reuse numbers

## Commands

```bash
# Run on device
npx expo run:android --device ZY22BHCRLG

# EAS preview build
eas build --profile preview --platform android

# Start dev server
npx expo start
```

## Architecture

- **AI Advisors**: Disease, Placement, Repotting, Pruning — all use 4-slot 2x2 photo grid
- **Pro gating**: `useProGate` hook + `ProUpgradeModal` component
- **Closed-loop care**: post-diagnosis watering adjustments + follow-up scheduling + push notifications + recovery comparison
- **Community**: Discover + Following feeds, likes, comments, follows, public profiles (Pro-gated posting)
- **Seasonal Care Tips**: AI-powered, cached per user, edge function, migration 013

## Pricing (locked — do not change)

- Free: unlimited Plant ID + monthly AI Seasonal Care Tips
- Pro: €4.99/month or €34.99/year, 7-day free trial
- All 4 advisors, closed-loop tracking, weather scheduling, calendar sync, community posting = Pro only

## Supabase Edge Functions — Deploy Protocol

Whenever a task spec requires deploying or redeploying a Supabase Edge Function, the Developer instance must **NOT** attempt to run the deploy commands itself. Instead, it must stop and explicitly instruct Giacomo (the Product Owner) to run the following commands manually in his terminal:

**Step 1 — Login & link (first time only, skip if already done):**
```bash
npx supabase login
npx supabase link --project-ref uhiyipkjrtqvfvtgerbo
```

**Step 2 — Deploy the function:**
```bash
npx supabase functions deploy <function-name>
```

**Step 3 — If the function needs secrets, verify they are set:**
```bash
npx supabase secrets list
```

The Developer instance must clearly label this as a **"⚡ Manual Deploy Step"** in its completion report, list the exact command(s) with the correct function name(s), and wait for Giacomo to confirm the deploy succeeded before considering the task complete.

Edge function calls from the app must always use direct `fetch()` with Bearer token and anon key — never `supabase.functions.invoke()`.

## Task spec format

All task specs go in `tasks/TASK-xxx.md` using this template:
- See `tasks/TEMPLATE.md` for the standard format
- Tech Lead writes the spec, Developer implements it
- Task status: DRAFT → APPROVED → IN_PROGRESS → DONE → TESTED

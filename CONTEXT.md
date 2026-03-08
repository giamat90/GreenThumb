# GreenThumb — Project Context

## Tech Stack
- **Framework**: Expo (React Native) with Expo Router
- **Backend**: Supabase (auth, database, edge functions)
- **Payments**: RevenueCat (react-native-purchases)
- **AI / Plant ID**: Plant.id API + Anthropic Claude (via Supabase Edge Functions)
- **Weather**: OpenWeatherMap API
- **Styling**: NativeWind (Tailwind for RN) + StyleSheet
- **State**: Zustand (`store/plants.ts`, `store/user.ts`)
- **Build**: EAS Build (Expo Application Services)

## Package / Bundle IDs
- Android package: `com.giamat90.greenthumb`
- iOS bundle ID: `com.giamat90.greenthumb`

## Key Files
| File | Purpose |
|------|---------|
| `app.json` | Expo config — package names, plugins, permissions |
| `eas.json` | EAS Build profiles (development / preview / production) |
| `lib/revenuecat.ts` | RevenueCat init + purchase helpers |
| `store/plants.ts` | Zustand plant store |
| `store/user.ts` | Zustand user / subscription store |
| `constants/index.ts` | COLORS, CONFIG, PLANT_LIMITS |
| `types/index.ts` | Shared TypeScript types |
| `google-services.json` | Firebase / Google services config (Android) |
| `eas-secrets-instructions.md` | How to upload env vars to EAS cloud builds |

## Status Checklist
- [x] Expo + Supabase auth wired up
- [x] Plant identification (Plant.id API via Edge Function)
- [x] Plant detail + watering tracking
- [x] AI diagnosis screen
- [x] Care Calendar (grouped by urgency)
- [x] Paywall / RevenueCat built
- [x] EAS Build + Google Play submission ← currently working on this

## EAS Build Commands
```sh
# Install EAS CLI (once)
npm install -g eas-cli

# Login (once)
npx eas login

# Upload env secrets (once — see eas-secrets-instructions.md)
npx eas secret:create ...

# Preview APK (test on real device via direct install)
npx eas build --platform android --profile preview

# Production AAB (for Google Play submission)
npx eas build --platform android --profile production

# Submit to Google Play (after production build)
npx eas submit --platform android --profile production
```

## Google Play Submission Checklist

### One-time account setup
- [ ] Create Google Play Developer Account at play.google.com/console
- [ ] Pay $25 one-time registration fee
- [ ] Wait 1–2 days for account approval

### Create the app
- [ ] New app → "GreenThumb", package: `com.giamat90.greenthumb`
- [ ] Short description (≤80 chars): `AI plant care: identify, diagnose & water your plants smartly`
- [ ] Full description (≤4000 chars)
- [ ] ≥2 phone screenshots
- [ ] Feature graphic: 1024×500 px
- [ ] App icon: 512×512 px PNG

### Compliance
- [ ] Content rating questionnaire (should be "Everyone")
- [ ] Privacy policy URL (required — permissions requested)
  - Free generator: https://app-privacy-policy.com
- [ ] Data safety form (camera, location, purchase data)

### Billing / RevenueCat
- [ ] Google Play Console → Monetization → Subscriptions
  - Create `greenthumb_pro_monthly` ($4.99/month)
  - Create `greenthumb_pro_annual` ($34.99/year)
- [ ] RevenueCat dashboard → Apps → New app → Google Play
  - Package: `com.giamat90.greenthumb`
  - Link Google Play service account (download JSON → `google-play-service-account.json`)
- [ ] Update RevenueCat Android key in EAS secrets

### Release
- [ ] Upload production .aab from EAS build
- [ ] Start with Internal Testing track, promote to Production

## Assets Status
All required assets present in `assets/images/`:
- `icon.png` — app icon
- `android-icon-foreground.png` — adaptive icon foreground
- `android-icon-background.png` — adaptive icon background
- `android-icon-monochrome.png` — adaptive icon monochrome
- `splash-icon.png` — splash screen
- `favicon.png` — web favicon

## i18n Rules

GreenThumb uses **i18next + react-i18next** with `expo-localization` for device language detection.

- **Supported languages**: en, it, es, fr, de, pt, nl, pl, ja, zh
- **Config**: `lib/i18n.ts` — imports all locales, sets `compatibilityJSON: 'v3'`
- **Device language**: `deviceLanguage()` exported from `lib/i18n.ts` — use when passing `language` to edge functions
- **Locale files**: `locales/{lang}.json` — all 10 files must be kept in sync

### Rules for screens

1. **Always** `import { useTranslation } from "react-i18next"` and call `const { t } = useTranslation()` inside the function component.
2. **Never** call `t()` at module level — it must be called inside a component or hook.
3. **Module-level constants** that contain UI strings must be moved inside the component, or use a `labelKey` approach (store translation key strings, call `t(key)` at render time).
4. **Add `t` to `useCallback` dependency arrays** where `t()` is called inside the callback.
5. **Loop variables** must never shadow `t`. If mapping an array: use a different variable name (e.g. `item`, `entry`, `fType`).
6. **Class components** (e.g. `ErrorBoundary`) cannot use hooks — skip them or hardcode English only.

### Rules for edge function calls

- Always pass `language: deviceLanguage()` in the fetch body to Anthropic-powered edge functions.
- Edge function system prompts must include: `(body.language && body.language !== "en" ? \`\n\nIMPORTANT: Write all text values in your JSON response in ${body.language} language.\` : "")`.
- Plant.id API: pass `language` as a URL query param via `&language=<lang>` (not in the body).

### What to translate

- All user-visible text in JSX: labels, placeholders, alert titles/messages, button text, section headers, empty states.
- `accessibilityLabel` props are lower priority but should use `t()` where the text matches a button label.

### What NOT to translate

- API values sent to edge functions (e.g. OBSERVED_SIGNS array items, `growthStage` values — these are English prompts for the AI).
- Technical botanical terms used as both API values and UI labels (e.g. "dormant", "growing") — acceptable to leave in English.
- Class component hardcoded strings (`ErrorBoundary`).

## Layout Rules

**Never use hardcoded pixel values for layout spacing.** Always use dynamic measurement (`onLayout`), relative values, or safe area insets. This applies especially to sticky bottom bars overlapping scroll content — measure the bar's rendered height via `onLayout` and use that value for the ScrollView's `paddingBottom`.

## Diagnosis Closed-Loop Care Rules

After any diagnosis completes (fresh result, not viewing existing), always offer:
1. **Watering adjustment** — detect underwatering/overwatering keywords in condition+description, suggest interval change, apply via `care_profile.watering_interval_days`
2. **Follow-up scheduling** — suggest a follow-up date (3/7/14 days based on severity), schedule a push notification via `scheduleFollowUpDiagnosisNotification()`

`handleSave` in `diagnosis/[id].tsx` must persist to Supabase `diagnoses` table including `follow_up_date`, `watering_adjusted`, `watering_adjustment_days`.

When a follow-up notification is tapped, navigate to `/diagnosis/[id]` with params `isFollowUp=true` and `previousCondition=<condition>` to show the recovery comparison banner.

## RevenueCat Notes
- RevenueCat is **only initialised in `__DEV__` builds**. Preview/production builds skip it entirely to avoid fatal crashes from Test Store keys.
- In non-dev builds: `checkSubscriptionStatus` → `'free'`, `getOfferings` → `null`, `purchasePackage` → shows "Coming Soon" alert, `restorePurchases` → `false`.
- Production keys + full purchase flow will work once a real Google Play app is linked in the RevenueCat dashboard.
- Entitlement ID: `pro`

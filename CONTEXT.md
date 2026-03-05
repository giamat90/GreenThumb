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

## RevenueCat Notes
- RevenueCat is **only initialised in `__DEV__` builds**. Preview/production builds skip it entirely to avoid fatal crashes from Test Store keys.
- In non-dev builds: `checkSubscriptionStatus` → `'free'`, `getOfferings` → `null`, `purchasePackage` → shows "Coming Soon" alert, `restorePurchases` → `false`.
- Production keys + full purchase flow will work once a real Google Play app is linked in the RevenueCat dashboard.
- Entitlement ID: `pro`

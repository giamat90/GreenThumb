# 🌿 GreenThumb

AI-powered plant care assistant for iOS and Android. Point your camera at any plant, get instant identification, and receive a personalized care plan — watering schedules, light requirements, and disease diagnosis — all in one app.

---

## Features

- **Plant Identification** — Camera-based AI identification via Plant.id v3. Returns common name, scientific name, confidence score, and care profile.
- **Smart Watering Scheduler** — Weather-aware watering predictions using OpenWeatherMap. Adjusts for temperature, humidity, season, pot size, and location.
- **Disease Diagnosis** — AI-powered photo analysis via Claude to detect plant health issues before they become critical.
- **Care Calendar** — Scheduled reminders for watering, fertilizing, repotting, and pruning.
- **Free / Pro tiers** — 5 identifications/month free; unlimited with Pro ($4.99/month or $34.99/year via RevenueCat).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Expo SDK 55 (managed workflow) |
| Language | TypeScript (strict mode) |
| Navigation | Expo Router v55 (file-based, typed routes) |
| Styling | NativeWind v4 + Tailwind CSS v3 |
| State | Zustand v5 |
| Backend | Supabase (Postgres + Auth + Storage + Edge Functions) |
| Plant ID | Plant.id API v3 |
| Weather | OpenWeatherMap API |
| AI Advice | Anthropic Claude API |
| Payments | RevenueCat |

---

## Project Structure

```
app/
  (auth)/           # Login, signup, forgot password, onboarding
  (tabs)/
    index.tsx       # Home dashboard
    identify.tsx    # Camera + AI plant identification
    my-plants.tsx   # Plant collection
    calendar.tsx    # Care calendar
    profile.tsx     # Settings & subscription
  paywall.tsx       # Pro upgrade screen

components/
  ui/               # Generic reusable components
  plants/           # Plant-specific components
  camera/           # Camera and image components

lib/
  supabase.ts       # Supabase client
  plantid.ts        # Plant.id Edge Function wrapper
  imageUtils.ts     # Image compression (expo-image-manipulator)

hooks/
  useCamera.ts              # Camera permission hook

store/
  plants.ts         # Zustand plant collection store
  user.ts           # Zustand user/profile store

supabase/
  functions/
    identify-plant/ # Edge Function — proxies Plant.id API
  migrations/
    000_initial_schema.sql
    001_profiles_trigger.sql
    002_storage.sql  # plant-photos bucket + RLS policies
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- Expo CLI (`npm install -g expo-cli`)
- Supabase account
- Plant.id API key

### 1. Install dependencies

```bash
npm install
npx expo install expo-image-manipulator
```

### 2. Configure environment variables

Copy the example and fill in your keys:

```bash
cp .env.example .env
```

```bash
# .env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Server-side only — used exclusively in Supabase Edge Functions
PLANT_ID_API_KEY=your-plant-id-key
OPENWEATHER_API_KEY=your-openweather-key
ANTHROPIC_API_KEY=your-anthropic-key

# RevenueCat (optional until paywall is built)
EXPO_PUBLIC_REVENUECAT_IOS_KEY=
EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=
```

> ⚠️ `PLANT_ID_API_KEY`, `OPENWEATHER_API_KEY`, and `ANTHROPIC_API_KEY` are **never** sent to the client. They live only in Supabase Edge Function secrets.

### 3. Set up Supabase

**Apply database migrations:**
```bash
npx supabase db push
```

**Deploy the Edge Function:**
```bash
npx supabase functions deploy identify-plant
```

**Set Edge Function secrets:**
```bash
npx supabase secrets set PLANT_ID_API_KEY=your-key-here
```

**Create the storage bucket** (or run migration 002):
The `002_storage.sql` migration creates the `plant-photos` bucket and RLS policies automatically when you run `supabase db push`.

### 4. Run the app

```bash
# Start Expo dev server
npx expo start

# Web preview (limited — camera not available)
npx expo start --web

# iOS simulator
npx expo run:ios

# Android emulator
npx expo run:android
```

For full camera functionality, use **Expo Go** on a physical device or a native build.

---

## Environment Variables Reference

| Variable | Client | Server | Required |
|---|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | ✅ | | ✅ |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | ✅ | | ✅ |
| `PLANT_ID_API_KEY` | ❌ | ✅ Edge Fn | ✅ |
| `OPENWEATHER_API_KEY` | ❌ | ✅ Edge Fn | Soon |
| `ANTHROPIC_API_KEY` | ❌ | ✅ Edge Fn | Soon |
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY` | ✅ | | Soon |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` | ✅ | | Soon |

---

## Design System

| Token | Value |
|---|---|
| Primary Green | `#2D6A4F` |
| Secondary Green | `#52B788` |
| Light Green | `#D8F3DC` |
| Cream (background) | `#F8F9FA` |
| Border radius | `rounded-2xl` / `rounded-3xl` everywhere |
| Icons | Lucide React Native only |

---

## Free vs Pro

| Feature | Free | Pro |
|---|---|---|
| Plant identifications | 5 / month | Unlimited |
| Plant collection | Up to 3 | Unlimited |
| Disease diagnosis | ❌ | ✅ |
| Weather-aware scheduling | ❌ | ✅ |
| Historical data | 30 days | Unlimited |

Pro pricing: **$4.99/month** or **$34.99/year**

---

## Roadmap

- [x] Authentication (login, signup, onboarding)
- [x] Plant identification (camera → AI → save)
- [x] Supabase Storage for plant photos
- [x] My Plants dashboard
- [x] Watering scheduler with weather integration
- [ ] Push notifications
- [ ] Disease diagnosis (Claude vision)
- [ ] RevenueCat paywall
- [ ] App Store / Google Play submission

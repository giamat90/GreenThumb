# TASK-007: Fix city setting geocode error and modal double overlay

## Status: DONE

## Overview
The "Update City" modal in the profile screen has two bugs: (1) `Location.geocodeAsync()` fails with "Not authorized to use location services" because no runtime permission is requested before calling it, and (2) the modal backdrop appears overly dark because the overlay background is applied twice (on both `KeyboardAvoidingView` and the inner `Pressable`).

## User story
As a user, I want to set my city in the profile settings without getting a location permission error, and I want the modal to display with a normal semi-transparent backdrop.

## Acceptance criteria
- [ ] Typing a city name and tapping Save geocodes successfully without requiring device location permissions
- [ ] Saved city + lat/lng appear correctly in the profile and are persisted to Supabase
- [ ] Weather-based watering still works after saving a city
- [ ] Modal backdrop is a single semi-transparent overlay (not double-stacked)
- [ ] "City not found" error still displays for invalid city names
- [ ] No unused imports left behind

## Technical plan

### Files to create
_None_

### Files to modify
| File | Change |
|------|--------|
| `app/(tabs)/profile.tsx` | Replace `Location.geocodeAsync()` with OpenWeatherMap geocoding API; fix double overlay |

### Database changes
_None_

### Edge functions
_None_

### i18n keys
_None — existing keys are sufficient_

## Implementation steps

### Bug 1: Replace expo-location geocoding with OpenWeatherMap geocoding

1. In `handleSaveCity()` (around line 105), replace the `Location.geocodeAsync()` call with a direct fetch to the OpenWeatherMap geocoding API. This is the same API already used in `lib/weather.ts:133` — no device permissions needed:

   **Remove:**
   ```typescript
   const results = await Location.geocodeAsync(trimmed);

   if (results.length === 0) {
     setCityError(t("profile.cityNotFound"));
     setIsSavingCity(false);
     return;
   }

   const { latitude, longitude } = results[0];
   ```

   **Replace with:**
   ```typescript
   const OWM_KEY = process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY ?? "";
   const geoRes = await fetch(
     `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(trimmed)}&limit=1&appid=${OWM_KEY}`
   );
   if (!geoRes.ok) throw new Error(`Geocoding error: ${geoRes.status}`);
   const geoData = (await geoRes.json()) as Array<{ lat: number; lon: number }>;

   if (!geoData.length) {
     setCityError(t("profile.cityNotFound"));
     setIsSavingCity(false);
     return;
   }

   const { lat: latitude, lon: longitude } = geoData[0];
   ```

2. Remove the `import * as Location from "expo-location"` if it is no longer used anywhere else in the file. Search the entire file for other `Location.` references before removing.

### Bug 2: Fix double overlay

3. The modal structure currently applies `styles.modalOverlay` (which has `backgroundColor: "rgba(0,0,0,0.4)"`) to both the `KeyboardAvoidingView` (line 327) and the inner dismiss `Pressable` (line 331). This stacks two dark layers.

   **Fix:** Change the `KeyboardAvoidingView` style from `styles.modalOverlay` to just `{ flex: 1 }`:

   ```tsx
   <KeyboardAvoidingView
     style={{ flex: 1 }}
     behavior={Platform.OS === "ios" ? "padding" : undefined}
   >
   ```

   Keep `styles.modalOverlay` only on the inner `Pressable` — that's the one that handles the dismiss-on-tap.

## Testing checklist
- [ ] Open Profile > tap "City / Location" > type "Rome" > tap Save — saves without error
- [ ] Verify lat/lng are reasonable (41.9, 12.5 for Rome)
- [ ] Type a nonsense string > tap Save — shows "City not found" error
- [ ] Modal backdrop is a normal semi-transparent gray, not overly dark
- [ ] Weather section on home screen still shows weather after city update
- [ ] No layout regressions on Moto G 5G

## Dependencies
_None_

## Notes
- The OpenWeatherMap geocoding API (`/geo/1.0/direct`) is already used in `lib/weather.ts:131-143` via `getWeatherByCity()`. We're reusing the same endpoint pattern.
- The OWM API key is `EXPO_PUBLIC_OPENWEATHER_API_KEY` — already in the `.env` and safe for client-side use (free tier, read-only).
- The onboarding flow (`app/(auth)/onboarding.tsx`) also uses `Location.geocodeAsync()` but it properly requests permissions first via `Location.requestForegroundPermissionsAsync()`. That flow is fine — it uses GPS for auto-detect, which legitimately needs permissions.

## Implementation notes

- Replaced `Location.geocodeAsync()` in `handleSaveCity()` with a direct fetch to `https://api.openweathermap.org/geo/1.0/direct` using `EXPO_PUBLIC_OPENWEATHER_API_KEY`. Same endpoint pattern already used in `lib/weather.ts`.
- Removed `import * as Location from "expo-location"` — no longer referenced anywhere in the file.
- Fixed double overlay: `KeyboardAvoidingView` now uses `style={{ flex: 1 }}` instead of `style={styles.modalOverlay}`. The single `Pressable` below it retains `styles.modalOverlay` (which carries the `rgba(0,0,0,0.4)` background and centers the card).
- The worktree was branched from an older commit; the file was brought forward to the current main-branch modal version with the two fixes applied.

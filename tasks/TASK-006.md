# TASK-006: Manual Plant Add from My Plants screen

## Status: DONE

## Overview
Users can currently only add plants through the camera identification flow. If AI confidence is low they can "add manually", but this still requires having taken a photo first. This task adds a first-class manual plant entry — a "+" button on the My Plants header that opens a dedicated form where users can add a plant by name, with an optional gallery photo, without ever touching the camera.

## User story
As a **free or Pro user**, I want to **add a plant manually** (by typing its name and optionally picking a photo) so that I can **track plants I already know** without relying on AI identification.

## Acceptance criteria
- [ ] A "+" button appears in the My Plants header (right side, next to the filter button)
- [ ] Tapping "+" navigates to a new Add Plant screen (`app/add-plant.tsx`)
- [ ] The form contains: plant name (required), species (optional), photo (optional gallery pick), pot size selector, location selector, watering frequency selector
- [ ] Photo is optional — saving without a photo stores `photo_url: null` (PlantCard and plant detail already handle this with a placeholder)
- [ ] Watering frequency selector lets user choose Frequent / Average / Minimum (since there's no AI care profile)
- [ ] Saving inserts the plant into the database, updates the Zustand store, invalidates seasonal tips cache, and navigates back to My Plants
- [ ] The EmptyPlants component is updated to mention both entry points (camera + manual add button)
- [ ] All new user-facing strings are added to all 10 locale files
- [ ] Works for free users — no Pro gate
- [ ] The form validates that plant name is non-empty before allowing save

## Technical plan

### Files to create
| File | Purpose |
|------|---------|
| `app/add-plant.tsx` | New standalone route — manual add plant form screen |

### Files to modify
| File | Change |
|------|--------|
| `app/(tabs)/my-plants.tsx` | Add "+" button in the header row, next to the filter/sort button. Navigates to `/add-plant`. Import `Plus` from lucide-react-native. |
| `components/plants/EmptyPlants.tsx` | Update subtitle text to mention both ways to add plants. Use i18n keys. |
| `locales/en.json` | Add new `addPlant` namespace with all form strings |
| `locales/it.json` | Italian translations |
| `locales/es.json` | Spanish translations |
| `locales/fr.json` | French translations |
| `locales/de.json` | German translations |
| `locales/pt.json` | Portuguese translations |
| `locales/nl.json` | Dutch translations |
| `locales/pl.json` | Polish translations |
| `locales/ja.json` | Japanese translations |
| `locales/zh.json` | Chinese translations |

### Database changes
None — the `plants` table already supports all fields needed. `photo_url` is already nullable.

### Edge functions
None.

### i18n keys
New namespace `addPlant` in all 10 locale files:

```json
"addPlant": {
  "title": "Add Plant",
  "plantName": "Plant name",
  "plantNamePlaceholder": "e.g. My Monstera",
  "plantNameRequired": "Please enter a plant name",
  "species": "Species (optional)",
  "speciesPlaceholder": "e.g. Monstera deliciosa",
  "photo": "Photo (optional)",
  "addPhoto": "Add a photo",
  "changePhoto": "Change photo",
  "removePhoto": "Remove",
  "potSize": "Pot size",
  "location": "Location",
  "wateringFrequency": "Watering frequency",
  "frequentLabel": "Frequent",
  "frequentDesc": "Every 2 days",
  "averageLabel": "Average",
  "averageDesc": "Every 5 days",
  "minimumLabel": "Minimum",
  "minimumDesc": "Every 10 days",
  "savePlant": "Save Plant",
  "plantAdded": "Plant added!",
  "plantAddedMessage": "{{name}} has been added to your garden.",
  "viewMyPlants": "View My Plants",
  "saveFailed": "Could not save plant"
}
```

Also update:
- `emptyPlants.title` → keep "No plants yet"
- `emptyPlants.subtitle` → "Use the camera to identify a plant, or tap + to add one manually"
- Create the `emptyPlants` namespace if it doesn't exist yet (currently the EmptyPlants component has hardcoded English strings)

## Implementation steps

### 1. Add i18n keys to all 10 locale files
- Add the `addPlant` namespace with all keys listed above to `locales/en.json`
- Add the `emptyPlants` namespace: `{ "title": "No plants yet", "subtitle": "Use the camera to identify a plant, or tap + to add one manually" }`
- Translate and add both namespaces to the remaining 9 locale files
- **Validate**: no duplicate JSON keys in any file

### 2. Create `app/add-plant.tsx`
- This is a **standalone route** (not inside `(tabs)/`), rendered as a full screen
- Use `useSafeAreaInsets` for padding, `useRouter` for navigation
- Use `ScrollView` as the main container with `backgroundColor: COLORS.cream`
- **Header**: back arrow (`ChevronLeft`) + title "Add Plant" — follow the same pattern as other standalone screens (e.g., `app/plant/[id].tsx`)
- **Form fields** (top to bottom):
  1. **Photo picker area**: A rounded rectangle (120×120, `borderRadius: 20`). If no photo, show a dashed border + camera icon + "Add a photo" text. If photo selected, show the image with a small "X" overlay to remove it. Tapping opens `ImagePicker.launchImageLibraryAsync`.
  2. **Plant name input**: `TextInput` with label. Required field. Same styling as the identify.tsx modal inputs (`backgroundColor: "#F9FAFB"`, `borderRadius: 14`, `borderWidth: 1`, `borderColor: "#E5E7EB"`).
  3. **Species input**: Same styling. Optional, with "(optional)" in the label.
  4. **Pot size selector**: 3 buttons in a row — Small 🪴, Medium 🌿, Large 🌳. Same styling as identify.tsx modal.
  5. **Location selector**: 3 buttons — Indoor 🏠, Outdoor 🌤️, Balcony 🌅. Same styling as identify.tsx modal.
  6. **Watering frequency selector**: 3 buttons in a row — Frequent (every 2d), Average (every 5d), Minimum (every 10d). Use same selection styling (green border + lightgreen bg when active). Default: "average".
  7. **Save button**: Full-width green button at the bottom. Disabled while saving or if plant name is empty.
- **Save logic** (`handleSave`):
  1. Validate plant name is non-empty (show Alert if empty)
  2. Generate UUID with the same `generateUUID()` helper
  3. If photo selected: compress with `compressImage()`, upload to `plant-photos` bucket at `{userId}/{plantId}.jpg`, get public URL. If no photo: `photoUrl = null`
  4. Calculate `next_watering` from selected watering frequency using the same `calculateNextWatering()` logic
  5. Build `newPlantData` object:
     ```ts
     {
       id: plantId,
       user_id: profile.id,
       name: plantName.trim(),
       species: species.trim() || null,
       common_name: null,
       photo_url: photoUrl,
       pot_size: selectedPotSize,
       location: selectedLocation,
       soil_type: null,
       last_watered_at: null,
       next_watering: nextWatering,
       health_score: 100,
       care_profile: {
         watering: selectedWatering,
         light: "indirect light",
         soilType: "well-draining",
       },
       notes: null,
     }
     ```
  6. Insert into `plants` table via Supabase
  7. Call `addPlant()` from Zustand store
  8. Invalidate seasonal tips cache (`invalidateSeasonalTipsCache`)
  9. Show success `Alert` with "View My Plants" button → `router.replace("/(tabs)/my-plants")`
- **Error handling**: wrap save in try/catch, show Alert on failure, `setIsSaving(false)` in finally block
- **Important**: Use `useUserStore` to get `profile`. If `!profile`, early-return from save.

### 3. Update `app/(tabs)/my-plants.tsx`
- Import `Plus` from `lucide-react-native`
- In the header `View` (lines 309–324), add a "+" button **before** the filter button:
  ```tsx
  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
    <TouchableOpacity
      style={styles.addButton}
      onPress={() => router.push("/add-plant")}
      accessibilityLabel={t("addPlant.title")}
      accessibilityRole="button"
    >
      <Plus size={20} color={COLORS.primary} />
    </TouchableOpacity>
    <TouchableOpacity ... > {/* existing filter button */}
    </TouchableOpacity>
  </View>
  ```
- Add `addButton` style: same shape as `sortButton` (circular, border, same dimensions) but without the active state coloring

### 4. Update `components/plants/EmptyPlants.tsx`
- Import `useTranslation`
- Replace hardcoded strings with `t("emptyPlants.title")` and `t("emptyPlants.subtitle")`
- The subtitle should now mention both entry points

### 5. Extract shared helpers (optional but recommended)
- The `generateUUID()` function and `calculateNextWatering()` are currently defined inside `identify.tsx`. Consider extracting them to `lib/plantUtils.ts` so both `identify.tsx` and `add-plant.tsx` can import them without duplication. If this creates too much churn, duplicating them in `add-plant.tsx` is acceptable.

## Testing checklist
- [ ] Works on free tier — no Pro gate blocks
- [ ] Works on Pro tier
- [ ] "+" button visible on My Plants screen header
- [ ] Saving with a photo: photo uploads, plant card shows the image
- [ ] Saving without a photo: plant card shows the 🌿 placeholder
- [ ] Plant name is required — empty name shows validation error
- [ ] Watering schedule is correctly calculated based on selected frequency
- [ ] New plant appears in My Plants list immediately after save
- [ ] Plant detail screen works for manually added plants (with and without photo)
- [ ] Calendar shows watering tasks for manually added plants
- [ ] EmptyPlants now shows updated text
- [ ] i18n: tested in at least EN and IT
- [ ] No hardcoded pixel values for layout spacing (use `onLayout` where needed)
- [ ] No layout regressions on Moto G 5G

## Implementation notes

- Created `app/add-plant.tsx` as a standalone route with full manual add form: photo picker (optional, gallery only), plant name (required), species (optional), pot size selector, location selector, watering frequency selector (Frequent/Average/Minimum).
- Photo is optional — stored as `null` when not provided. PlantCard and plant detail already handle `null` photo_url gracefully.
- `generateUUID()` and `calculateNextWatering()` are duplicated from `identify.tsx` into `add-plant.tsx` as the task spec permits (no extraction was done since it would require touching identify.tsx).
- Added "+" button (`Plus` icon) to the My Plants header, styled identically to the sort button but without active-state coloring. Added `addButton` style in StyleSheet.
- Updated `EmptyPlants.tsx` to use `useTranslation` instead of hardcoded English strings.
- Added `addPlant` and `emptyPlants` namespaces to all 10 locale files (EN, IT, ES, FR, DE, PT, NL, PL, JA, ZH). Validated no duplicate JSON keys with Node.js script.
- Updated `.expo/types/router.d.ts` to include `/add-plant` route — this file is auto-generated by `npx expo start`, so the entry was added manually to prevent TypeScript route typing error until the next dev server run.
- The `router.replace("/(tabs)/my-plants")` on success is used (not `router.back()`) to prevent the user from accidentally navigating back to the empty form.
- All pre-existing TypeScript errors remain unchanged; no new TS errors introduced.

## Dependencies
None.

## Notes
- `PlantCard` (line 96–106) and plant detail (`app/plant/[id].tsx` line 460) already handle `photo_url: null` with a placeholder — no changes needed there.
- The care profile for manually added plants uses sensible defaults (`"indirect light"`, `"well-draining"`) since there's no AI data. The user controls the most impactful setting (watering frequency) directly.
- The `handleSavePlant` in `identify.tsx` requires `capturedUri` and `identificationResult` — it cannot be reused directly. The new screen needs its own save logic (same pattern, different guards).
- The existing manual-add flow in `identify.tsx` (low-confidence fallback) should remain untouched — it's still useful in that context.

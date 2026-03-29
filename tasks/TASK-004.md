# TASK-004: Dedicated fertilizer page (replaces inline fertilize action)

## Status: DONE

## Overview
The Fertilizer History card's "+" button currently fires an instant fertilization event with no confirmation step, and the fertilizer type is changed via a separate `Alert.alert()` popup. This task replaces both with a dedicated full-screen page at `/fertilizer/[id]` — matching the Placement History pattern. The page shows three tappable type buttons (Liquid, Granular, Slow-Release) and a Confirm button. Pro-gated.

## User story
As a Pro user, I want to choose the fertilizer type and confirm before logging a fertilization event, so that I have more control over what gets recorded.

## Acceptance criteria
- [ ] Tapping "+" on Fertilizer History card opens `/fertilizer/[id]` (not an inline action)
- [ ] Page shows three type buttons: Liquid, Granular, Slow-Release — tapping one selects it (highlighted), no popup
- [ ] The plant's current `fertilizer_type` is pre-selected on page load
- [ ] A "Confirm" button at the bottom logs the fertilization event and navigates back
- [ ] After confirming: `fertilizer_logs` gets a new row, `plants.last_fertilized_at` + `next_fertilizer_at` are updated, notification is rescheduled, local store is updated
- [ ] Success alert shown after confirming (same as current: title + next date)
- [ ] "+" button is Pro-gated via `requirePro(t("paywall.featureFertilizer"))` — same pattern as Placement
- [ ] Back button / swipe-back returns to plant detail without recording anything
- [ ] The inline type pills and `handleChangeFertilizerType` Alert popup are removed from plant detail
- [ ] No hardcoded pixel values for layout spacing — use `onLayout` where needed

## Technical plan

### Files to create
| File | Purpose |
|------|---------|
| `app/fertilizer/[id].tsx` | Dedicated fertilizer page — type selection + confirm |

### Files to modify
| File | Change |
|------|--------|
| `app/plant/[id].tsx` | Change "+" `onPress` from `handleFertilizeNow` to Pro-gated navigation to `/fertilizer/[id]`. Remove `handleFertilizeNow` and `handleChangeFertilizerType` functions. Remove inline type pill selector row and its `onPress`. Keep the fertilizer info row (Next date, Interval) and history list — only the action and type-change UI moves to the new page. Remove `isFertilizing` state variable. |
| `locales/*.json` (all 10) | Add `paywall.featureFertilizer` key and `fertilizer.title`, `fertilizer.selectType`, `fertilizer.confirm` keys |

### Database changes
None

### Edge functions
None

### i18n keys
New keys needed (add to all 10 locale files):

| Key | en value |
|-----|----------|
| `paywall.featureFertilizer` | `"Fertilizer Tracking"` |
| `fertilizer.title` | `"Log Fertilizer"` |
| `fertilizer.selectType` | `"Select fertilizer type"` |
| `fertilizer.confirm` | `"Confirm Fertilization"` |

Translations for the other 9 languages:

| Key | it | es | fr | de | pt | nl | pl | ja | zh |
|-----|----|----|----|----|----|----|----|----|----|----|
| `paywall.featureFertilizer` | Monitoraggio Fertilizzante | Seguimiento de Fertilizante | Suivi de Fertilisation | Düngung-Tracking | Acompanhamento de Fertilização | Bemesting Bijhouden | Śledzenie Nawożenia | 施肥の追跡 | 施肥追踪 |
| `fertilizer.title` | Registra Fertilizzante | Registrar Fertilizante | Enregistrer Fertilisation | Düngung Protokollieren | Registrar Fertilização | Bemesting Vastleggen | Zapisz Nawożenie | 施肥を記録 | 记录施肥 |
| `fertilizer.selectType` | Seleziona il tipo di fertilizzante | Selecciona el tipo de fertilizante | Sélectionnez le type d'engrais | Düngerart auswählen | Selecione o tipo de fertilizante | Selecteer type meststof | Wybierz rodzaj nawozu | 肥料の種類を選択 | 选择肥料类型 |
| `fertilizer.confirm` | Conferma Fertilizzazione | Confirmar Fertilización | Confirmer la Fertilisation | Düngung Bestätigen | Confirmar Fertilização | Bemesting Bevestigen | Potwierdź Nawożenie | 施肥を確認 | 确认施肥 |

## Implementation steps

### Step 1 — Create `app/fertilizer/[id].tsx`

Follow the same structural pattern as `app/placement/[id].tsx` (Stack.Screen, back button, SafeArea), but much simpler — no photos, no multi-step flow.

Page layout (single screen, no state machine):

```
┌──────────────────────────────────┐
│  ← Log Fertilizer                │  ← Stack.Screen header hidden, custom back button
│                                  │
│  🌱 {plant.name}                 │  ← Plant name + species subtitle
│     {plant.species}              │
│                                  │
│  Select fertilizer type          │  ← Section label
│                                  │
│  ┌──────────┐ ┌──────────┐      │
│  │  Liquid   │ │ Granular │      │  ← 3 selectable pill/card buttons
│  └──────────┘ └──────────┘      │     - Row wraps if needed
│  ┌──────────────┐                │     - Selected one has primary bg + white text
│  │ Slow-Release │                │     - Unselected has bordered style
│  └──────────────┘                │
│                                  │
│                                  │
│  ┌──────────────────────────────┐│
│  │     Confirm Fertilization    ││  ← Full-width primary button at bottom
│  └──────────────────────────────┘│
└──────────────────────────────────┘
```

Implementation details:

1. Read `id` from `useLocalSearchParams()`
2. Get `plant` from `usePlantsStore`, `profile` from `useUserStore`
3. Local state: `selectedType` initialized from `plant.fertilizer_type ?? "liquid"`
4. Three `TouchableOpacity` buttons for the types — tapping sets `selectedType`, no popup
5. "Confirm" button runs the same logic as current `handleFertilizeNow`:
   - Insert into `fertilizer_logs` with `selectedType`
   - Update `plants.fertilizer_type` to `selectedType` (persist the user's choice for next time)
   - Update `plants.last_fertilized_at` and `plants.next_fertilizer_at`
   - Call `rescheduleFertilizerReminderForPlant()`
   - Update Zustand store via `updatePlant()`
   - Show success Alert
   - Navigate back: `router.back()`
6. Style the type buttons as pills: unselected = white bg + green border, selected = `COLORS.primary` bg + white text
7. Use `useSafeAreaInsets()` for bottom padding (Confirm button)
8. Show `ActivityIndicator` on Confirm button while saving (disable button during save)

### Step 2 — Modify `app/plant/[id].tsx`

1. Change the Fertilizer History "+" button `onPress` (line ~783) from `handleFertilizeNow` to:
   ```tsx
   onPress={() => {
     if (!requirePro(t("paywall.featureFertilizer"))) return;
     router.push({ pathname: "/fertilizer/[id]", params: { id: plant.id } });
   }}
   ```
2. Remove `disabled={isFertilizing}` and the `ActivityIndicator` ternary from the "+" button — just show `<Plus>` icon always (loading state is now on the new page)
3. Delete `handleFertilizeNow` function (lines ~432–471)
4. Delete `handleChangeFertilizerType` function (lines ~473–499)
5. Delete `isFertilizing` state variable
6. Remove the type pill selector section (lines ~807–821): the `fertTypeLabel`, `fertTypeRow` with the three `TouchableOpacity` pills, and `handleChangeFertilizerType`
7. Keep everything else in the Fertilizer card: the info row (Next date, Interval), the separator, and the history list

### Step 3 — Add i18n keys

Add the 4 new keys to all 10 locale files. Place `paywall.featureFertilizer` in the `paywall` section and `fertilizer.*` keys in a new `fertilizer` top-level section (or alongside existing fertilizer keys — follow the file's existing structure).

## Testing checklist
- [ ] Free user: tapping "+" shows Pro upgrade modal
- [ ] Pro user: tapping "+" opens the fertilizer page
- [ ] Pre-selected type matches plant's current `fertilizer_type`
- [ ] Tapping a different type highlights it immediately, no popup
- [ ] Confirm button logs the event, updates next date, shows success alert, navigates back
- [ ] Plant detail Fertilizer History card shows the new entry after returning
- [ ] Calendar shows updated next fertilizer date
- [ ] Back button from fertilizer page returns without recording
- [ ] i18n: tested in at least 2 languages (en + it)
- [ ] No hardcoded pixel values for layout
- [ ] No layout regressions on Moto G 5G

## Dependencies
None

## Notes
- The type pills on the plant detail page currently all call `handleChangeFertilizerType` regardless of which pill is tapped (it shows a popup with all 3 options). This is the popup Giacomo wants removed.
- The new page persists the selected type to `plants.fertilizer_type` on confirm, so next time the user opens the page it's pre-selected correctly.
- `calculateFertilizerInterval` from `@/lib/fertilizer` is still used for the interval calculation — that logic doesn't change.
- `rescheduleFertilizerReminderForPlant` from `@/lib/notifications` handles push notification rescheduling.

## Implementation notes

- Created `app/fertilizer/[id].tsx` following the structural pattern of placement/repotting pages (Stack.Screen hidden, custom back button, SafeAreaInsets for bottom padding).
- Three type pill buttons (Liquid, Granular, Slow-Release) use `plantDetail.liquid/granular/slowRelease` translation keys which already existed.
- Confirm button inserts into `fertilizer_logs`, updates `plants` (including `fertilizer_type` to persist selection), updates Zustand store, and reschedules the push notification.
- Removed from `app/plant/[id].tsx`: `handleFertilizeNow`, `handleChangeFertilizerType`, `isFertilizing` state, the inline type pill selector row, and the `rescheduleFertilizerReminderForPlant` import (no longer needed there).
- The `fertType` local variable in the fertilizer card IIFE was also removed since it was only used by the pill selector.
- Plant detail's `useFocusEffect` re-fetches fertilizer history when the screen regains focus after returning from the new page.
- Added `paywall.featureFertilizer` and `fertilizer.{title,selectType,confirm}` to all 10 locale files. All files validated as valid JSON.

# TASK-002: Move advisor buttons from bottom bar into history cards

## Status: DONE

## Overview
The plant detail screen's fixed bottom action bar is cluttered with 5 secondary advisor buttons (Diagnose, Placement, Repot, Growth, Pruning) plus the primary "Water Now" button. This task moves each advisor action into a "+" button in the header of its corresponding history card, leaving only "Water Now" in the bottom bar. The "Fertilize Now" button also moves from the Fertilizer card into the Fertilizer History card header.

## User story
As a user, I want a clean plant detail screen with actions located next to their relevant history sections so that the bottom bar is uncluttered and I can start a new analysis directly from its history card.

## Acceptance criteria
- [ ] Bottom action bar contains only the "Water Now" button
- [ ] Each history card header shows a "+" button on the right side
- [ ] Diagnosis History "+" triggers Pro gate then navigates to `/diagnosis/[id]`
- [ ] Placement History "+" triggers Pro gate then navigates to `/placement/[id]`
- [ ] Repotting History "+" triggers Pro gate then navigates to `/repotting/[id]`
- [ ] Pruning History "+" triggers Pro gate then navigates to `/pruning/[id]`
- [ ] Fertilizer History "+" calls `handleFertilizeNow()` (no Pro gate)
- [ ] Growth Timeline "+" navigates to `/growth/[id]` (no Pro gate)
- [ ] "Fertilize Now" button removed from Fertilizer card
- [ ] All 5 secondary button styles and grid removed from styles
- [ ] Unused icon imports removed, `Plus` icon added
- [ ] 6 new i18n keys added across all 10 locale files

## Technical plan

### Files to create
None.

### Files to modify
| File | Change |
|------|--------|
| `app/plant/[id].tsx` | Remove secondary buttons grid from action bar; add "+" buttons to 6 history card headers; remove "Fertilize Now" from Fertilizer card; update imports (remove unused icons, add `Plus`); add `cardHeaderRow` and `cardAddButton` styles; remove unused action button styles |
| `locales/en.json` | Add 6 `plantDetail.new*` keys |
| `locales/it.json` | Add 6 translated keys |
| `locales/es.json` | Add 6 translated keys |
| `locales/fr.json` | Add 6 translated keys |
| `locales/de.json` | Add 6 translated keys |
| `locales/pt.json` | Add 6 translated keys |
| `locales/nl.json` | Add 6 translated keys |
| `locales/pl.json` | Add 6 translated keys |
| `locales/ja.json` | Add 6 translated keys |
| `locales/zh.json` | Add 6 translated keys |

### Database changes
None.

### Edge functions
None.

### i18n keys
Add under `plantDetail` in all 10 locales:

| Key | en | it |
|-----|----|----|
| `newDiagnosis` | New diagnosis | Nuova diagnosi |
| `newPlacement` | New placement check | Nuovo controllo posizione |
| `newFertilizer` | Log fertilizer | Registra concimazione |
| `newRepotting` | New repotting check | Nuovo controllo rinvaso |
| `newPruning` | New pruning check | Nuovo controllo potatura |
| `newGrowth` | Log growth | Registra crescita |

Translate appropriately for es, fr, de, pt, nl, pl, ja, zh.

## Implementation steps

### Step 1 — Update icon imports in `app/plant/[id].tsx`
Remove `Stethoscope`, `MapPin`, `Layers`, `Scissors`, `TrendingUp` from the lucide-react-native import. Add `Plus`. Keep `ChevronRight`, `Droplets`, `Sun`, `Leaf`, `Calendar`, `ArrowLeft`, `Trash2`.

### Step 2 — Add `cardHeaderRow` and `cardAddButton` styles
Add to the StyleSheet:
```tsx
cardHeaderRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 12,
},
cardAddButton: {
  width: 32,
  height: 32,
  borderRadius: 16,
  borderWidth: 2,
  borderColor: COLORS.primary,
  alignItems: "center",
  justifyContent: "center",
},
```

### Step 3 — Modify Diagnosis History card header (~line 702)
Replace:
```tsx
<Text style={styles.cardTitle}>{t("plantDetail.diagnosisHistory")}</Text>
```
With:
```tsx
<View style={styles.cardHeaderRow}>
  <Text style={[styles.cardTitle, { marginBottom: 0 }]}>{t("plantDetail.diagnosisHistory")}</Text>
  <TouchableOpacity
    style={styles.cardAddButton}
    onPress={() => {
      if (!requirePro(t("paywall.featureDiagnosis"))) return;
      router.push(`/diagnosis/${plant.id}`);
    }}
    accessibilityLabel={t("plantDetail.newDiagnosis")}
    accessibilityRole="button"
  >
    <Plus size={18} color={COLORS.primary} />
  </TouchableOpacity>
</View>
```

### Step 4 — Modify Placement History card header (~line 749)
Same pattern as Step 3, using `paywall.featurePlacement` and `/placement/[id]` route with params `{ id: plant.id }`. Accessibility label: `plantDetail.newPlacement`.

### Step 5 — Modify Fertilizer History card header (~line 795)
Same card header row pattern but the "+" button calls `handleFertilizeNow()` with no Pro gate. Show `ActivityIndicator` instead of `Plus` when `isFertilizing` is true. Accessibility label: `plantDetail.newFertilizer`.

### Step 6 — Modify Repotting History card header (~line 819)
Same pattern as Step 3, using `paywall.featureRepotting` and `/repotting/[id]` route with params `{ id: plant.id }`. Accessibility label: `plantDetail.newRepotting`.

### Step 7 — Modify Pruning History card header (~line 864)
Same pattern as Step 3, using `paywall.featurePruning` and `/pruning/[id]` route with params `{ id: plant.id }`. Accessibility label: `plantDetail.newPruning`.

### Step 8 — Modify Growth Timeline card header (~line 910)
The Growth Timeline already has a `growthPreviewHeader` row with title + "View All ->". Add a "+" button between them. The "+" navigates to `/growth/[id]` with no Pro gate. Wrap in a `View` with `flexDirection: "row"`, `alignItems: "center"`, `gap: 8`:
```tsx
<View style={styles.growthPreviewHeader}>
  <Text style={[styles.cardTitle, { marginBottom: 0 }]}>{t("plantDetail.growthTimeline")}</Text>
  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
    <TouchableOpacity
      style={styles.cardAddButton}
      onPress={() => router.push({ pathname: "/growth/[id]", params: { id: plant.id } })}
      accessibilityLabel={t("plantDetail.newGrowth")}
      accessibilityRole="button"
    >
      <Plus size={18} color={COLORS.primary} />
    </TouchableOpacity>
    <TouchableOpacity ...existing View All button... />
  </View>
</View>
```

### Step 9 — Remove "Fertilize Now" button from Fertilizer card (~line 653-664)
Delete the `<TouchableOpacity style={styles.fertilizeButton}>` block from inside the Fertilizer card IIFE.

### Step 10 — Remove secondary buttons grid from action bar (~line 970-1044)
Delete the entire `{/* Secondary actions: 2×2 grid */}` block including the outer `<View style={styles.actionButtonGrid}>` and all three `actionButtonRow` views inside it. Keep only the `<TouchableOpacity style={styles.actionButtonPrimary}>` (Water Now) button.

### Step 11 — Remove unused styles
Delete from StyleSheet: `actionButtonGrid`, `actionButtonRow`, `actionButtonSecondary`, `actionButtonSecondaryText`. Also delete `fertilizeButton` and `fertilizeButtonText` if they exist as separate styles.

### Step 12 — Add i18n keys to all 10 locale files
Add the 6 `plantDetail.new*` keys to each locale file with proper translations.

## Testing checklist
- [ ] Works on free tier (Pro gate shows upgrade modal for advisor "+" buttons)
- [ ] Works on Pro tier (all "+" buttons navigate correctly)
- [ ] Fertilizer "+" logs fertilizer correctly
- [ ] Water Now button still works in cleaned-up bottom bar
- [ ] i18n: tested in at least 2 languages (en, it)
- [ ] No hardcoded pixel values (all spacing via styles)
- [ ] No layout regressions on Moto G 5G
- [ ] History entries still tappable and render correctly
- [ ] Growth Timeline "View All" still works alongside new "+" button

## Implementation notes

All 12 steps completed as specified:

- Removed `Stethoscope`, `MapPin`, `Layers`, `TrendingUp`, `Scissors` from lucide imports; added `Plus`.
- Added `cardHeaderRow` and `cardAddButton` styles to the StyleSheet (no hardcoded pixel values — all sizing via named style properties).
- Diagnosis, Placement, Repotting, and Pruning History card headers each replaced with a `cardHeaderRow` View containing the title (marginBottom: 0) and a `cardAddButton` TouchableOpacity with `Plus` icon and Pro gate.
- Fertilizer History card header uses the same pattern but the "+" calls `handleFertilizeNow()` directly (no Pro gate) and shows an `ActivityIndicator` while `isFertilizing` is true.
- Growth Timeline card header: the "+" button was inserted inside the existing `growthPreviewHeader` row, wrapped with the "View All" button in a `flexDirection: "row"` container with `gap: 8`.
- "Fertilize Now" `TouchableOpacity` block removed from the Fertilizer card IIFE.
- Entire secondary button grid (3 `actionButtonRow` Views inside `actionButtonGrid`) removed from the action bar. Only "Water Now" remains.
- Removed unused styles: `actionButtonGrid`, `actionButtonRow`, `actionButtonSecondary`, `actionButtonSecondaryText`, `fertilizeButton`, `fertilizeButtonText`.
- Added 6 `plantDetail.new*` i18n keys to all 10 locale files (en, it, es, fr, de, pt, nl, pl, ja, zh) with appropriate translations.

## Dependencies
None.

## Notes
- The `cardTitle` style has `marginBottom: 12` — when wrapping in `cardHeaderRow`, override with `marginBottom: 0` on the Text and let the row handle the margin.
- The existing `fertCardHeader` and `growthPreviewHeader` styles are similar to the new `cardHeaderRow` — could reuse `cardHeaderRow` for those too, but not required for this task.
- The `actionBarHeight` state and `onLayout` measurement can remain since the bottom bar still exists (just smaller with only Water Now).

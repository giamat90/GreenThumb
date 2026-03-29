# TASK-005: Align fertilizer page styling with Placement/Pruning pattern

## Status: DONE

## Overview
The fertilizer page (`app/fertilizer/[id].tsx`) uses a different visual pattern than the Placement and Pruning advisor pages. This task aligns its styling to match: circular back button with shadow, plant photo card, lightgreen pill selection style, and ScrollView content wrapper.

## User story
As a user, I want all advisor-style pages to look consistent so the app feels polished.

## Acceptance criteria
- [ ] Header: circular white back button (40x40, shadow) + bold 22px title beside it — no centered title, no bottom border
- [ ] Plant card: white rounded card (borderRadius 20, shadow) with photo thumbnail (56x56, borderRadius 14) + name + species — matches Placement/Pruning exactly
- [ ] If plant has no photo, show green placeholder with plant emoji (same as Placement)
- [ ] Pill buttons: unselected = white bg + `#E5E7EB` border; selected = `COLORS.lightgreen` bg + `COLORS.secondary` border + `COLORS.primary` text — NOT green bg + white text
- [ ] Content wrapped in ScrollView (for consistency and future-proofing)
- [ ] Confirm button at bottom outside ScrollView (same position as "Analyze Placement" / "Analyze Pruning Need")
- [ ] No layout regressions

## Technical plan

### Files to create
None

### Files to modify
| File | Change |
|------|--------|
| `app/fertilizer/[id].tsx` | Restyle to match placement/pruning visual pattern |

### Database changes
None

### Edge functions
None

### i18n keys
None

## Implementation steps

### Step 1 — Update `app/fertilizer/[id].tsx`

Apply these specific changes:

**1. Add `Image` and `ScrollView` imports:**
```tsx
import { View, Text, TouchableOpacity, Alert, StyleSheet, ActivityIndicator, Image, ScrollView } from "react-native";
```

**2. Replace header JSX** — from flat bar with centered title to Placement/Pruning style:
```tsx
<View style={[styles.formHeader, { paddingTop: insets.top + 12 }]}>
  <TouchableOpacity
    style={styles.backButton}
    onPress={() => navigation.goBack()}
    accessibilityLabel={t("common.back")}
    accessibilityRole="button"
  >
    <ArrowLeft size={20} color={COLORS.textPrimary} />
  </TouchableOpacity>
  <Text style={styles.formTitle}>{t("fertilizer.title")}</Text>
</View>
```

**3. Replace plant info** — from plain text to photo card:
```tsx
<View style={styles.plantPreview}>
  {plant.photo_url ? (
    <Image
      source={{ uri: plant.photo_url }}
      style={styles.plantThumb}
      resizeMode="cover"
    />
  ) : (
    <View style={[styles.plantThumb, styles.plantThumbPlaceholder]}>
      <Text style={{ fontSize: 32 }}>🌿</Text>
    </View>
  )}
  <View style={styles.plantPreviewText}>
    <Text style={styles.plantPreviewName}>{plant.name}</Text>
    {plant.species ? (
      <Text style={styles.plantPreviewSpecies}>{plant.species}</Text>
    ) : null}
  </View>
</View>
```

**4. Wrap content in ScrollView:**
```tsx
<ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
  {/* plant preview + type selection */}
</ScrollView>
```

**5. Update pill styles** to match Placement/Pruning:
- `typePill`: borderColor `#E5E7EB` (not `COLORS.primary`)
- `typePillSelected`: backgroundColor `COLORS.lightgreen`, borderColor `COLORS.secondary` (not green bg)
- `typePillText`: color `COLORS.textSecondary` (not `COLORS.primary`)
- `typePillTextSelected`: color `COLORS.primary`, fontWeight `"700"` (not white)

**6. Replace styles** — remove old header/plantInfo styles, add Placement-matching styles:

| Old style | New style (copy from placement) |
|-----------|--------------------------------|
| `header` | `formHeader` — flexDirection row, gap 12, no border |
| `backButton` | Same name — 40x40 circle, white bg, shadow |
| `headerTitle` + `headerSpacer` | `formTitle` — fontSize 22, fontWeight 800, left-aligned |
| `plantInfo`, `plantName`, `plantSpecies` | `plantPreview`, `plantThumb`, `plantThumbPlaceholder`, `plantPreviewText`, `plantPreviewName`, `plantPreviewSpecies` |
| `sectionLabel` | `sectionTitle` — fontWeight 700, color textPrimary |
| `typeRow` | `pillRow` — gap 8 |
| `typePill` | Update border/bg colors |

## Testing checklist
- [ ] Fertilizer page visually matches Placement and Pruning pages
- [ ] Plant photo shows when available, emoji placeholder when not
- [ ] Selected pill uses lightgreen highlight (not solid green)
- [ ] Confirm button works correctly (no functional regression)
- [ ] Back button works
- [ ] Scrolls properly if content grows
- [ ] No hardcoded pixel values for layout spacing

## Dependencies
TASK-004 (completed)

## Notes
- This is a styling-only change. No functional logic changes.
- Copy exact style values from `app/placement/[id].tsx` to ensure pixel-perfect match.

## Implementation notes
- Added `Image` and `ScrollView` to RN imports
- Replaced old flat header (centered title + bottom border) with `formHeader` row layout: circular 40x40 white `backButton` + bold 22px `formTitle`
- Replaced plain `plantInfo` text block with `plantPreview` card: white rounded card (borderRadius 20, shadow, padding 14) with 56x56 thumbnail (`plantThumb`) and green placeholder emoji when no photo
- Replaced `sectionLabel` with `sectionTitle` (fontWeight 700, color textPrimary, matching placement)
- Replaced `typeRow` with `pillRow` (gap 8)
- Updated pill styles: unselected uses white bg + `#E5E7EB` border; selected uses `COLORS.lightgreen` bg + `COLORS.secondary` border + `COLORS.primary` text
- Wrapped all form content in `ScrollView`; confirm button stays outside ScrollView at bottom
- `paddingTop` uses `insets.top + 16` (dynamic, no hardcoded layout pixel values)
- No functional logic was changed

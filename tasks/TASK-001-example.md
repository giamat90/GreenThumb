# TASK-001: Water amount calculator per session

## Status: APPROVED

## Overview
Add a "how much water" recommendation to each plant's care screen. Uses a hybrid approach: a base formula (pot size × plant type factor × season factor) refined by AI when the user has Pro. Free users get the formula result; Pro users get an AI-enhanced recommendation that considers the specific plant's health, recent diagnosis data, and local weather.

## User story
As a plant owner, I want to know how much water to give each plant per watering session so that I don't over- or under-water.

## Acceptance criteria
- [ ] Each plant card shows a water amount badge (e.g., "~250ml")
- [ ] Tapping the badge opens a detail modal explaining the calculation
- [ ] Free users see formula-based estimate
- [ ] Pro users see AI-enhanced estimate with explanation
- [ ] Amount updates when season changes
- [ ] Amount updates after a diagnosis (closed-loop integration)

## Technical plan

### Files to create
| File | Purpose |
|------|---------|
| `src/components/WaterAmountBadge.tsx` | Small badge component showing water amount |
| `src/components/WaterAmountModal.tsx` | Detail modal with breakdown |
| `src/utils/waterCalculator.ts` | Pure function: base formula calculation |
| `supabase/functions/water-recommendation/index.ts` | Edge function: AI-enhanced recommendation |

### Files to modify
| File | Change |
|------|--------|
| `src/screens/PlantDetailScreen.tsx` | Add WaterAmountBadge below plant name |
| `src/hooks/useProGate.ts` | No changes needed — use existing hook |
| `supabase/migrations/014_water_amounts.sql` | Add `last_water_amount_ml` column to plants table |

### Database changes
Migration 014:
```sql
ALTER TABLE plants ADD COLUMN last_water_amount_ml INTEGER;
ALTER TABLE plants ADD COLUMN water_calc_updated_at TIMESTAMPTZ;
```

### Edge functions
New: `water-recommendation`
- Input: plant_id, pot_diameter_cm, plant_type, season, recent_diagnosis (optional)
- Output: { amount_ml: number, explanation: string, confidence: "low" | "medium" | "high" }
- Auth: direct fetch() with anon key pattern (NOT supabase.functions.invoke)
- Must respond in user's device language (read Accept-Language header)

### i18n keys
Add to all 35 locale files:
- `water_amount.badge_label`: "~{{amount}}ml" / "~{{amount}}ml"
- `water_amount.modal_title`: "Watering recommendation" / "Raccomandazione irrigazione"
- `water_amount.formula_note`: "Based on pot size and plant type" / "Basato su dimensione vaso e tipo pianta"
- `water_amount.ai_note`: "AI-enhanced recommendation" / "Raccomandazione potenziata dall'IA"
- `water_amount.pro_upgrade`: "Upgrade for personalized amounts" / "Passa a Pro per quantità personalizzate"

## Implementation steps
1. Create migration 014 — run and verify
2. Create `waterCalculator.ts` with pure formula: `baseMl = (potDiameterCm / 2)² × π × 0.1 × plantTypeFactor × seasonFactor`
3. Create `WaterAmountBadge.tsx` — small pill component, uses `onLayout` for positioning
4. Create `WaterAmountModal.tsx` — bottom sheet showing breakdown, Pro gate for AI section
5. Create edge function `water-recommendation` — follows existing edge function patterns
6. Integrate badge into `PlantDetailScreen.tsx` — below plant name, above care schedule
7. Add all i18n keys to all 35 locale files — validate no duplicates
8. Wire closed-loop: after diagnosis completion, trigger water amount recalculation

## Testing checklist
- [ ] Formula produces sensible values (small pot ~100ml, large pot ~500ml)
- [ ] Badge renders correctly with onLayout (no hardcoded pixels)
- [ ] Modal opens/closes cleanly
- [ ] Free user sees formula result + Pro upgrade prompt
- [ ] Pro user sees AI-enhanced result
- [ ] i18n: verified in EN and IT
- [ ] Edge function returns response in correct language
- [ ] Offline: shows cached formula result, hides AI section

## Dependencies
None — can be implemented independently.

## Notes
- Plant type factors: succulents 0.3, tropical 1.2, herbs 0.8, flowering 1.0 (defaults, AI can override)
- Season factors: summer 1.3, spring/fall 1.0, winter 0.6
- The formula is deliberately simple — the AI refinement is the Pro value-add
- Consider caching AI result for 7 days to minimize API calls

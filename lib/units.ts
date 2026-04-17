import * as Localization from 'expo-localization';
import type { UnitSystem } from '@/types';

// Only US, Myanmar (MM), and Liberia (LR) use imperial
const IMPERIAL_REGIONS = new Set(['US', 'MM', 'LR']);

export function detectDefaultUnits(): UnitSystem {
  const region = Localization.getLocales()[0]?.regionCode ?? '';
  return IMPERIAL_REGIONS.has(region) ? 'imperial' : 'metric';
}

export const POT_SIZES_METRIC    = ['< 10 cm', '10-15 cm', '15-20 cm', '20-25 cm', '> 25 cm'];
export const POT_SIZES_IMPERIAL  = ['< 4"', '4-6"', '6-8"', '8-10"', '> 10"'];

export function getPotSizes(units: UnitSystem): string[] {
  return units === 'metric' ? POT_SIZES_METRIC : POT_SIZES_IMPERIAL;
}

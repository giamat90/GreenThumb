import { useRouter } from "expo-router";
import { useUserStore } from "@/store/user";
import { PLANT_LIMITS } from "@/constants";
import { usePlantsStore } from "@/store/plants";

export type ProFeature =
  | "unlimited_plants"
  | "unlimited_identification"
  | "weather_scheduling"
  | "disease_diagnosis"
  | "diagnosis_history";

export interface ProGateResult {
  isPro: boolean;
  showPaywall: () => void;
  /** Returns true if the user can access the feature right now. */
  checkGate: (feature: ProFeature) => boolean;
}

/**
 * Central hook for all subscription-gated features.
 *
 * Design decision: we read subscription from the Zustand store (updated
 * in real-time by RevenueCat's listener in _layout.tsx) rather than from
 * the Supabase profile, so gates respond immediately after purchase without
 * waiting for a network round-trip.
 */
export function useProGate(): ProGateResult {
  const subscription = useUserStore((s) => s.subscription);
  const plants = usePlantsStore((s) => s.plants);
  const router = useRouter();

  const isPro = subscription === "pro";

  function showPaywall(): void {
    router.push("/paywall");
  }

  function checkGate(feature: ProFeature): boolean {
    if (isPro) return true;

    switch (feature) {
      case "unlimited_plants":
        // Free users are capped at 3 plants
        return plants.length < PLANT_LIMITS.free.plants;

      case "unlimited_identification":
        // Identification monthly limit is enforced separately in
        // useIdentificationLimit — here we just return true so the camera
        // can open; the limit hook blocks before the API call.
        return true;

      case "weather_scheduling":
      case "disease_diagnosis":
      case "diagnosis_history":
        // These features are Pro-only
        return false;

      default:
        return false;
    }
  }

  return { isPro, showPaywall, checkGate };
}

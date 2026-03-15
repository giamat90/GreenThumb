import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { useUserStore } from "@/store/user";
import { PLANT_LIMITS } from "@/constants";
import { usePlantsStore } from "@/store/plants";
import { supabase } from "@/lib/supabase";
import { isBetaEmail } from "@/lib/revenuecat";

export type ProFeature =
  | "unlimited_plants"
  | "unlimited_identification"
  | "weather_scheduling"
  | "disease_diagnosis"
  | "diagnosis_history"
  | "create_post";

export interface ProGateResult {
  isPro: boolean;
  showPaywall: () => void;
  /** Returns true if the user can access the feature right now. */
  checkGate: (feature: ProFeature) => boolean;
  /**
   * Returns true if user is Pro (allowed). If not Pro, shows the UpgradeModal
   * for the given feature name and returns false.
   * Always returns true for __DEV__ and beta email users.
   */
  requirePro: (featureName: string) => boolean;
  upgradeModalVisible: boolean;
  lockedFeatureName: string;
  closeUpgradeModal: () => void;
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
  const [isBeta, setIsBeta] = useState(false);
  const [upgradeModalVisible, setUpgradeModalVisible] = useState(false);
  const [lockedFeatureName, setLockedFeatureName] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setIsBeta(isBetaEmail(user?.email));
    });
  }, []);

  const isPro = subscription === "pro" || isBeta;

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

      case "create_post":
        return false; // Pro only

      default:
        return false;
    }
  }

  const requirePro = useCallback(
    (featureName: string): boolean => {
      if (isPro) return true;
      setLockedFeatureName(featureName);
      setUpgradeModalVisible(true);
      return false;
    },
    [isPro]
  );

  const closeUpgradeModal = useCallback(() => {
    setUpgradeModalVisible(false);
  }, []);

  return {
    isPro,
    showPaywall,
    checkGate,
    requirePro,
    upgradeModalVisible,
    lockedFeatureName,
    closeUpgradeModal,
  };
}

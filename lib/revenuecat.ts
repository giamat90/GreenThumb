import { Platform } from "react-native";
import Purchases, {
  LOG_LEVEL,
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesPackage,
} from "react-native-purchases";

import { supabase } from "@/lib/supabase";
import type { Subscription } from "@/types";

// The entitlement ID must match exactly what's created in the RevenueCat dashboard.
const PRO_ENTITLEMENT_ID = "GreenThumb Pro";

// Beta testers — add emails here to grant Pro access
// Remove this list before production release v2.0
export const BETA_PRO_EMAILS = [
  "giacominomatzeu@gmail.com",
  "alessiamagnani@hotmail.it",
  "alessandra.grassi0@gmail.com",
  "davidelonghi1992@gmail.com",
  "giacomomontanari0@gmail.com",
  "hamzasarrat@gmail.com",
  "lucafarina94@gmail.com",
  "luciamontanari1996@gmail.com",
  "mefistofelepablito@gmail.com",
  "mich.danniballe@gmail.com",
  "michaelscorzoni@gmail.com",
  "mr.daerio@gmail.com"
];

export const isBetaEmail = (email: string | null | undefined): boolean =>
  !!email && BETA_PRO_EMAILS.includes(email);

// ─── Initialisation ───────────────────────────────────────────────────────────

/**
 * Must be called once after the user's Supabase auth ID is known.
 * Passing appUserID ties RevenueCat receipts to this specific account,
 * which is critical for restoring purchases across devices.
 *
 * NOTE: Uses the production Google Play key via EXPO_PUBLIC_REVENUECAT_ANDROID_KEY.
 */
export function initializePurchases(userId: string): void {
  const apiKey =
    Platform.OS === "ios"
      ? (process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? "")
      : (process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? "");

  if (!apiKey) {
    console.warn(
      "RevenueCat: API key not configured. Set EXPO_PUBLIC_REVENUECAT_ANDROID_KEY / IOS_KEY in .env"
    );
    return;
  }

  try {
    Purchases.setLogLevel(LOG_LEVEL.DEBUG);
    Purchases.configure({ apiKey, appUserID: userId, useAmazon: false });
  } catch (err) {
    console.warn("RevenueCat: configure failed", err);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetches the current RevenueCat offering.
 * Returns null when no offerings are configured.
 */
export async function getOfferings(): Promise<PurchasesOffering | null> {
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current ?? null;
  } catch (err) {
    console.warn("RevenueCat: getOfferings failed", err);
    return null;
  }
}

/**
 * Initiates a purchase for the given package.
 * Returns true on success, false if the user cancels.
 * Throws a user-facing error string on hard failures.
 */
export async function purchasePackage(pkg: PurchasesPackage): Promise<boolean> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return isPro(customerInfo);
  } catch (err: unknown) {
    // RevenueCat surfaces cancellations as errors with userCancelled flag
    if (
      err !== null &&
      typeof err === "object" &&
      "userCancelled" in err &&
      (err as { userCancelled: boolean }).userCancelled
    ) {
      return false;
    }
    throw new Error("Purchase failed. Please try again or contact support.");
  }
}

/**
 * Restores any previous purchases and returns true if a Pro subscription
 * is found among them.
 */
export async function restorePurchases(): Promise<boolean> {
  try {
    const customerInfo = await Purchases.restorePurchases();
    return isPro(customerInfo);
  } catch (err) {
    console.warn("RevenueCat: restorePurchases failed", err);
    return false;
  }
}

/**
 * Reads the current customer info and returns 'pro' if the 'GreenThumb Pro' entitlement
 * is active, 'free' otherwise.
 */
export async function checkSubscriptionStatus(): Promise<Subscription> {
  const { data: { user } } = await supabase.auth.getUser();
  if (isBetaEmail(user?.email)) return "pro";

  try {
    const customerInfo = await Purchases.getCustomerInfo();
    return isPro(customerInfo) ? "pro" : "free";
  } catch (err) {
    console.warn("RevenueCat: checkSubscriptionStatus failed", err);
    return "free";
  }
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function isPro(customerInfo: CustomerInfo): boolean {
  return PRO_ENTITLEMENT_ID in customerInfo.entitlements.active;
}

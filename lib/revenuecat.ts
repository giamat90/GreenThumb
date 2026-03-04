import { Platform } from "react-native";
import Purchases, {
  LOG_LEVEL,
  type PurchasesOffering,
  type PurchasesPackage,
  type CustomerInfo,
} from "react-native-purchases";

import type { Subscription } from "@/types";

// The entitlement ID must match exactly what's created in the RevenueCat dashboard.
const PRO_ENTITLEMENT_ID = "pro";

// ─── Initialisation ───────────────────────────────────────────────────────────

/**
 * Must be called once after the user's Supabase auth ID is known.
 * Passing appUserID ties RevenueCat receipts to this specific account,
 * which is critical for restoring purchases across devices.
 */
export function initializePurchases(userId: string): void {
  const apiKey =
    Platform.OS === "ios"
      ? (process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? "")
      : (process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? "");

  if (!apiKey) {
    // Keys are not set yet (normal during early development before RevenueCat
    // account is created). Log a warning but don't crash.
    console.warn(
      "RevenueCat: API key not configured. Set EXPO_PUBLIC_REVENUECAT_ANDROID_KEY / IOS_KEY in .env"
    );
    return;
  }

  if (__DEV__) {
    Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  }

  Purchases.configure({ apiKey, appUserID: userId });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetches the current RevenueCat offering.
 * Returns null when no offerings are configured (pre-dashboard-setup).
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
    throw err;
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
 * Reads the current customer info and returns 'pro' if the 'pro' entitlement
 * is active, 'free' otherwise.
 */
export async function checkSubscriptionStatus(): Promise<Subscription> {
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

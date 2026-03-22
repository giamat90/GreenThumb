import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X, Check, Lock } from "lucide-react-native";
import type { PurchasesPackage, PurchasesOffering } from "react-native-purchases";
import { useTranslation } from "react-i18next";

import { COLORS } from "@/constants";
import { useUserStore } from "@/store/user";
import { supabase } from "@/lib/supabase";
import {
  getOfferings,
  purchasePackage,
  restorePurchases,
} from "@/lib/revenuecat";

// ─── Feature comparison table ─────────────────────────────────────────────────

interface FeatureRow {
  name: string;
  free: string | boolean;
  pro: string | boolean;
}

// ─── Feature row component ────────────────────────────────────────────────────

function FeatureItem({ feature }: { feature: FeatureRow }) {
  function renderCell(value: string | boolean, isPro: boolean) {
    if (typeof value === "boolean") {
      return value ? (
        <Check size={18} color={isPro ? COLORS.primary : COLORS.textSecondary} strokeWidth={2.5} />
      ) : (
        <Text style={[styles.cellX, !isPro && styles.cellXFree]}>✕</Text>
      );
    }
    return (
      <Text style={[styles.cellText, isPro && styles.cellTextPro]}>{value}</Text>
    );
  }

  return (
    <View style={styles.featureRow}>
      <Text style={styles.featureName}>{feature.name}</Text>
      <View style={styles.featureCells}>
        <View style={styles.featureCell}>{renderCell(feature.free, false)}</View>
        <View style={[styles.featureCell, styles.featureCellPro]}>{renderCell(feature.pro, true)}</View>
      </View>
    </View>
  );
}

// ─── Skeleton price card ──────────────────────────────────────────────────────

function PriceSkeleton() {
  const opacity = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.8, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, [opacity]);

  return (
    <Animated.View style={[styles.skeletonCard, { opacity }]}>
      <View style={styles.skeletonLine} />
      <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
    </Animated.View>
  );
}

// ─── Success overlay ──────────────────────────────────────────────────────────

function SuccessOverlay() {
  const { t } = useTranslation();
  const scale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      tension: 60,
      friction: 7,
    }).start();
  }, [scale]);

  return (
    <View style={styles.successOverlay}>
      <Animated.View style={[styles.successCircle, { transform: [{ scale }] }]}>
        <Check size={48} color="#fff" strokeWidth={3} />
      </Animated.View>
      <Text style={styles.successTitle}>{t("paywall.welcomePro")}</Text>
      <Text style={styles.successSubtitle}>{t("paywall.allFeaturesUnlocked")}</Text>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PaywallScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { profile, setSubscription } = useUserStore();

  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [offeringsLoading, setOfferingsLoading] = useState(true);
  const [bottomBarHeight, setBottomBarHeight] = useState(0);
  const [selectedPkg, setSelectedPkg] = useState<PurchasesPackage | null>(null);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const FEATURES: FeatureRow[] = [
    { name: t("paywall.plantIdentification"), free: t("paywall.perMonth"), pro: t("paywall.unlimited") },
    { name: t("paywall.myPlants"), free: t("paywall.unlimited"), pro: t("paywall.unlimited") },
    { name: t("paywall.wateringReminders"), free: true, pro: true },
    { name: t("paywall.weatherAwareScheduling"), free: false, pro: true },
    { name: t("paywall.aiDiseaseDiagnosis"), free: false, pro: true },
    { name: t("paywall.placementAdvisor"), free: false, pro: true },
    { name: t("paywall.repottingAdvisor"), free: false, pro: true },
    { name: t("paywall.pruningAdvisor"), free: false, pro: true },
    { name: t("paywall.growthTracking"), free: false, pro: true },
    { name: t("paywall.prioritySupport"), free: false, pro: true },
  ];

  // Load available packages from RevenueCat
  useEffect(() => {
    getOfferings().then((o) => {
      setOffering(o);
      // Pre-select the annual package (best value) if available
      if (o) {
        const annual = o.annual ?? o.availablePackages[0] ?? null;
        setSelectedPkg(annual);
      }
      setOfferingsLoading(false);
    });
  }, []);

  // Helper: find package by type label so we can show monthly / annual clearly
  const annualPkg = offering?.annual ?? null;
  const monthlyPkg = offering?.monthly ?? null;
  const packages = offering?.availablePackages ?? [];

  function priceLabel(pkg: PurchasesPackage): string {
    return pkg.product.priceString;
  }

  async function handlePurchase() {
    if (!selectedPkg) return;
    setIsPurchasing(true);
    try {
      const success = await purchasePackage(selectedPkg);
      if (success) {
        await onPurchaseSuccess();
      }
      // false = user cancelled → no alert needed
    } catch (err) {
      Alert.alert(
        t("paywall.purchaseFailed"),
        err instanceof Error ? err.message : t("common.somethingWentWrong")
      );
    } finally {
      setIsPurchasing(false);
    }
  }

  async function handleRestore() {
    setIsRestoring(true);
    try {
      const hasPro = await restorePurchases();
      if (hasPro) {
        await onPurchaseSuccess();
      } else {
        Alert.alert(t("paywall.noPurchasesFound"), t("paywall.noPurchasesFoundMsg"));
      }
    } catch (err) {
      Alert.alert(t("paywall.restoreFailed"), err instanceof Error ? err.message : t("common.tryAgain"));
    } finally {
      setIsRestoring(false);
    }
  }

  async function onPurchaseSuccess() {
    // Update Zustand store immediately so gates open without waiting for Supabase
    setSubscription("pro");

    // Persist to Supabase profile for cross-device consistency
    if (profile?.id) {
      await supabase
        .from("profiles")
        .update({ subscription: "pro" })
        .eq("id", profile.id)
        .then(({ error }) => {
          if (error) console.warn("paywall: failed to update Supabase subscription", error.message);
        });
    }

    setShowSuccess(true);

    // Brief celebration delay then navigate back
    setTimeout(() => {
      if (navigation.canGoBack()) {
        router.back();
      } else {
        router.replace("/(tabs)");
      }
    }, 1800);
  }

  function ctaLabel(): string {
    if (!selectedPkg) return t("paywall.selectPlan");
    const isAnnual = selectedPkg === annualPkg;
    const price = priceLabel(selectedPkg);
    return t("paywall.startPro", { price, period: isAnnual ? t("paywall.year") : t("paywall.month") });
  }

  if (showSuccess) {
    return <SuccessOverlay />;
  }

  return (
    <View style={styles.screen}>
      {/* Close button */}
      <TouchableOpacity
        style={[styles.closeButton, { top: insets.top + 12 }]}
        onPress={() => (navigation.canGoBack() ? router.back() : router.replace("/(tabs)"))}
        accessibilityLabel="Close paywall"
        accessibilityRole="button"
      >
        <X size={20} color={COLORS.textSecondary} />
      </TouchableOpacity>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 56, paddingBottom: bottomBarHeight + 16 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <Image
            source={require("@/assets/images/logo.png")}
            style={{ width: 120, height: 120 }}
            resizeMode="contain"
          />
          <Text style={styles.headerTitle}>{t("paywall.greenThumbPro")}</Text>
          <Text style={styles.headerSubtitle}>{t("paywall.personalAIBotanist")}</Text>
        </View>

        {/* ── Feature comparison ───────────────────────────────────────────── */}
        <View style={styles.comparisonCard}>
          {/* Column headers */}
          <View style={styles.featureRow}>
            <View style={{ flex: 1 }} />
            <View style={styles.featureCells}>
              <View style={styles.featureCell}>
                <Text style={styles.columnHeader}>{t("paywall.free")}</Text>
              </View>
              <View style={[styles.featureCell, styles.featureCellPro]}>
                <Text style={[styles.columnHeader, styles.columnHeaderPro]}>{t("paywall.pro")}</Text>
              </View>
            </View>
          </View>
          <View style={styles.divider} />
          {FEATURES.map((f, i) => (
            <View key={f.name}>
              <FeatureItem feature={f} />
              {i < FEATURES.length - 1 && <View style={styles.rowDivider} />}
            </View>
          ))}
        </View>

        {/* ── Pricing ──────────────────────────────────────────────────────── */}
        <Text style={styles.pricingTitle}>{t("paywall.choosePlan")}</Text>

        {offeringsLoading ? (
          <>
            <PriceSkeleton />
            <PriceSkeleton />
          </>
        ) : packages.length === 0 ? (
          // Fallback static pricing when RevenueCat isn't configured yet
          <>
            <TouchableOpacity
              style={[styles.priceCard, styles.priceCardSelected]}
              onPress={() => setSelectedPkg(null)}
            >
              <View style={styles.priceCardTop}>
                <View>
                  <Text style={styles.pricePeriod}>{t("paywall.annual")}</Text>
                  <Text style={styles.priceAmount}>$34.99 / {t("paywall.year")}</Text>
                  <Text style={styles.priceSub}>{t("paywall.justPerMonth", { price: "2.92" })}</Text>
                </View>
                <View style={styles.saveBadge}>
                  <Text style={styles.saveBadgeText}>{t("paywall.savePercent", { percent: "42" })}</Text>
                </View>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.priceCard}
              onPress={() => setSelectedPkg(null)}
            >
              <Text style={styles.pricePeriod}>{t("paywall.monthly")}</Text>
              <Text style={styles.priceAmount}>$4.99 / {t("paywall.month")}</Text>
            </TouchableOpacity>
          </>
        ) : (
          packages.map((pkg) => {
            const isSelected = pkg === selectedPkg;
            const isAnnual = pkg === annualPkg;
            return (
              <TouchableOpacity
                key={pkg.identifier}
                style={[styles.priceCard, isSelected && styles.priceCardSelected]}
                onPress={() => setSelectedPkg(pkg)}
                accessibilityLabel={`Select ${isAnnual ? t("paywall.annual") : t("paywall.monthly")} plan`}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
              >
                <View style={styles.priceCardTop}>
                  <View>
                    <Text style={[styles.pricePeriod, isSelected && styles.pricePeriodSelected]}>
                      {isAnnual ? t("paywall.annual") : t("paywall.monthly")}
                    </Text>
                    <Text style={[styles.priceAmount, isSelected && styles.priceAmountSelected]}>
                      {priceLabel(pkg)} / {isAnnual ? t("paywall.year") : t("paywall.month")}
                    </Text>
                    {isAnnual && (
                      <Text style={[styles.priceSub, isSelected && styles.priceSubSelected]}>
                        {t("paywall.justPerMonth", { price: monthlyPkg ? `${(parseFloat(pkg.product.price) / 12).toFixed(2)}` : "2.92" })}
                      </Text>
                    )}
                  </View>
                  {isAnnual && (
                    <View style={styles.saveBadge}>
                      <Text style={styles.saveBadgeText}>{t("paywall.savePercent", { percent: "42" })}</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* ── Fixed bottom bar ──────────────────────────────────────────────── */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]} onLayout={(e) => setBottomBarHeight(e.nativeEvent.layout.height)}>
        <TouchableOpacity
          style={[styles.ctaButton, (!selectedPkg && packages.length > 0) && styles.ctaButtonDisabled]}
          onPress={handlePurchase}
          disabled={isPurchasing || (packages.length > 0 && !selectedPkg)}
          accessibilityLabel={ctaLabel()}
          accessibilityRole="button"
        >
          {isPurchasing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Lock size={16} color="#fff" />
              <Text style={styles.ctaText}>{ctaLabel()}</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.restoreButton}
          onPress={handleRestore}
          disabled={isRestoring}
          accessibilityLabel={t("paywall.restorePurchases")}
          accessibilityRole="button"
        >
          {isRestoring ? (
            <ActivityIndicator size="small" color={COLORS.textSecondary} />
          ) : (
            <Text style={styles.restoreText}>{t("paywall.restorePurchases")}</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.legalText}>{t("paywall.cancelAnytime")}</Text>

        <View style={styles.legalLinks}>
          <TouchableOpacity onPress={() => Linking.openURL("https://greenthumb.app/privacy")}>
            <Text style={styles.legalLink}>{t("profile.privacyPolicy")}</Text>
          </TouchableOpacity>
          <Text style={styles.legalSep}>·</Text>
          <TouchableOpacity onPress={() => Linking.openURL("https://greenthumb.app/terms")}>
            <Text style={styles.legalLink}>{t("profile.termsOfService")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.cream,
  },
  closeButton: {
    position: "absolute",
    right: 16,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    paddingHorizontal: 20,
    gap: 14,
  },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    alignItems: "center",
    paddingVertical: 8,
    gap: 6,
  },
  headerTitle: {
    fontSize: 30,
    fontWeight: "800",
    color: COLORS.primary,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 16,
    color: COLORS.textSecondary,
  },

  // ── Feature comparison ───────────────────────────────────────────────────────
  comparisonCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  columnHeader: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textSecondary,
    textAlign: "center",
  },
  columnHeaderPro: {
    color: COLORS.primary,
    fontWeight: "700",
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  featureName: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textPrimary,
  },
  featureCells: {
    flexDirection: "row",
    gap: 8,
  },
  featureCell: {
    width: 72,
    alignItems: "center",
  },
  featureCellPro: {
    backgroundColor: "#F0FDF4",
    borderRadius: 10,
    paddingVertical: 2,
  },
  cellText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: "center",
    fontWeight: "500",
  },
  cellTextPro: {
    color: COLORS.primary,
    fontWeight: "700",
  },
  cellX: {
    fontSize: 14,
    color: "#D1D5DB",
    fontWeight: "700",
  },
  cellXFree: {
    color: "#D1D5DB",
  },
  divider: {
    height: 1,
    backgroundColor: "#F3F4F6",
    marginBottom: 4,
  },
  rowDivider: {
    height: 1,
    backgroundColor: "#F9FAFB",
  },

  // ── Pricing ──────────────────────────────────────────────────────────────────
  pricingTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginTop: 4,
  },
  priceCard: {
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 18,
    borderWidth: 2,
    borderColor: "transparent",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  priceCardSelected: {
    borderColor: COLORS.primary,
    backgroundColor: "#F0FDF4",
  },
  priceCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pricePeriod: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textSecondary,
    marginBottom: 2,
  },
  pricePeriodSelected: {
    color: COLORS.primary,
  },
  priceAmount: {
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.textPrimary,
    letterSpacing: -0.3,
  },
  priceAmountSelected: {
    color: COLORS.primary,
  },
  priceSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  priceSubSelected: {
    color: COLORS.secondary,
  },
  saveBadge: {
    backgroundColor: COLORS.secondary,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  saveBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 0.5,
  },
  skeletonCard: {
    backgroundColor: "#E5E7EB",
    borderRadius: 18,
    padding: 18,
    gap: 10,
  },
  skeletonLine: {
    height: 16,
    borderRadius: 8,
    backgroundColor: "#D1D5DB",
    width: "60%",
  },
  skeletonLineShort: {
    width: "40%",
  },

  // ── Bottom bar ───────────────────────────────────────────────────────────────
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    paddingTop: 16,
    paddingHorizontal: 20,
    alignItems: "center",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "#F3F4F6",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 8,
  },
  ctaButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 20,
    paddingVertical: 16,
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  ctaButtonDisabled: {
    opacity: 0.5,
  },
  ctaText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
  },
  restoreButton: {
    paddingVertical: 4,
  },
  restoreText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: "500",
  },
  legalText: {
    fontSize: 11,
    color: "#9CA3AF",
  },
  legalLinks: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  legalLink: {
    fontSize: 11,
    color: COLORS.textSecondary,
    textDecorationLine: "underline",
  },
  legalSep: {
    fontSize: 11,
    color: "#D1D5DB",
  },

  // ── Success ──────────────────────────────────────────────────────────────────
  successOverlay: {
    flex: 1,
    backgroundColor: COLORS.cream,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 40,
  },
  successCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  successTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: COLORS.primary,
    textAlign: "center",
  },
  successSubtitle: {
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: "center",
  },
});

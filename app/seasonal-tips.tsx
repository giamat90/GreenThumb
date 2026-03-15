import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { COLORS } from "@/constants";
import { useUserStore } from "@/store/user";
import { useWeather } from "@/hooks/useWeather";
import { usePlantsStore } from "@/store/plants";
import {
  loadSeasonalTips,
  seasonEmoji,
} from "@/lib/seasonalTips";
import type { SeasonalTips, PlantTip } from "@/lib/seasonalTips";

// ─── Urgency badge ────────────────────────────────────────────────────────────

function UrgencyBadge({ urgency }: { urgency: PlantTip["urgency"] }) {
  const { t } = useTranslation();
  const colors: Record<PlantTip["urgency"], { bg: string; text: string }> = {
    info:    { bg: COLORS.lightgreen, text: COLORS.primary },
    warning: { bg: "#FEF3C7",         text: "#92400E" },
    urgent:  { bg: "#FEE2E2",         text: "#991B1B" },
  };
  const labelKey: Record<PlantTip["urgency"], string> = {
    info:    "seasonal.tipInfo",
    warning: "seasonal.tipWarning",
    urgent:  "seasonal.tipUrgent",
  };
  const c = colors[urgency];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.badgeText, { color: c.text }]}>{t(labelKey[urgency])}</Text>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SeasonalTipsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tipsJson } = useLocalSearchParams<{ tipsJson?: string }>();
  const { profile } = useUserStore();
  const { weather } = useWeather();
  const { plants } = usePlantsStore();

  const parsedInitial = tipsJson ? (JSON.parse(tipsJson) as SeasonalTips) : null;
  const [tips, setTips] = useState<SeasonalTips | null>(parsedInitial);
  const [loading, setLoading] = useState(!parsedInitial);

  const location = profile?.city ?? weather?.city ?? "";

  const loadTips = useCallback(async () => {
    if (!profile) { setLoading(false); return; }
    setLoading(true);
    try {
      const result = await loadSeasonalTips(profile.id, plants, location);
      if (result) setTips(result);
    } catch (err) {
      console.warn("SeasonalTipsScreen: load failed", err);
    } finally {
      setLoading(false);
    }
  }, [profile, plants, location]);

  // Re-check cache on every focus so a just-invalidated cache triggers a
  // fresh fetch immediately when the user navigates to this screen.
  useFocusEffect(
    useCallback(() => {
      loadTips();
    }, [loadTips])
  );

  const lastUpdated = tips?.cached_at
    ? new Date(tips.cached_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityLabel={t("common.back")}
          accessibilityRole="button"
        >
          <ArrowLeft size={22} color={COLORS.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {tips ? `${seasonEmoji(tips.season)} ${tips.month_name}` : t("seasonal.seasonalTipsTitle")}
        </Text>
        {loading && <ActivityIndicator size="small" color={COLORS.primary} style={styles.headerSpinner} />}
      </View>

      {loading && !tips ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>{t("seasonal.seasonalTipsLoading")}</Text>
        </View>
      ) : !tips ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>{t("seasonal.seasonalTipsEmpty")}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Season label */}
          <Text style={styles.seasonLabel}>
            {seasonEmoji(tips.season)} {t(`seasonal.${tips.season}`)} — {tips.month_name}
          </Text>

          {lastUpdated && (
            <Text style={styles.lastUpdated}>
              {t("seasonal.lastUpdated", { time: lastUpdated })}
            </Text>
          )}

          {/* General tips */}
          {tips.general_tips.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                {t("seasonal.seasonalTipsTitle")}
                {tips.location ? ` — ${tips.location}` : ""}
              </Text>
              {tips.general_tips.map((tip, i) => (
                <View key={i} style={styles.tipRow}>
                  <Text style={styles.tipBullet}>🌿</Text>
                  <Text style={styles.tipText}>{tip}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Per-plant tips */}
          {tips.plant_tips.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t("seasonal.yourPlantsMonth")}</Text>
              {tips.plant_tips.map((pt, i) => (
                <View key={i} style={styles.plantCard}>
                  <View style={styles.plantCardHeader}>
                    <Text style={styles.plantName}>{pt.plant_name}</Text>
                    <UrgencyBadge urgency={pt.urgency} />
                  </View>
                  {pt.tips.map((tip, j) => (
                    <View key={j} style={styles.tipRow}>
                      <Text style={styles.tipBullet}>•</Text>
                      <Text style={styles.tipText}>{tip}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.cream,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#EFEFEF",
    backgroundColor: "#fff",
  },
  backBtn: {
    padding: 4,
    marginRight: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  headerSpinner: {
    marginLeft: 8,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 32,
  },
  loadingText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  emptyText: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: "center",
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 8,
  },
  seasonLabel: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.primary,
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  lastUpdated: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 12,
  },
  section: {
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  tipRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 10,
  },
  tipBullet: {
    fontSize: 14,
    marginTop: 1,
    color: COLORS.primary,
  },
  tipText: {
    fontSize: 14,
    color: COLORS.textPrimary,
    flex: 1,
    lineHeight: 21,
  },
  plantCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  plantCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  plantName: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textPrimary,
    flex: 1,
    marginRight: 8,
  },
  badge: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
});

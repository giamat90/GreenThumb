import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft } from "lucide-react-native";

import { useTranslation } from "react-i18next";

import { COLORS } from "@/constants";
import { supabase } from "@/lib/supabase";
import { rescheduleFertilizerReminderForPlant } from "@/lib/notifications";
import { calculateFertilizerInterval } from "@/lib/fertilizer";
import { usePlantsStore } from "@/store/plants";
import { useUserStore } from "@/store/user";

// ─── Fertilizer type options ──────────────────────────────────────────────────

type FertilizerType = "liquid" | "granular" | "slow-release";

const FERTILIZER_TYPES: { value: FertilizerType; labelKey: string }[] = [
  { value: "liquid",        labelKey: "plantDetail.liquid"      },
  { value: "granular",      labelKey: "plantDetail.granular"    },
  { value: "slow-release",  labelKey: "plantDetail.slowRelease" },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function FertilizerScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { profile } = useUserStore();
  const { plants, updatePlant } = usePlantsStore();

  const plant = plants.find((p) => p.id === id) ?? null;

  const [selectedType, setSelectedType] = useState<FertilizerType>(
    (plant?.fertilizer_type as FertilizerType | null) ?? "liquid"
  );
  const [isSaving, setIsSaving] = useState(false);

  if (!plant) {
    return (
      <View style={styles.notFound}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.notFoundText}>{t("plantDetail.plantNotFound")}</Text>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backLink}>← {t("plantDetail.goBack")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleConfirm = async () => {
    if (!plant || !profile) return;
    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const intervalDays =
        plant.fertilizer_interval_days ??
        calculateFertilizerInterval(plant.species, new Date().getMonth());
      const nextDate = new Date();
      nextDate.setDate(nextDate.getDate() + intervalDays);
      const nextFertilizerAt = nextDate.toISOString();

      // Insert fertilizer log
      const { error: logError } = await supabase.from("fertilizer_logs").insert({
        plant_id: plant.id,
        user_id: profile.id,
        fertilized_at: now,
        fertilizer_type: selectedType,
      });
      if (logError) throw logError;

      // Update plant record — persist the selected type and schedule info
      const { error: plantError } = await supabase
        .from("plants")
        .update({
          last_fertilized_at: now,
          next_fertilizer_at: nextFertilizerAt,
          fertilizer_type: selectedType,
        })
        .eq("id", plant.id);
      if (plantError) throw plantError;

      // Update Zustand store
      updatePlant(plant.id, {
        last_fertilized_at: now,
        next_fertilizer_at: nextFertilizerAt,
        fertilizer_type: selectedType,
      });

      // Reschedule push notification
      rescheduleFertilizerReminderForPlant({
        ...plant,
        last_fertilized_at: now,
        next_fertilizer_at: nextFertilizerAt,
        fertilizer_type: selectedType,
      }).catch(console.warn);

      const nextDateStr = nextDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });

      Alert.alert(
        t("plantDetail.fertilizedTitle"),
        t("plantDetail.fertilizedMessage", { date: nextDateStr }),
        [{ text: t("common.done"), onPress: () => router.back() }]
      );
    } catch (err) {
      Alert.alert(
        t("common.error"),
        err instanceof Error ? err.message : t("plantDetail.failedRecordFertilization")
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityLabel={t("common.back")}
          accessibilityRole="button"
        >
          <ArrowLeft size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("fertilizer.title")}</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* ── Content ────────────────────────────────────────────────────── */}
      <View style={styles.content}>
        {/* Plant name */}
        <View style={styles.plantInfo}>
          <Text style={styles.plantName}>{plant.name}</Text>
          {plant.species ? (
            <Text style={styles.plantSpecies}>{plant.species}</Text>
          ) : null}
        </View>

        {/* Type selection */}
        <Text style={styles.sectionLabel}>{t("fertilizer.selectType")}</Text>
        <View style={styles.typeRow}>
          {FERTILIZER_TYPES.map(({ value, labelKey }) => {
            const isSelected = selectedType === value;
            return (
              <TouchableOpacity
                key={value}
                style={[styles.typePill, isSelected && styles.typePillSelected]}
                onPress={() => setSelectedType(value)}
                accessibilityLabel={t(labelKey)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
              >
                <Text
                  style={[
                    styles.typePillText,
                    isSelected && styles.typePillTextSelected,
                  ]}
                >
                  {t(labelKey)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* ── Confirm button ─────────────────────────────────────────────── */}
      <TouchableOpacity
        style={[styles.confirmButton, isSaving && styles.confirmButtonDisabled]}
        onPress={handleConfirm}
        disabled={isSaving}
        accessibilityLabel={t("fertilizer.confirm")}
        accessibilityRole="button"
      >
        {isSaving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.confirmButtonText}>{t("fertilizer.confirm")}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.cream,
  },
  notFound: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.cream,
  },
  notFoundText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginBottom: 16,
  },
  backLink: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: "600",
  },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: COLORS.cream,
    borderBottomWidth: 1,
    borderBottomColor: "#E8E0CC",
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "600",
    color: COLORS.textPrimary,
  },
  headerSpacer: {
    width: 38, // balances the back button width so title is centered
  },

  // Content
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  plantInfo: {
    marginBottom: 28,
  },
  plantName: {
    fontSize: 22,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  plantSpecies: {
    fontSize: 15,
    color: COLORS.textSecondary,
    fontStyle: "italic",
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textSecondary,
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  typeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  typePill: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    backgroundColor: "#fff",
  },
  typePillSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  typePillText: {
    fontSize: 15,
    fontWeight: "500",
    color: COLORS.primary,
  },
  typePillTextSelected: {
    color: "#fff",
  },

  // Confirm button
  confirmButton: {
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 16,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmButtonDisabled: {
    opacity: 0.6,
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
});

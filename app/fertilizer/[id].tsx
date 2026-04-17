import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ActivityIndicator,
  Image,
  ScrollView,
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
  const { t, i18n } = useTranslation();
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

      const nextDateStr = nextDate.toLocaleDateString(i18n.language, {
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

      {/* ── Scrollable content ─────────────────────────────────────────── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 16 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ───────────────────────────────────────────────────── */}
        <View style={styles.formHeader}>
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

        {/* ── Plant preview ─────────────────────────────────────────────── */}
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

        {/* ── Type selection ────────────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>{t("fertilizer.selectType")}</Text>
        <View style={styles.pillRow}>
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
      </ScrollView>

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

  // Scroll + content
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },

  // Header
  formHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  formTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },

  // Plant preview card
  plantPreview: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 14,
    gap: 14,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  plantThumb: {
    width: 56,
    height: 56,
    borderRadius: 14,
  },
  plantThumbPlaceholder: {
    backgroundColor: COLORS.lightgreen,
    alignItems: "center",
    justifyContent: "center",
  },
  plantPreviewText: {
    flex: 1,
  },
  plantPreviewName: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  plantPreviewSpecies: {
    fontSize: 13,
    fontStyle: "italic",
    color: COLORS.textSecondary,
    marginTop: 2,
  },

  // Section title
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 10,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  // Pills
  pillRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  typePill: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    backgroundColor: "#fff",
  },
  typePillSelected: {
    backgroundColor: COLORS.lightgreen,
    borderColor: COLORS.secondary,
  },
  typePillText: {
    fontSize: 13,
    fontWeight: "500",
    color: COLORS.textSecondary,
  },
  typePillTextSelected: {
    color: COLORS.primary,
    fontWeight: "700",
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

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Stack, useLocalSearchParams, useFocusEffect, useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeft,
  ChevronRight,
  Droplets,
  Sun,
  Leaf,
  Calendar,
  Trash2,
  Plus,
  Pencil,
  Sprout,
} from "lucide-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useTranslation } from "react-i18next";

import { COLORS } from "@/constants";
import { supabase } from "@/lib/supabase";
import { rescheduleReminderForPlant, cancelWateringReminder } from "@/lib/notifications";
import { sendCommunityNotification } from "@/lib/communityNotifications";
import { calculateFertilizerInterval } from "@/lib/fertilizer";
import { usePlantsStore } from "@/store/plants";
import { useUserStore } from "@/store/user";
import { useProGate } from "@/hooks/useProGate";
import { UpgradeModal } from "@/components/ui/UpgradeModal";
import { invalidateSeasonalTipsCache } from "@/lib/seasonalTips";
import type { WateringEvent, Diagnosis, PlacementAnalysis, FertilizerLog, RepottingAnalysis, GrowthLog, PruningAnalysis } from "@/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WATERING_DAYS: Record<string, number> = {
  frequent: 2,
  average: 5,
  minimum: 10,
};

function getNextWateringDate(careProfile: Record<string, unknown> | null): string {
  const frequency = (careProfile?.watering as string) ?? "average";
  const days = WATERING_DAYS[frequency] ?? 5;
  const next = new Date();
  next.setDate(next.getDate() + days);
  return next.toISOString();
}

function formatDate(iso: string, locale = "en"): string {
  return new Date(iso).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function wateringDateLabel(
  iso: string,
  locale: string,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const dateStr = new Date(iso).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (days === 0) return `${t("common.today")} · ${dateStr}`;
  if (days === 1) return `${t("common.yesterday")} · ${dateStr}`;
  return dateStr;
}

/**
 * Maps common English Plant.id light condition strings to i18n keys.
 * Falls back to the raw stored value (which may already be localized for
 * new identifications where Plant.id returns the user's language).
 */
function localizeLight(
  value: string | undefined,
  t: (key: string) => string
): string {
  if (!value) return t("plantDetail.brightIndirect");
  const lower = value.toLowerCase();
  if (lower.includes("bright") && (lower.includes("indirect") || lower.includes("filtered") || lower.includes("diffuse")))
    return t("plantDetail.brightIndirect");
  if (lower.includes("indirect"))
    return t("plantDetail.brightIndirect");
  if (lower.includes("full sun") || (lower.includes("direct") && lower.includes("sun")))
    return t("plantDetail.fullSun");
  if (lower.includes("low light"))
    return t("plantDetail.lowLight");
  if (lower.includes("partial shade") || lower.includes("partial sun"))
    return t("plantDetail.partialShade");
  if (lower.includes("medium") && lower.includes("light"))
    return t("plantDetail.mediumLight");
  // Unknown value — may already be localized (new Plant.id response with language param)
  return value;
}

/**
 * Maps common English soil type strings (Plant.id URL slugs or English labels)
 * to i18n keys. Handles both old stored English labels and newer slug keys.
 */
function localizeSoilType(
  value: string | undefined,
  t: (key: string) => string
): string {
  if (!value) return t("plantDetail.wellDraining");
  const lower = value.toLowerCase().replace(/-/g, " ");
  if (lower === "hydroponic") return t("plantDetail.hydroponic");
  if (lower === "leca")        return t("plantDetail.leca");
  if (lower === "moss")        return t("plantDetail.mossSubstrate");
  if (lower === "bark")        return t("plantDetail.barkMix");
  if (lower === "coco")        return t("plantDetail.cocoSoil");
  if (lower.includes("well") || lower.includes("drain"))
    return t("plantDetail.wellDraining");
  if (lower.includes("loam"))
    return t("plantDetail.loamySoil");
  if (lower.includes("sand"))
    return t("plantDetail.sandySoil");
  if (lower.includes("clay"))
    return t("plantDetail.claySoil");
  if (lower.includes("moist") || lower.includes("moisture"))
    return t("plantDetail.moistSoil");
  if (lower.includes("peat") || lower.includes("peaty"))
    return t("plantDetail.peatySoil");
  // Unknown — may already be localized
  return value;
}

function healthMessageKey(score: number): string {
  if (score > 80) return "plantDetail.healthThriving";
  if (score > 60) return "plantDetail.healthGood";
  if (score > 40) return "plantDetail.healthAttention";
  return "plantDetail.healthUrgent";
}

function healthColor(score: number): string {
  if (score > 70) return COLORS.success;
  if (score > 40) return COLORS.warning;
  return COLORS.danger;
}

function wateringLabel(
  careProfile: Record<string, unknown> | null | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  // Diagnosis-adjusted interval takes priority
  if (careProfile?.watering_interval_days != null) {
    const days = careProfile.watering_interval_days as number;
    return t("plantDetail.everyNDays", { n: days });
  }
  const watering = careProfile?.watering as string | undefined;
  if (watering === "frequent") return t("plantDetail.every2days");
  if (watering === "minimum") return t("plantDetail.every10days");
  return t("plantDetail.every5days");
}

// ─── Care stat tile ───────────────────────────────────────────────────────────

function CareTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  // Show toggle only when value is long enough to potentially overflow 2 lines
  const canExpand = value.length > 45;

  return (
    <View style={styles.careTile}>
      {icon}
      <Text style={styles.careTileLabel}>{label}</Text>
      <Text
        style={styles.careTileValue}
        numberOfLines={expanded ? undefined : 2}
        ellipsizeMode="tail"
      >
        {value}
      </Text>
      {canExpand && (
        <TouchableOpacity
          onPress={() => setExpanded((v) => !v)}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <Text style={styles.careTileReadMore}>
            {expanded ? t("common.readLess") : t("common.readMore")}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Error boundary ───────────────────────────────────────────────────────────

interface ErrorBoundaryState { hasError: boolean }

class PlantDetailErrorBoundary extends React.Component<
  React.PropsWithChildren<{ onBack: () => void }>,
  ErrorBoundaryState
> {
  constructor(props: React.PropsWithChildren<{ onBack: () => void }>) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: COLORS.cream }}>
          <Text style={{ fontSize: 16, color: COLORS.textSecondary, marginBottom: 16 }}>Something went wrong</Text>
          <TouchableOpacity onPress={this.props.onBack}>
            <Text style={{ fontSize: 16, color: COLORS.primary, fontWeight: "600" }}>Go Back</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

function PlantDetailScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useUserStore();
  const { plants, updatePlant, removePlant } = usePlantsStore();
  const { requirePro, upgradeModalVisible, lockedFeatureName, closeUpgradeModal } = useProGate();

  const plant = plants.find((p) => p.id === id) ?? null;

  const [wateringHistory, setWateringHistory] = useState<WateringEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [isWatering, setIsWatering] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [diagnosisHistory, setDiagnosisHistory] = useState<Diagnosis[]>([]);
  const [diagnosisLoading, setDiagnosisLoading] = useState(true);
  const [placementHistory, setPlacementHistory] = useState<PlacementAnalysis[]>([]);
  const [placementLoading, setPlacementLoading] = useState(true);
  const [fertilizerHistory, setFertilizerHistory] = useState<FertilizerLog[]>([]);
  const [fertilizerLoading, setFertilizerLoading] = useState(true);
  const [repottingHistory, setRepottingHistory] = useState<RepottingAnalysis[]>([]);
  const [repottingLoading, setRepottingLoading] = useState(true);
  const [pruningHistory, setPruningHistory] = useState<PruningAnalysis[]>([]);
  const [pruningLoading, setPruningLoading] = useState(true);
  const [growthPreview, setGrowthPreview] = useState<GrowthLog[]>([]);
  const [growthLoading, setGrowthLoading] = useState(true);
  const [actionBarHeight, setActionBarHeight] = useState(0);

  // Fetch last 5 watering events — useFocusEffect ties the lifecycle to
  // screen focus so the isActive flag is set to false before navigation
  // state is torn down, preventing the 'stale' crash on Android back gesture.
  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const fetchHistory = async () => {
        if (!id) return;
        setHistoryLoading(true);
        setDiagnosisLoading(true);
        setPlacementLoading(true);
        setFertilizerLoading(true);
        setRepottingLoading(true);
        setPruningLoading(true);
        setGrowthLoading(true);

        // Fetch all history in parallel
        const [wateringResult, diagnosisResult, placementResult, fertilizerLogsResult, repottingResult, pruningResult, growthResult] = await Promise.all([
          supabase
            .from("watering_events")
            .select("*")
            .eq("plant_id", id)
            .order("watered_at", { ascending: false })
            .limit(5),
          supabase
            .from("diagnoses")
            .select("*")
            .eq("plant_id", id)
            .order("created_at", { ascending: false })
            .limit(3),
          supabase
            .from("placement_analyses")
            .select("*")
            .eq("plant_id", id)
            .order("created_at", { ascending: false })
            .limit(3),
          supabase
            .from("fertilizer_logs")
            .select("*")
            .eq("plant_id", id)
            .order("fertilized_at", { ascending: false })
            .limit(3),
          supabase
            .from("repotting_analyses")
            .select("*")
            .eq("plant_id", id)
            .order("created_at", { ascending: false })
            .limit(3),
          supabase
            .from("pruning_analyses")
            .select("*")
            .eq("plant_id", id)
            .order("created_at", { ascending: false })
            .limit(3),
          supabase
            .from("growth_logs")
            .select("*")
            .eq("plant_id", id)
            .order("logged_at", { ascending: false })
            .limit(2),
        ]);

        if (!isActive) return;
        setWateringHistory((wateringResult.data ?? []) as WateringEvent[]);
        setDiagnosisHistory((diagnosisResult.data ?? []) as Diagnosis[]);
        setPlacementHistory((placementResult.data ?? []) as PlacementAnalysis[]);
        setFertilizerHistory((fertilizerLogsResult.data ?? []) as FertilizerLog[]);
        setRepottingHistory((repottingResult.data ?? []) as RepottingAnalysis[]);
        setPruningHistory((pruningResult.data ?? []) as PruningAnalysis[]);
        setGrowthPreview((growthResult.data ?? []) as GrowthLog[]);
        setHistoryLoading(false);
        setDiagnosisLoading(false);
        setPlacementLoading(false);
        setFertilizerLoading(false);
        setRepottingLoading(false);
        setPruningLoading(false);
        setGrowthLoading(false);
      };

      fetchHistory();

      return () => {
        isActive = false;
      };
    }, [id])
  );

  // Water now action
  const handleWaterNow = useCallback(async () => {
    if (!plant || !profile) return;
    setIsWatering(true);
    try {
      const now = new Date().toISOString();
      const nextWatering = getNextWateringDate(plant.care_profile);
      const newHealth = Math.min(100, plant.health_score + 10);

      await supabase.from("watering_events").insert({
        plant_id: plant.id,
        user_id: profile.id,
        watered_at: now,
      });

      const { error } = await supabase
        .from("plants")
        .update({
          last_watered_at: now,
          next_watering: nextWatering,
          health_score: newHealth,
        })
        .eq("id", plant.id);

      if (error) throw error;

      updatePlant(plant.id, {
        last_watered_at: now,
        next_watering: nextWatering,
        health_score: newHealth,
      });

      // Reschedule the watering reminder for the new next_watering date
      const updatedPlant = {
        ...plant,
        last_watered_at: now,
        next_watering: nextWatering,
        health_score: newHealth,
      };
      rescheduleReminderForPlant(updatedPlant).catch(console.warn);
      sendCommunityNotification({ type: "task_completed", plantId: plant.id, plantName: plant.name, taskType: "watering" });

      // Prepend the new event to local history
      setWateringHistory((prev) => [
        {
          id: now,
          plant_id: plant.id,
          user_id: profile.id,
          watered_at: now,
          amount_ml: null,
          notes: null,
        },
        ...prev.slice(0, 4),
      ]);

      const nextDate = new Date(nextWatering).toLocaleDateString(locale, {
        month: "short",
        day: "numeric",
      });
      Alert.alert(t("plantDetail.wateredTitle"), t("plantDetail.wateredMessage", { date: nextDate }));
    } catch (err) {
      Alert.alert(
        t("common.error"),
        err instanceof Error ? err.message : t("plantDetail.failedRecordWatering")
      );
    } finally {
      setIsWatering(false);
    }
  }, [plant, profile, updatePlant, t]);

  // ── Delete plant ──────────────────────────────────────────────────────────

  const confirmDelete = useCallback(() => {
    if (!plant) return;
    Alert.alert(
      t("plantDetail.deletePlant"),
      t("plantDetail.deleteConfirm", { name: plant.name }),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("plantDetail.delete"), style: "destructive", onPress: handleDelete },
      ]
    );
  }, [plant, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = useCallback(async () => {
    if (!plant || !profile) return;
    setIsDeleting(true);
    try {
      // 1. Delete from database (cascade deletes watering_events + diagnoses)
      const { error: dbError } = await supabase
        .from("plants")
        .delete()
        .eq("id", plant.id)
        .eq("user_id", profile.id);
      if (dbError) throw dbError;

      // 2. Delete photo from storage (best-effort — ignore 404s)
      await supabase.storage
        .from("plant-photos")
        .remove([`${profile.id}/${plant.id}.jpg`]);

      // 3. Cancel scheduled notification for this plant
      try {
        const raw = await AsyncStorage.getItem("notification_ids");
        const idMap: Record<string, string> = raw ? JSON.parse(raw) : {};
        const notifId = idMap[plant.id];
        if (notifId) {
          await cancelWateringReminder(notifId);
          delete idMap[plant.id];
          await AsyncStorage.setItem("notification_ids", JSON.stringify(idMap));
        }
      } catch {
        // Non-fatal — notification cleanup is best-effort
      }

      // 4. Remove from Zustand store
      removePlant(plant.id);
      // Invalidate seasonal tips cache — plant set has changed
      await invalidateSeasonalTipsCache(profile.id);

      // 5. Navigate back, then show confirmation
      navigation.goBack();
      // Small delay so the alert appears after navigation settles
      setTimeout(() => {
        Alert.alert("", t("plantDetail.plantDeleted", { name: plant.name }));
      }, 400);
    } catch (err) {
      Alert.alert(
        t("common.error"),
        err instanceof Error ? err.message : t("plantDetail.failedDeletePlant")
      );
    } finally {
      setIsDeleting(false);
    }
  }, [plant, profile, removePlant, navigation, t]);

  // ── Render ────────────────────────────────────────────────────────────────

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

  const careProfile = plant.care_profile as Record<string, string> | null;
  const hColor = healthColor(plant.health_score);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: actionBarHeight + 16 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero photo ──────────────────────────────────────────────────── */}
        <View style={styles.heroContainer}>
          {plant.photo_url ? (
            <Image
              source={{ uri: plant.photo_url }}
              style={styles.heroPhoto}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.heroPhoto, styles.heroPlaceholder]}>
              <Text style={styles.heroPlaceholderEmoji}>🌿</Text>
            </View>
          )}

          {/* Dark gradient overlay */}
          <View style={styles.heroOverlay} />

          {/* Back button */}
          <TouchableOpacity
            style={[styles.backButton, { top: insets.top + 12 }]}
            onPress={() => navigation.goBack()}
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <ArrowLeft size={20} color="#fff" />
          </TouchableOpacity>

          {/* Edit button */}
          <TouchableOpacity
            style={[styles.editButton, { top: insets.top + 12 }]}
            onPress={() => router.push({ pathname: "/edit-plant/[id]", params: { id: plant.id } })}
            accessibilityLabel={`Edit ${plant.name}`}
            accessibilityRole="button"
          >
            <Pencil size={18} color="#fff" />
          </TouchableOpacity>

          {/* Delete button */}
          <TouchableOpacity
            style={[styles.deleteButton, { top: insets.top + 12 }]}
            onPress={confirmDelete}
            disabled={isDeleting}
            accessibilityLabel={`Delete ${plant.name}`}
            accessibilityRole="button"
          >
            {isDeleting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Trash2 size={18} color="#fff" />
            )}
          </TouchableOpacity>

          {/* Name overlay */}
          <View style={styles.heroNameContainer}>
            <Text style={styles.heroName} numberOfLines={2}>
              {plant.name}
            </Text>
            {plant.species ? (
              <Text style={styles.heroSpecies} numberOfLines={1}>
                {plant.species}
              </Text>
            ) : null}
          </View>
        </View>

        {/* ── Care profile card ────────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("plantDetail.careProfile")}</Text>
          <View style={styles.careGrid}>
            <CareTile
              icon={<Droplets size={20} color={COLORS.secondary} />}
              label={t("plantDetail.watering")}
              value={wateringLabel(careProfile, t)}
            />
            <CareTile
              icon={<Sun size={20} color={COLORS.warning} />}
              label={t("plantDetail.light")}
              value={localizeLight(careProfile?.light as string | undefined, t)}
            />
            <CareTile
              icon={<Leaf size={20} color={COLORS.primary} />}
              label={t("plantDetail.soil")}
              value={localizeSoilType(careProfile?.soilType as string | undefined, t)}
            />
            <CareTile
              icon={<Calendar size={20} color={COLORS.textSecondary} />}
              label={t("plantDetail.added")}
              value={formatDate(plant.created_at, locale)}
            />
          </View>
        </View>

        {/* ── Health ──────────────────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("plantDetail.health")}</Text>
          <View style={styles.healthRow}>
            <Text style={[styles.healthScoreLarge, { color: hColor }]}>
              {plant.health_score}
            </Text>
            <Text style={styles.healthScoreUnit}>/100</Text>
          </View>
          <Text style={styles.healthMessage}>{t(healthMessageKey(plant.health_score))}</Text>
          {(plant.kudos_count ?? 0) > 0 && (
            <View style={styles.kudosStatRow}>
              <Sprout size={14} color={COLORS.primary} fill={COLORS.primary} />
              <Text style={styles.kudosStatText}>
                {plant.kudos_count} {t("plantDetail.kudosReceived")}
              </Text>
            </View>
          )}
        </View>

        {/* ── Watering history ─────────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("plantDetail.wateringHistory")}</Text>
          {historyLoading ? (
            <ActivityIndicator color={COLORS.secondary} style={{ marginTop: 12 }} />
          ) : wateringHistory.length === 0 ? (
            <Text style={styles.historyEmpty}>{t("plantDetail.noWateringHistory")}</Text>
          ) : (
            wateringHistory.map((event) => (
              <View key={event.id} style={styles.historyRow}>
                <View style={styles.historyIconWrap}>
                  <Droplets size={16} color={COLORS.secondary} />
                </View>
                <Text style={styles.historyLabel}>{t("plantDetail.watered")}</Text>
                <Text style={styles.historyDate}>{wateringDateLabel(event.watered_at, locale, t)}</Text>
              </View>
            ))
          )}
        </View>

        {/* ── Diagnosis history ─────────────────────────────────────────────── */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.cardTitle, { marginBottom: 0 }]}>{t("plantDetail.diagnosisHistory")}</Text>
            <TouchableOpacity
              style={styles.cardAddButton}
              onPress={() => {
                if (!requirePro(t("paywall.featureDiagnosis"))) return;
                router.push(`/diagnosis/${plant.id}`);
              }}
              accessibilityLabel={t("plantDetail.newDiagnosis")}
              accessibilityRole="button"
            >
              <Plus size={18} color={COLORS.primary} />
            </TouchableOpacity>
          </View>
          {diagnosisLoading ? (
            <ActivityIndicator color={COLORS.secondary} style={{ marginTop: 12 }} />
          ) : diagnosisHistory.length === 0 ? (
            <Text style={styles.historyEmpty}>
              {t("plantDetail.noDiagnosesYet")}
            </Text>
          ) : (
            diagnosisHistory.map((d) => {
              const result = d.result as { condition?: string } | null;
              const severityEmoji =
                d.severity === "healthy" ? "✅" :
                d.severity === "warning" ? "⚠️" : "🚨";
              return (
                <TouchableOpacity
                  key={d.id}
                  style={styles.historyRow}
                  onPress={() =>
                    router.push({
                      pathname: "/diagnosis/[id]",
                      params: {
                        id: plant.id,
                        existingDiagnosis: JSON.stringify(d),
                      },
                    })
                  }
                  activeOpacity={0.7}
                  accessibilityLabel={`View diagnosis: ${result?.condition ?? d.severity}`}
                  accessibilityRole="button"
                >
                  <View style={styles.historyIconWrap}>
                    <Text style={{ fontSize: 14 }}>{severityEmoji}</Text>
                  </View>
                  <Text style={styles.historyLabel}>
                    {result?.condition ?? d.severity}
                  </Text>
                  <Text style={styles.historyDate}>{wateringDateLabel(d.created_at, locale, t)}</Text>
                  <ChevronRight size={16} color={COLORS.textSecondary} />
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* ── Placement history ─────────────────────────────────────────────── */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.cardTitle, { marginBottom: 0 }]}>{t("plantDetail.placementHistory")}</Text>
            <TouchableOpacity
              style={styles.cardAddButton}
              onPress={() => {
                if (!requirePro(t("paywall.featurePlacement"))) return;
                router.push({ pathname: "/placement/[id]", params: { id: plant.id } });
              }}
              accessibilityLabel={t("plantDetail.newPlacement")}
              accessibilityRole="button"
            >
              <Plus size={18} color={COLORS.primary} />
            </TouchableOpacity>
          </View>
          {placementLoading ? (
            <ActivityIndicator color={COLORS.secondary} style={{ marginTop: 12 }} />
          ) : placementHistory.length === 0 ? (
            <Text style={styles.historyEmpty}>
              {t("plantDetail.noPlacementYet")}
            </Text>
          ) : (
            placementHistory.map((p) => {
              const overallEmoji =
                p.overall === "good" ? "✅" :
                p.overall === "warning" ? "⚠️" : "❌";
              const shortDate = new Date(p.created_at).toLocaleDateString(locale, {
                month: "short",
                day: "numeric",
              });
              return (
                <TouchableOpacity
                  key={p.id}
                  style={styles.historyRow}
                  onPress={() =>
                    router.push({
                      pathname: "/placement/[id]",
                      params: {
                        id: plant.id,
                        existingAnalysis: JSON.stringify(p),
                      },
                    })
                  }
                  activeOpacity={0.7}
                  accessibilityLabel={`View placement analysis: ${p.overall}, score ${p.score}`}
                  accessibilityRole="button"
                >
                  <View style={styles.historyIconWrap}>
                    <Text style={{ fontSize: 14 }}>{overallEmoji}</Text>
                  </View>
                  <Text style={styles.historyLabel}>{p.score}/100</Text>
                  <Text style={styles.historyDate}>{shortDate}</Text>
                  <ChevronRight size={16} color={COLORS.textSecondary} />
                </TouchableOpacity>
              );
            })
          )}
        </View>
        {/* ── Fertilizer logs ───────────────────────────────────────────────── */}
        {(() => {
          const intervalDays = plant.fertilizer_interval_days ?? calculateFertilizerInterval(plant.species, new Date().getMonth());
          const nextFertDate = plant.next_fertilizer_at
            ? new Date(plant.next_fertilizer_at).toLocaleDateString(locale, { month: "short", day: "numeric" })
            : t("plantDetail.notSet");
          const isOverdue = plant.next_fertilizer_at && new Date(plant.next_fertilizer_at) <= new Date();
          return (
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={[styles.cardTitle, { marginBottom: 0 }]}>{t("plantDetail.fertilizerHistory")}</Text>
              {isOverdue && (
                <View style={styles.fertDueBadge}>
                  <Text style={styles.fertDueBadgeText}>{t("plantDetail.due")}</Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              style={styles.cardAddButton}
              onPress={() => {
                if (!requirePro(t("paywall.featureFertilizer"))) return;
                router.push({ pathname: "/fertilizer/[id]", params: { id: plant.id } });
              }}
              accessibilityLabel={t("plantDetail.newFertilizer")}
              accessibilityRole="button"
            >
              <Plus size={18} color={COLORS.primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.fertInfoRow}>
            <View style={styles.fertInfoItem}>
              <Text style={styles.fertInfoLabel}>{t("plantDetail.next")}</Text>
              <Text style={styles.fertInfoValue}>{nextFertDate}</Text>
            </View>
            <View style={styles.fertInfoItem}>
              <Text style={styles.fertInfoLabel}>{t("plantDetail.interval")}</Text>
              <Text style={styles.fertInfoValue}>{t("plantDetail.everyNDays", { n: intervalDays })}</Text>
            </View>
          </View>

          <View style={{ height: 1, backgroundColor: COLORS.cream, marginVertical: 12 }} />

          {fertilizerLoading ? (
            <ActivityIndicator color={COLORS.secondary} style={{ marginTop: 12 }} />
          ) : fertilizerHistory.length === 0 ? (
            <Text style={styles.historyEmpty}>
              {t("plantDetail.noFertilizerYet")}
            </Text>
          ) : (
            fertilizerHistory.map((f) => (
              <View key={f.id} style={styles.historyRow}>
                <View style={styles.historyIconWrap}>
                  <Text style={{ fontSize: 14 }}>🌱</Text>
                </View>
                <Text style={styles.historyLabel}>
                  {f.fertilizer_type ? f.fertilizer_type.charAt(0).toUpperCase() + f.fertilizer_type.slice(1) : t("plantDetail.fertilized")}
                </Text>
                <Text style={styles.historyDate}>{wateringDateLabel(f.fertilized_at, locale, t)}</Text>
              </View>
            ))
          )}
        </View>
          );
        })()}

        {/* ── Repotting history ─────────────────────────────────────────────── */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.cardTitle, { marginBottom: 0 }]}>{t("plantDetail.repottingHistory")}</Text>
            <TouchableOpacity
              style={styles.cardAddButton}
              onPress={() => {
                if (!requirePro(t("paywall.featureRepotting"))) return;
                router.push({ pathname: "/repotting/[id]", params: { id: plant.id } });
              }}
              accessibilityLabel={t("plantDetail.newRepotting")}
              accessibilityRole="button"
            >
              <Plus size={18} color={COLORS.primary} />
            </TouchableOpacity>
          </View>
          {repottingLoading ? (
            <ActivityIndicator color={COLORS.secondary} style={{ marginTop: 12 }} />
          ) : repottingHistory.length === 0 ? (
            <Text style={styles.historyEmpty}>
              {t("plantDetail.noRepottingYet")}
            </Text>
          ) : (
            repottingHistory.map((r) => {
              const recEmoji =
                r.recommendation === "repot_now" ? "🚨" :
                r.recommendation === "repot_soon" ? "⚠️" : "✅";
              const recLabel =
                r.recommendation === "repot_now" ? t("repotting.repotNow") :
                r.recommendation === "repot_soon" ? t("repotting.repotSoon") : t("repotting.wait");
              const shortDate = new Date(r.created_at).toLocaleDateString(locale, {
                month: "short", day: "numeric",
              });
              return (
                <TouchableOpacity
                  key={r.id}
                  style={styles.historyRow}
                  onPress={() =>
                    router.push({
                      pathname: "/repotting/[id]",
                      params: { id: plant.id, existingAnalysis: JSON.stringify(r) },
                    })
                  }
                  activeOpacity={0.7}
                  accessibilityLabel={`View repotting analysis: ${recLabel}`}
                  accessibilityRole="button"
                >
                  <View style={styles.historyIconWrap}>
                    <Text style={{ fontSize: 14 }}>{recEmoji}</Text>
                  </View>
                  <Text style={styles.historyLabel}>{recLabel}</Text>
                  <Text style={styles.historyDate}>{shortDate}</Text>
                  <ChevronRight size={16} color={COLORS.textSecondary} />
                </TouchableOpacity>
              );
            })
          )}
        </View>
        {/* ── Pruning history ───────────────────────────────────────────────── */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.cardTitle, { marginBottom: 0 }]}>{t("plantDetail.pruningHistory")}</Text>
            <TouchableOpacity
              style={styles.cardAddButton}
              onPress={() => {
                if (!requirePro(t("paywall.featurePruning"))) return;
                router.push({ pathname: "/pruning/[id]", params: { id: plant.id } });
              }}
              accessibilityLabel={t("plantDetail.newPruning")}
              accessibilityRole="button"
            >
              <Plus size={18} color={COLORS.primary} />
            </TouchableOpacity>
          </View>
          {pruningLoading ? (
            <ActivityIndicator color={COLORS.secondary} style={{ marginTop: 12 }} />
          ) : pruningHistory.length === 0 ? (
            <Text style={styles.historyEmpty}>
              {t("plantDetail.noPruningYet")}
            </Text>
          ) : (
            pruningHistory.map((p) => {
              const recEmoji =
                p.recommendation === "prune_now" ? "✂️" :
                p.recommendation === "prune_soon" ? "⚠️" : "✅";
              const recLabel =
                p.recommendation === "prune_now" ? t("pruning.pruneNow") :
                p.recommendation === "prune_soon" ? t("pruning.pruneSoon") : t("pruning.wait");
              const shortDate = new Date(p.created_at).toLocaleDateString(locale, {
                month: "short", day: "numeric",
              });
              return (
                <TouchableOpacity
                  key={p.id}
                  style={styles.historyRow}
                  onPress={() =>
                    router.push({
                      pathname: "/pruning/[id]",
                      params: { id: plant.id, existingAnalysis: JSON.stringify(p) },
                    })
                  }
                  activeOpacity={0.7}
                  accessibilityLabel={`View pruning analysis: ${recLabel}`}
                  accessibilityRole="button"
                >
                  <View style={styles.historyIconWrap}>
                    <Text style={{ fontSize: 14 }}>{recEmoji}</Text>
                  </View>
                  <Text style={styles.historyLabel}>{recLabel}</Text>
                  <Text style={styles.historyDate}>{shortDate}</Text>
                  <ChevronRight size={16} color={COLORS.textSecondary} />
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* ── Growth timeline preview ───────────────────────────────────────── */}
        <View style={styles.card}>
          <View style={styles.growthPreviewHeader}>
            <Text style={[styles.cardTitle, { marginBottom: 0 }]}>{t("plantDetail.growthTimeline")}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <TouchableOpacity
                style={styles.cardAddButton}
                onPress={() => router.push({ pathname: "/growth/[id]", params: { id: plant.id } })}
                accessibilityLabel={t("plantDetail.newGrowth")}
                accessibilityRole="button"
              >
                <Plus size={18} color={COLORS.primary} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => router.push({ pathname: "/growth/[id]", params: { id: plant.id } })}
                accessibilityLabel={t("plantDetail.viewAllGrowth")}
                accessibilityRole="button"
              >
                <Text style={styles.viewAllText}>{t("plantDetail.viewAll")} →</Text>
              </TouchableOpacity>
            </View>
          </View>
          {growthLoading ? (
            <ActivityIndicator color={COLORS.secondary} style={{ marginTop: 12 }} />
          ) : growthPreview.length === 0 ? (
            <TouchableOpacity
              onPress={() => router.push({ pathname: "/growth/[id]", params: { id: plant.id } })}
              activeOpacity={0.7}
            >
              <Text style={styles.historyEmpty}>{t("plantDetail.trackGrowthHint")}</Text>
            </TouchableOpacity>
          ) : (
            growthPreview.map((log) => (
              <TouchableOpacity
                key={log.id}
                style={styles.growthPreviewRow}
                onPress={() => router.push({ pathname: "/growth/[id]", params: { id: plant.id } })}
                activeOpacity={0.7}
                accessibilityLabel={`Growth entry from ${formatDate(log.logged_at, locale)}`}
                accessibilityRole="button"
              >
                {log.photo_url ? (
                  <Image source={{ uri: log.photo_url }} style={styles.growthThumb} />
                ) : (
                  <View style={styles.growthThumbPlaceholder}>
                    <Text style={{ fontSize: 18 }}>🌿</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyDate}>{formatDate(log.logged_at, locale)}</Text>
                  {log.height_cm != null && (
                    <Text style={styles.historyLabel}>📏 {log.height_cm} cm</Text>
                  )}
                  {log.notes ? (
                    <Text style={[styles.historyDate, { marginTop: 2 }]} numberOfLines={1}>{log.notes}</Text>
                  ) : null}
                </View>
                <ChevronRight size={16} color={COLORS.textSecondary} />
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>

      {/* ── Fixed action buttons ─────────────────────────────────────────── */}
      <View
        style={[
          styles.actionBar,
          { paddingBottom: insets.bottom + 12 },
        ]}
        onLayout={(e) => setActionBarHeight(e.nativeEvent.layout.height)}
      >
        <TouchableOpacity
          style={styles.actionButtonPrimary}
          onPress={handleWaterNow}
          disabled={isWatering}
          activeOpacity={0.85}
        >
          {isWatering ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Droplets size={18} color="#fff" />
              <Text style={styles.actionButtonPrimaryText}>{t("plantDetail.waterNow")}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <UpgradeModal
        visible={upgradeModalVisible}
        featureName={lockedFeatureName}
        onClose={closeUpgradeModal}
        onUpgrade={() => {
          closeUpgradeModal();
          router.push("/paywall");
        }}
      />
    </View>
  );
}

export default function PlantDetailScreenWrapper() {
  const navigation = useNavigation();
  return (
    <PlantDetailErrorBoundary onBack={() => navigation.goBack()}>
      <PlantDetailScreen />
    </PlantDetailErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.cream,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 120,
  },
  notFound: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.cream,
  },
  notFoundText: {
    fontSize: 18,
    color: COLORS.textSecondary,
    marginBottom: 12,
  },
  backLink: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: "600",
  },

  // ── Hero ──────────────────────────────────────────────────────────────────
  heroContainer: {
    position: "relative",
    width: "100%",
    height: 280,
  },
  heroPhoto: {
    width: "100%",
    height: 280,
  },
  heroPlaceholder: {
    backgroundColor: COLORS.lightgreen,
    alignItems: "center",
    justifyContent: "center",
  },
  heroPlaceholderEmoji: {
    fontSize: 80,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  backButton: {
    position: "absolute",
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  editButton: {
    position: "absolute",
    right: 68,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteButton: {
    position: "absolute",
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroNameContainer: {
    position: "absolute",
    bottom: 20,
    left: 20,
    right: 20,
  },
  heroName: {
    fontSize: 26,
    fontWeight: "800",
    color: "#fff",
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  heroSpecies: {
    fontSize: 15,
    fontStyle: "italic",
    color: "rgba(255,255,255,0.85)",
    marginTop: 2,
  },

  // ── Card ──────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: "#fff",
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 20,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 16,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  cardAddButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Care grid ────────────────────────────────────────────────────────────
  careGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  careTile: {
    width: "47%",
    backgroundColor: COLORS.cream,
    borderRadius: 14,
    padding: 14,
    gap: 4,
    minHeight: 100,
  },
  careTileLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 6,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  careTileValue: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textPrimary,
  },
  careTileReadMore: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.primary,
    marginTop: 2,
  },

  // ── Health ────────────────────────────────────────────────────────────────
  healthRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
    marginBottom: 8,
  },
  healthScoreLarge: {
    fontSize: 52,
    fontWeight: "800",
    lineHeight: 56,
  },
  healthScoreUnit: {
    fontSize: 20,
    fontWeight: "500",
    color: COLORS.textSecondary,
  },
  healthMessage: {
    fontSize: 15,
    color: COLORS.textSecondary,
  },
  kudosStatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 8,
  },
  kudosStatText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: "600",
  },

  // ── Watering history ──────────────────────────────────────────────────────
  historyEmpty: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontStyle: "italic",
    marginTop: 4,
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cream,
  },
  historyIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.lightgreen,
    alignItems: "center",
    justifyContent: "center",
  },
  historyLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
    color: COLORS.textPrimary,
  },
  historyDate: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },

  // ── Action bar ────────────────────────────────────────────────────────────
  actionBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    paddingTop: 12,
    paddingHorizontal: 16,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.cream,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 8,
  },
  actionButtonPrimary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    paddingVertical: 16,
    gap: 8,
  },
  actionButtonPrimaryText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
  // ── Fertilizer card ───────────────────────────────────────────────────────
  fertDueBadge: {
    backgroundColor: "#FEE2E2",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  fertDueBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#991B1B",
  },
  fertInfoRow: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 16,
  },
  fertInfoItem: {
    flex: 1,
    backgroundColor: COLORS.cream,
    borderRadius: 12,
    padding: 12,
  },
  fertInfoLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
    fontWeight: "500",
  },
  fertInfoValue: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  fertTypeLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontWeight: "500",
    marginBottom: 8,
  },
  fertTypeRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  fertTypePill: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.cream,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
  },
  fertTypePillSelected: {
    backgroundColor: COLORS.lightgreen,
    borderColor: COLORS.secondary,
  },
  fertTypePillText: {
    fontSize: 12,
    fontWeight: "500",
    color: COLORS.textSecondary,
  },
  fertTypePillTextSelected: {
    color: COLORS.primary,
    fontWeight: "700",
  },
  // ── Growth preview ────────────────────────────────────────────────────────
  growthPreviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  viewAllText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.primary,
  },
  growthPreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cream,
  },
  growthThumb: {
    width: 52,
    height: 52,
    borderRadius: 10,
  },
  growthThumbPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: COLORS.lightgreen,
    alignItems: "center",
    justifyContent: "center",
  },
});

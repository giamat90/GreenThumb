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
  FlaskConical,
  MapPin,
  Layers,
  TrendingUp,
  Trash2,
} from "lucide-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { COLORS } from "@/constants";
import { supabase } from "@/lib/supabase";
import { rescheduleReminderForPlant, cancelWateringReminder, rescheduleFertilizerReminderForPlant } from "@/lib/notifications";
import { calculateFertilizerInterval } from "@/lib/fertilizer";
import { usePlantsStore } from "@/store/plants";
import { useUserStore } from "@/store/user";
import type { WateringEvent, Diagnosis, PlacementAnalysis, FertilizerLog, RepottingAnalysis, GrowthLog } from "@/types";

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

function healthMessage(score: number): string {
  if (score > 80) return "Your plant is thriving! 🌟";
  if (score > 60) return "Doing well, keep it up 👍";
  if (score > 40) return "Needs some attention ⚠️";
  return "Urgent care needed! 🚨";
}

function healthColor(score: number): string {
  if (score > 70) return COLORS.success;
  if (score > 40) return COLORS.warning;
  return COLORS.danger;
}

function wateringLabel(watering: string | undefined): string {
  if (watering === "frequent") return "Every 2 days";
  if (watering === "minimum") return "Every 10 days";
  return "Every 5 days";
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
  return (
    <View style={styles.careTile}>
      {icon}
      <Text style={styles.careTileLabel}>{label}</Text>
      <Text style={styles.careTileValue}>{value}</Text>
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
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F8F9FA" }}>
          <Text style={{ fontSize: 16, color: "#6B7280", marginBottom: 16 }}>Something went wrong</Text>
          <TouchableOpacity onPress={this.props.onBack}>
            <Text style={{ fontSize: 16, color: "#2D6A4F", fontWeight: "600" }}>Go Back</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

function PlantDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useUserStore();
  const { plants, updatePlant, removePlant } = usePlantsStore();

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
  const [isFertilizing, setIsFertilizing] = useState(false);
  const [repottingHistory, setRepottingHistory] = useState<RepottingAnalysis[]>([]);
  const [repottingLoading, setRepottingLoading] = useState(true);
  const [growthPreview, setGrowthPreview] = useState<GrowthLog[]>([]);
  const [growthLoading, setGrowthLoading] = useState(true);

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
        setGrowthLoading(true);

        // Fetch all history in parallel
        const [wateringResult, diagnosisResult, placementResult, fertilizerLogsResult, repottingResult, growthResult] = await Promise.all([
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
        setGrowthPreview((growthResult.data ?? []) as GrowthLog[]);
        setHistoryLoading(false);
        setDiagnosisLoading(false);
        setPlacementLoading(false);
        setFertilizerLoading(false);
        setRepottingLoading(false);
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

      const nextDate = new Date(nextWatering).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      Alert.alert("✅ Watered!", `Next reminder set for ${nextDate}.`);
    } catch (err) {
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "Failed to record watering."
      );
    } finally {
      setIsWatering(false);
    }
  }, [plant, profile, updatePlant]);

  // ── Delete plant ──────────────────────────────────────────────────────────

  const confirmDelete = useCallback(() => {
    if (!plant) return;
    Alert.alert(
      "Delete Plant",
      `Are you sure you want to delete ${plant.name}? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: handleDelete },
      ]
    );
  }, [plant]); // eslint-disable-line react-hooks/exhaustive-deps

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

      // 5. Navigate back, then show confirmation
      navigation.goBack();
      // Small delay so the alert appears after navigation settles
      setTimeout(() => {
        Alert.alert("", `🗑️ ${plant.name} deleted`);
      }, 400);
    } catch (err) {
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "Failed to delete plant."
      );
    } finally {
      setIsDeleting(false);
    }
  }, [plant, profile, removePlant, navigation]);

  // ── Fertilize now ─────────────────────────────────────────────────────────

  const handleFertilizeNow = useCallback(async () => {
    if (!plant || !profile) return;
    setIsFertilizing(true);
    try {
      const now = new Date().toISOString();
      const intervalDays = plant.fertilizer_interval_days ?? calculateFertilizerInterval(plant.species, new Date().getMonth());
      const nextDate = new Date();
      nextDate.setDate(nextDate.getDate() + intervalDays);
      const nextFertilizerAt = nextDate.toISOString();

      await supabase.from("fertilizer_logs").insert({
        plant_id: plant.id,
        user_id: profile.id,
        fertilized_at: now,
        fertilizer_type: plant.fertilizer_type ?? "liquid",
      });

      const { error } = await supabase
        .from("plants")
        .update({ last_fertilized_at: now, next_fertilizer_at: nextFertilizerAt })
        .eq("id", plant.id);
      if (error) throw error;

      updatePlant(plant.id, { last_fertilized_at: now, next_fertilizer_at: nextFertilizerAt });

      rescheduleFertilizerReminderForPlant({ ...plant, last_fertilized_at: now, next_fertilizer_at: nextFertilizerAt }).catch(console.warn);

      setFertilizerHistory((prev) => [
        { id: now, plant_id: plant.id, user_id: profile.id, fertilized_at: now, fertilizer_type: plant.fertilizer_type ?? "liquid", notes: null },
        ...prev.slice(0, 2),
      ]);

      const nextDateStr = nextDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      Alert.alert("🌱 Fertilized!", `Next fertilizer reminder set for ${nextDateStr}.`);
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed to record fertilization.");
    } finally {
      setIsFertilizing(false);
    }
  }, [plant, profile, updatePlant]);

  const handleChangeFertilizerType = useCallback(() => {
    if (!plant || !profile) return;
    Alert.alert("Fertilizer Type", "Choose your fertilizer type:", [
      {
        text: "Liquid",
        onPress: async () => {
          await supabase.from("plants").update({ fertilizer_type: "liquid" }).eq("id", plant.id);
          updatePlant(plant.id, { fertilizer_type: "liquid" });
        },
      },
      {
        text: "Granular",
        onPress: async () => {
          await supabase.from("plants").update({ fertilizer_type: "granular" }).eq("id", plant.id);
          updatePlant(plant.id, { fertilizer_type: "granular" });
        },
      },
      {
        text: "Slow-release",
        onPress: async () => {
          await supabase.from("plants").update({ fertilizer_type: "slow-release" }).eq("id", plant.id);
          updatePlant(plant.id, { fertilizer_type: "slow-release" });
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [plant, profile, updatePlant]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!plant) {
    return (
      <View style={styles.notFound}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.notFoundText}>Plant not found.</Text>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backLink}>← Go back</Text>
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
          { paddingBottom: insets.bottom + 120 },
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
          <Text style={styles.cardTitle}>Care Profile</Text>
          <View style={styles.careGrid}>
            <CareTile
              icon={<Droplets size={20} color={COLORS.secondary} />}
              label="Watering"
              value={wateringLabel(careProfile?.watering)}
            />
            <CareTile
              icon={<Sun size={20} color={COLORS.warning} />}
              label="Light"
              value={careProfile?.light ?? "Bright indirect"}
            />
            <CareTile
              icon={<Leaf size={20} color={COLORS.primary} />}
              label="Soil"
              value={careProfile?.soilType ?? "Well-draining"}
            />
            <CareTile
              icon={<Calendar size={20} color={COLORS.textSecondary} />}
              label="Added"
              value={formatDate(plant.created_at)}
            />
          </View>
        </View>

        {/* ── Fertilizer ───────────────────────────────────────────────────── */}
        {(() => {
          const intervalDays = plant.fertilizer_interval_days ?? calculateFertilizerInterval(plant.species, new Date().getMonth());
          const nextFertDate = plant.next_fertilizer_at
            ? new Date(plant.next_fertilizer_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : "Not set";
          const fertType = plant.fertilizer_type ?? "liquid";
          const isOverdue = plant.next_fertilizer_at && new Date(plant.next_fertilizer_at) <= new Date();
          return (
            <View style={styles.card}>
              <View style={styles.fertCardHeader}>
                <Text style={styles.cardTitle}>Fertilizer</Text>
                {isOverdue && (
                  <View style={styles.fertDueBadge}>
                    <Text style={styles.fertDueBadgeText}>Due</Text>
                  </View>
                )}
              </View>

              <View style={styles.fertInfoRow}>
                <View style={styles.fertInfoItem}>
                  <Text style={styles.fertInfoLabel}>Next</Text>
                  <Text style={styles.fertInfoValue}>{nextFertDate}</Text>
                </View>
                <View style={styles.fertInfoItem}>
                  <Text style={styles.fertInfoLabel}>Interval</Text>
                  <Text style={styles.fertInfoValue}>Every {intervalDays}d</Text>
                </View>
              </View>

              <Text style={styles.fertTypeLabel}>Type</Text>
              <View style={styles.fertTypeRow}>
                {(["liquid", "granular", "slow-release"] as const).map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.fertTypePill, fertType === t && styles.fertTypePillSelected]}
                    onPress={handleChangeFertilizerType}
                    accessibilityLabel={`Set fertilizer type to ${t}`}
                  >
                    <Text style={[styles.fertTypePillText, fertType === t && styles.fertTypePillTextSelected]}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={styles.fertilizeButton}
                onPress={handleFertilizeNow}
                disabled={isFertilizing}
                activeOpacity={0.85}
              >
                {isFertilizing ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.fertilizeButtonText}>Fertilize Now 🌱</Text>
                )}
              </TouchableOpacity>
            </View>
          );
        })()}

        {/* ── Health ──────────────────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Health</Text>
          <View style={styles.healthRow}>
            <Text style={[styles.healthScoreLarge, { color: hColor }]}>
              {plant.health_score}
            </Text>
            <Text style={styles.healthScoreUnit}>/100</Text>
          </View>
          <Text style={styles.healthMessage}>{healthMessage(plant.health_score)}</Text>
        </View>

        {/* ── Watering history ─────────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Watering History</Text>
          {historyLoading ? (
            <ActivityIndicator color={COLORS.secondary} style={{ marginTop: 12 }} />
          ) : wateringHistory.length === 0 ? (
            <Text style={styles.historyEmpty}>No watering history yet</Text>
          ) : (
            wateringHistory.map((event) => (
              <View key={event.id} style={styles.historyRow}>
                <View style={styles.historyIconWrap}>
                  <Droplets size={16} color={COLORS.secondary} />
                </View>
                <Text style={styles.historyLabel}>Watered</Text>
                <Text style={styles.historyDate}>{timeAgo(event.watered_at)}</Text>
              </View>
            ))
          )}
        </View>

        {/* ── Diagnosis history ─────────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Diagnosis History</Text>
          {diagnosisLoading ? (
            <ActivityIndicator color={COLORS.secondary} style={{ marginTop: 12 }} />
          ) : diagnosisHistory.length === 0 ? (
            <Text style={styles.historyEmpty}>
              No diagnoses yet — tap Diagnose Health to get started
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
                  <Text style={styles.historyDate}>{timeAgo(d.created_at)}</Text>
                  <ChevronRight size={16} color={COLORS.textSecondary} />
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* ── Placement history ─────────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Placement History</Text>
          {placementLoading ? (
            <ActivityIndicator color={COLORS.secondary} style={{ marginTop: 12 }} />
          ) : placementHistory.length === 0 ? (
            <Text style={styles.historyEmpty}>
              No placement checks yet — tap Placement to get started
            </Text>
          ) : (
            placementHistory.map((p) => {
              const overallEmoji =
                p.overall === "good" ? "✅" :
                p.overall === "warning" ? "⚠️" : "❌";
              const shortDate = new Date(p.created_at).toLocaleDateString("en-US", {
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
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Fertilizer History</Text>
          {fertilizerLoading ? (
            <ActivityIndicator color={COLORS.secondary} style={{ marginTop: 12 }} />
          ) : fertilizerHistory.length === 0 ? (
            <Text style={styles.historyEmpty}>
              No fertilizations yet — tap Fertilize Now to get started
            </Text>
          ) : (
            fertilizerHistory.map((f) => (
              <View key={f.id} style={styles.historyRow}>
                <View style={styles.historyIconWrap}>
                  <Text style={{ fontSize: 14 }}>🌱</Text>
                </View>
                <Text style={styles.historyLabel}>
                  {f.fertilizer_type ? f.fertilizer_type.charAt(0).toUpperCase() + f.fertilizer_type.slice(1) : "Fertilized"}
                </Text>
                <Text style={styles.historyDate}>{timeAgo(f.fertilized_at)}</Text>
              </View>
            ))
          )}
        </View>

        {/* ── Repotting history ─────────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Repotting History</Text>
          {repottingLoading ? (
            <ActivityIndicator color={COLORS.secondary} style={{ marginTop: 12 }} />
          ) : repottingHistory.length === 0 ? (
            <Text style={styles.historyEmpty}>
              No repotting checks yet — tap Repot to get started
            </Text>
          ) : (
            repottingHistory.map((r) => {
              const recEmoji =
                r.recommendation === "repot_now" ? "🚨" :
                r.recommendation === "repot_soon" ? "⚠️" : "✅";
              const recLabel =
                r.recommendation === "repot_now" ? "Repot Now" :
                r.recommendation === "repot_soon" ? "Repot Soon" : "All Good";
              const shortDate = new Date(r.created_at).toLocaleDateString("en-US", {
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
        {/* ── Growth timeline preview ───────────────────────────────────────── */}
        <View style={styles.card}>
          <View style={styles.growthPreviewHeader}>
            <Text style={[styles.cardTitle, { marginBottom: 0 }]}>Growth Timeline</Text>
            <TouchableOpacity
              onPress={() => router.push({ pathname: "/growth/[id]", params: { id: plant.id } })}
              accessibilityLabel="View full growth timeline"
              accessibilityRole="button"
            >
              <Text style={styles.viewAllText}>View all →</Text>
            </TouchableOpacity>
          </View>
          {growthLoading ? (
            <ActivityIndicator color={COLORS.secondary} style={{ marginTop: 12 }} />
          ) : growthPreview.length === 0 ? (
            <TouchableOpacity
              onPress={() => router.push({ pathname: "/growth/[id]", params: { id: plant.id } })}
              activeOpacity={0.7}
            >
              <Text style={styles.historyEmpty}>Track growth → Log your first height measurement</Text>
            </TouchableOpacity>
          ) : (
            growthPreview.map((log) => (
              <TouchableOpacity
                key={log.id}
                style={styles.growthPreviewRow}
                onPress={() => router.push({ pathname: "/growth/[id]", params: { id: plant.id } })}
                activeOpacity={0.7}
                accessibilityLabel={`Growth entry from ${formatDate(log.logged_at)}`}
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
                  <Text style={styles.historyDate}>{formatDate(log.logged_at)}</Text>
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
      >
        {/* Secondary actions: 2×2 grid */}
        <View style={styles.actionButtonGrid}>
          <View style={styles.actionButtonRow}>
            <TouchableOpacity
              style={styles.actionButtonSecondary}
              activeOpacity={0.8}
              onPress={() => router.push(`/diagnosis/${plant.id}`)}
              accessibilityLabel="Diagnose plant health"
              accessibilityRole="button"
            >
              <FlaskConical size={16} color={COLORS.primary} />
              <Text style={styles.actionButtonSecondaryText}>Diagnose 🔬</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionButtonSecondary}
              activeOpacity={0.8}
              onPress={() => router.push({ pathname: "/placement/[id]", params: { id: plant.id } })}
              accessibilityLabel="Check plant placement"
              accessibilityRole="button"
            >
              <MapPin size={16} color={COLORS.primary} />
              <Text style={styles.actionButtonSecondaryText}>Placement 📍</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.actionButtonRow}>
            <TouchableOpacity
              style={styles.actionButtonSecondary}
              activeOpacity={0.8}
              onPress={() => router.push({ pathname: "/repotting/[id]", params: { id: plant.id } })}
              accessibilityLabel="Repotting advisor"
              accessibilityRole="button"
            >
              <Layers size={16} color={COLORS.primary} />
              <Text style={styles.actionButtonSecondaryText}>Repot 🪴</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionButtonSecondary}
              activeOpacity={0.8}
              onPress={() => router.push({ pathname: "/growth/[id]", params: { id: plant.id } })}
              accessibilityLabel="Track plant growth"
              accessibilityRole="button"
            >
              <TrendingUp size={16} color={COLORS.primary} />
              <Text style={styles.actionButtonSecondaryText}>Growth 📈</Text>
            </TouchableOpacity>
          </View>
        </View>

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
              <Text style={styles.actionButtonPrimaryText}>Water Now 💧</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
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
  actionButtonGrid: {
    gap: 8,
  },
  actionButtonRow: {
    flexDirection: "row",
    gap: 8,
  },
  actionButtonSecondary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderRadius: 16,
    paddingVertical: 13,
    gap: 6,
  },
  actionButtonSecondaryText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.primary,
  },

  // ── Fertilizer card ───────────────────────────────────────────────────────
  fertCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
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
  fertilizeButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  fertilizeButtonText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
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

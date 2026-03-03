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
import { Stack, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeft,
  Droplets,
  Sun,
  Leaf,
  Calendar,
  FlaskConical,
} from "lucide-react-native";

import { COLORS } from "@/constants";
import { supabase } from "@/lib/supabase";
import { usePlantsStore } from "@/store/plants";
import { useUserStore } from "@/store/user";
import type { WateringEvent } from "@/types";

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
  const insets = useSafeAreaInsets();
  const { profile } = useUserStore();
  const { plants, updatePlant } = usePlantsStore();

  const plant = plants.find((p) => p.id === id) ?? null;

  const [wateringHistory, setWateringHistory] = useState<WateringEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [isWatering, setIsWatering] = useState(false);

  // Fetch last 5 watering events — useFocusEffect ties the lifecycle to
  // screen focus so the isActive flag is set to false before navigation
  // state is torn down, preventing the 'stale' crash on Android back gesture.
  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const fetchHistory = async () => {
        if (!id) return;
        setHistoryLoading(true);
        const { data } = await supabase
          .from("watering_events")
          .select("*")
          .eq("plant_id", id)
          .order("watered_at", { ascending: false })
          .limit(5);
        if (!isActive) return;
        setWateringHistory((data ?? []) as WateringEvent[]);
        setHistoryLoading(false);
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

      Alert.alert("Watered! 💧", `${plant.name} has been watered.`);
    } catch (err) {
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "Failed to record watering."
      );
    } finally {
      setIsWatering(false);
    }
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
          >
            <ArrowLeft size={20} color="#fff" />
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
      </ScrollView>

      {/* ── Fixed action buttons ─────────────────────────────────────────── */}
      <View
        style={[
          styles.actionBar,
          { paddingBottom: insets.bottom + 12 },
        ]}
      >
        <TouchableOpacity
          style={styles.actionButtonSecondary}
          activeOpacity={0.8}
        >
          <FlaskConical size={18} color={COLORS.primary} />
          <Text style={styles.actionButtonSecondaryText}>Diagnose Health 🔬</Text>
        </TouchableOpacity>

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
  actionButtonSecondary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderRadius: 16,
    paddingVertical: 14,
    gap: 8,
  },
  actionButtonSecondaryText: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.primary,
  },
});

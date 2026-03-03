import React, { useCallback, useRef, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Alert,
  StyleSheet,
  Animated,
  TouchableOpacity,
  RefreshControl,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { SlidersHorizontal, Droplets, Heart, Leaf, X } from "lucide-react-native";

import { COLORS } from "@/constants";
import { usePlants } from "@/hooks/usePlants";
import { usePlantsStore } from "@/store/plants";
import { useUserStore } from "@/store/user";
import { useWeather } from "@/hooks/useWeather";
import { supabase } from "@/lib/supabase";
import { PlantCard } from "@/components/plants/PlantCard";
import { EmptyPlants } from "@/components/plants/EmptyPlants";
import type { PlantWithStatus } from "@/hooks/usePlants";

// ─── Watering helpers ─────────────────────────────────────────────────────────

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

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function SkeletonCard({ opacity }: { opacity: Animated.Value }) {
  return (
    <Animated.View style={[styles.skeletonCard, { opacity }]}>
      <View style={styles.skeletonPhoto} />
      <View style={styles.skeletonContent}>
        <View style={styles.skeletonLine} />
        <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
        <View style={[styles.skeletonLine, styles.skeletonLineXShort]} />
      </View>
      <View style={styles.skeletonCircle} />
    </Animated.View>
  );
}

function LoadingSkeletons() {
  const opacity = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.75,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.35,
          duration: 700,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [opacity]);

  return (
    <>
      <SkeletonCard opacity={opacity} />
      <SkeletonCard opacity={opacity} />
      <SkeletonCard opacity={opacity} />
    </>
  );
}

// ─── Stat pill ────────────────────────────────────────────────────────────────

function StatPill({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string | number;
  label: string;
}) {
  return (
    <View style={styles.statPill}>
      {icon}
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

const BANNER_DISMISS_KEY = `weather_banner_dismissed_${new Date().toISOString().slice(0, 10)}`;

export default function MyPlantsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useUserStore();
  const { updatePlant } = usePlantsStore();
  const { plants, isLoading, refetch } = usePlants();
  const { weather } = useWeather();
  const [bannerVisible, setBannerVisible] = useState(false);

  // Show banner when weather has adjusted schedules (rain or extreme temp) and not dismissed today
  useEffect(() => {
    if (!weather) return;
    const hasOutdoorPlants = plants.some((p) => p.location === "outdoor" || p.location === "balcony");
    const weatherIsSignificant =
      (weather.rainExpected && weather.rainAmountMm > 2) ||
      weather.temperature > 32 ||
      weather.temperature < 5;
    if (!hasOutdoorPlants || !weatherIsSignificant) return;

    AsyncStorage.getItem(BANNER_DISMISS_KEY).then((val) => {
      if (val !== "dismissed") setBannerVisible(true);
    });
  }, [weather, plants]);

  const dismissBanner = useCallback(async () => {
    await AsyncStorage.setItem(BANNER_DISMISS_KEY, "dismissed");
    setBannerVisible(false);
  }, []);

  // Summary stats
  const needsWaterCount = plants.filter(
    (p) => p.wateringStatus === "overdue" || p.wateringStatus === "today"
  ).length;
  const avgHealth =
    plants.length > 0
      ? Math.round(plants.reduce((sum, p) => sum + p.health_score, 0) / plants.length)
      : 0;

  // ── Quick water action ────────────────────────────────────────────────────

  const handleWaterPress = useCallback(
    (plant: PlantWithStatus) => {
      Alert.alert(
        "Water Plant",
        `Mark ${plant.name} as watered?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Yes, watered! 💧",
            onPress: async () => {
              if (!profile) return;
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
              } catch (err) {
                Alert.alert(
                  "Error",
                  err instanceof Error ? err.message : "Failed to record watering."
                );
              }
            },
          },
        ]
      );
    },
    [profile, updatePlant]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const renderItem = useCallback(
    ({ item }: { item: PlantWithStatus }) => (
      <PlantCard
        plant={item}
        onPress={() => router.push(`/plant/${item.id}`)}
        onWaterPress={() => handleWaterPress(item)}
      />
    ),
    [router, handleWaterPress]
  );

  const keyExtractor = useCallback((item: PlantWithStatus) => item.id, []);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>My Plants</Text>
          <Text style={styles.headerSubtitle}>
            {plants.length} {plants.length === 1 ? "plant" : "plants"}
          </Text>
        </View>
        <TouchableOpacity style={styles.sortButton}>
          <SlidersHorizontal size={20} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      {/* Weather adjustment banner */}
      {bannerVisible && weather && (
        <View style={styles.weatherBanner}>
          <Text style={styles.weatherBannerText}>
            ☔ Watering adjusted for {weather.city} weather
          </Text>
          <TouchableOpacity onPress={dismissBanner} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <X size={16} color="#1D4ED8" />
          </TouchableOpacity>
        </View>
      )}

      {/* Summary bar — only shown when there are plants */}
      {plants.length > 0 && !isLoading && (
        <View style={styles.summaryBar}>
          <StatPill
            icon={<Leaf size={14} color={COLORS.primary} />}
            value={plants.length}
            label="plants"
          />
          <View style={styles.summaryDivider} />
          <StatPill
            icon={<Droplets size={14} color={COLORS.secondary} />}
            value={needsWaterCount}
            label="need water"
          />
          <View style={styles.summaryDivider} />
          <StatPill
            icon={<Heart size={14} color={COLORS.danger} />}
            value={`${avgHealth}%`}
            label="avg health"
          />
        </View>
      )}

      {/* Plant list */}
      {isLoading ? (
        <View style={styles.listContent}>
          <LoadingSkeletons />
        </View>
      ) : (
        <FlatList
          data={plants}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.listContent,
            plants.length === 0 && styles.listContentEmpty,
          ]}
          ListEmptyComponent={<EmptyPlants />}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={refetch}
              tintColor={COLORS.primary}
              colors={[COLORS.primary]}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.cream,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.primary,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  sortButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.lightgreen,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statPill: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  statValue: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginTop: 2,
  },
  statLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  summaryDivider: {
    width: 1,
    height: 32,
    backgroundColor: COLORS.lightgreen,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 100,
  },
  listContentEmpty: {
    flex: 1,
  },
  // ── Skeleton ────────────────────────────────────────────────────────────────
  skeletonCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 12,
    marginBottom: 12,
  },
  skeletonPhoto: {
    width: 80,
    height: 80,
    borderRadius: 16,
    backgroundColor: "#E5E7EB",
    marginRight: 12,
  },
  skeletonContent: {
    flex: 1,
    gap: 8,
  },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
    backgroundColor: "#E5E7EB",
  },
  skeletonLineShort: {
    width: "60%",
  },
  skeletonLineXShort: {
    width: "45%",
  },
  skeletonCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#E5E7EB",
    marginLeft: 8,
  },
  // ── Weather banner ───────────────────────────────────────────────────────────
  weatherBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#DBEAFE",
    marginHorizontal: 20,
    marginBottom: 10,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  weatherBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "500",
    color: "#1D4ED8",
    marginRight: 8,
  },
});

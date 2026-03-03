import React from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Droplets } from "lucide-react-native";

import { COLORS } from "@/constants";
import { useWeather } from "@/hooks/useWeather";
import { usePlants } from "@/hooks/usePlants";
import { useUserStore } from "@/store/user";
import { usePlantsStore } from "@/store/plants";
import { supabase } from "@/lib/supabase";
import { syncAllPlantSchedules } from "@/lib/syncWateringSchedules";
import type { PlantWithStatus } from "@/hooks/usePlants";
import type { Plant } from "@/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function formatToday(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

const CONDITION_EMOJI: Record<string, string> = {
  clear: "☀️",
  clouds: "⛅",
  rain: "🌧️",
  drizzle: "🌦️",
  snow: "❄️",
  thunderstorm: "⛈️",
  mist: "🌫️",
};

function weatherEmoji(condition: string): string {
  return CONDITION_EMOJI[condition] ?? "🌤️";
}

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

// ─── Sub-components ───────────────────────────────────────────────────────────

function WeatherCard({
  weather,
  isLoading,
  error,
}: {
  weather: ReturnType<typeof useWeather>["weather"];
  isLoading: boolean;
  error: string | null;
}) {
  if (isLoading) {
    return (
      <View style={styles.weatherCard}>
        <ActivityIndicator color={COLORS.primary} />
        <Text style={styles.weatherLoadingText}>Loading weather…</Text>
      </View>
    );
  }

  if (error || !weather) {
    return (
      <View style={styles.weatherCard}>
        <Text style={styles.weatherEmoji}>🌤️</Text>
        <Text style={styles.weatherError}>{error ?? "Weather unavailable"}</Text>
      </View>
    );
  }

  // Smart banner logic
  let banner: string | null = null;
  if (weather.rainExpected && weather.rainAmountMm > 5) {
    banner = "🌧️ Rain expected — outdoor plants watering adjusted";
  } else if (weather.temperature > 32) {
    banner = "🌡️ Heat wave — plants may need extra water";
  } else if (weather.temperature < 5) {
    banner = "❄️ Cold snap — reducing watering frequency";
  }

  return (
    <View style={styles.weatherCard}>
      <View style={styles.weatherTop}>
        <View>
          <Text style={styles.weatherCity}>{weather.city}</Text>
          <Text style={styles.weatherCondition}>
            {weather.condition.charAt(0).toUpperCase() + weather.condition.slice(1)}
          </Text>
        </View>
        <View style={styles.weatherRight}>
          <Text style={styles.weatherEmoji}>{weatherEmoji(weather.condition)}</Text>
          <Text style={styles.weatherTemp}>{weather.temperature}°C</Text>
        </View>
      </View>

      <View style={styles.weatherStats}>
        <View style={styles.weatherStat}>
          <Text style={styles.weatherStatLabel}>Humidity</Text>
          <Text style={styles.weatherStatValue}>{weather.humidity}%</Text>
        </View>
        <View style={styles.weatherStat}>
          <Text style={styles.weatherStatLabel}>Rain (24h)</Text>
          <Text style={styles.weatherStatValue}>{weather.rainAmountMm} mm</Text>
        </View>
        <View style={styles.weatherStat}>
          <Text style={styles.weatherStatLabel}>Tomorrow</Text>
          <Text style={styles.weatherStatValue}>
            {weather.forecast[1] ? weatherEmoji(weather.forecast[1].condition) : "—"}
          </Text>
        </View>
      </View>

      {banner ? (
        <View style={styles.weatherBanner}>
          <Text style={styles.weatherBannerText}>{banner}</Text>
        </View>
      ) : null}
    </View>
  );
}

function TaskCard({
  plant,
  onWater,
}: {
  plant: PlantWithStatus;
  onWater: () => void;
}) {
  const urgency =
    plant.wateringStatus === "overdue" ? COLORS.danger : COLORS.warning;

  return (
    <View style={styles.taskCard}>
      {plant.photo_url ? (
        <Image source={{ uri: plant.photo_url }} style={styles.taskPhoto} />
      ) : (
        <View style={[styles.taskPhoto, styles.taskPhotoPlaceholder]}>
          <Text>🌿</Text>
        </View>
      )}
      <View style={styles.taskContent}>
        <Text style={styles.taskName} numberOfLines={1}>
          {plant.name}
        </Text>
        <Text style={[styles.taskStatus, { color: urgency }]}>
          {plant.wateringStatus === "overdue" ? "Overdue! Water now" : "Water today"}
        </Text>
      </View>
      <TouchableOpacity style={styles.taskWaterButton} onPress={onWater}>
        <Droplets size={16} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useUserStore();
  const { updatePlant } = usePlantsStore();
  const { weather, isLoading: weatherLoading, error: weatherError, refresh: refreshWeather } = useWeather();
  const { plants, isLoading: plantsLoading, refetch: refetchPlants } = usePlants();

  // Sync watering schedules when weather arrives
  React.useEffect(() => {
    if (weather && plants.length > 0) {
      syncAllPlantSchedules(plants, weather, updatePlant);
    }
  }, [weather]); // eslint-disable-line react-hooks/exhaustive-deps

  const needsWater = plants.filter(
    (p) => p.wateringStatus === "overdue" || p.wateringStatus === "today"
  );

  const thriving = plants.filter((p) => p.health_score >= 70).length;
  const needsAttention = plants.filter((p) => p.health_score < 70).length;
  const avgHealth =
    plants.length > 0
      ? Math.round(plants.reduce((s, p) => s + p.health_score, 0) / plants.length)
      : 0;

  const handleWater = async (plant: PlantWithStatus) => {
    if (!profile) return;
    const now = new Date().toISOString();
    const nextWatering = getNextWateringDate(plant.care_profile);
    const newHealth = Math.min(100, plant.health_score + 10);

    await supabase.from("watering_events").insert({
      plant_id: plant.id,
      user_id: profile.id,
      watered_at: now,
    });
    await supabase
      .from("plants")
      .update({ last_watered_at: now, next_watering: nextWatering, health_score: newHealth })
      .eq("id", plant.id);
    updatePlant(plant.id, { last_watered_at: now, next_watering: nextWatering, health_score: newHealth });
  };

  const onRefresh = () => {
    refreshWeather();
    refetchPlants();
  };

  const firstName = profile?.display_name?.split(" ")[0] ?? "there";

  return (
    <ScrollView
      style={[styles.screen, { paddingTop: insets.top }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={weatherLoading || plantsLoading}
          onRefresh={onRefresh}
          tintColor={COLORS.primary}
          colors={[COLORS.primary]}
        />
      }
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.greeting}>
          {greeting()}, {firstName}! 🌿
        </Text>
        <Text style={styles.date}>{formatToday()}</Text>
      </View>

      {/* ── Weather card ───────────────────────────────────────────────────── */}
      <WeatherCard
        weather={weather}
        isLoading={weatherLoading}
        error={weatherError}
      />

      {/* ── Today's tasks ──────────────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Today's Tasks</Text>
        {plantsLoading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 12 }} />
        ) : needsWater.length === 0 ? (
          <View style={styles.allCaughtUp}>
            <Text style={styles.allCaughtUpEmoji}>🎉</Text>
            <Text style={styles.allCaughtUpText}>All caught up!</Text>
            <Text style={styles.allCaughtUpSub}>All your plants are happy</Text>
          </View>
        ) : (
          needsWater.map((plant) => (
            <TaskCard
              key={plant.id}
              plant={plant}
              onWater={() => handleWater(plant)}
            />
          ))
        )}
      </View>

      {/* ── Health summary ─────────────────────────────────────────────────── */}
      {plants.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Plant Health</Text>
          <View style={styles.healthCard}>
            <View style={styles.healthRow}>
              <Text style={styles.healthTotal}>{plants.length}</Text>
              <Text style={styles.healthTotalLabel}>
                {plants.length === 1 ? "plant" : "plants"} total
              </Text>
            </View>

            {/* Health bar */}
            <View style={styles.healthBarContainer}>
              <View
                style={[
                  styles.healthBarFill,
                  {
                    width: `${avgHealth}%` as `${number}%`,
                    backgroundColor:
                      avgHealth > 70
                        ? COLORS.success
                        : avgHealth > 40
                        ? COLORS.warning
                        : COLORS.danger,
                  },
                ]}
              />
            </View>
            <Text style={styles.healthSummary}>
              {thriving > 0 ? `${thriving} thriving` : ""}
              {thriving > 0 && needsAttention > 0 ? ", " : ""}
              {needsAttention > 0 ? `${needsAttention} need attention` : ""}
              {thriving === 0 && needsAttention === 0 ? "Looking good! 🌱" : ""}
            </Text>

            <TouchableOpacity
              style={styles.viewAllButton}
              onPress={() => router.push("/(tabs)/my-plants")}
            >
              <Text style={styles.viewAllText}>View all plants →</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.cream,
  },
  content: {
    paddingBottom: 100,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  greeting: {
    fontSize: 24,
    fontWeight: "800",
    color: COLORS.primary,
    letterSpacing: -0.5,
  },
  date: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 2,
  },

  // ── Weather ────────────────────────────────────────────────────────────────
  weatherCard: {
    backgroundColor: "#fff",
    marginHorizontal: 20,
    borderRadius: 20,
    padding: 20,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
  },
  weatherTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  weatherCity: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  weatherCondition: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  weatherRight: {
    alignItems: "flex-end",
  },
  weatherEmoji: {
    fontSize: 36,
  },
  weatherTemp: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.primary,
    marginTop: 2,
  },
  weatherStats: {
    flexDirection: "row",
    gap: 12,
  },
  weatherStat: {
    flex: 1,
    backgroundColor: COLORS.cream,
    borderRadius: 12,
    padding: 10,
    alignItems: "center",
  },
  weatherStatLabel: {
    fontSize: 10,
    color: COLORS.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  weatherStatValue: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  weatherBanner: {
    backgroundColor: "#EFF6FF",
    borderRadius: 12,
    padding: 10,
    marginTop: 12,
  },
  weatherBannerText: {
    fontSize: 13,
    color: "#1D4ED8",
    fontWeight: "500",
  },
  weatherLoadingText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 8,
    textAlign: "center",
  },
  weatherError: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: "center",
    marginTop: 8,
  },

  // ── Section ────────────────────────────────────────────────────────────────
  section: {
    marginHorizontal: 20,
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 12,
  },

  // ── Task cards ─────────────────────────────────────────────────────────────
  taskCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 12,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  taskPhoto: {
    width: 48,
    height: 48,
    borderRadius: 12,
    marginRight: 12,
  },
  taskPhotoPlaceholder: {
    backgroundColor: COLORS.lightgreen,
    alignItems: "center",
    justifyContent: "center",
  },
  taskContent: {
    flex: 1,
  },
  taskName: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textPrimary,
  },
  taskStatus: {
    fontSize: 12,
    marginTop: 2,
    fontWeight: "500",
  },
  taskWaterButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  allCaughtUp: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
  },
  allCaughtUpEmoji: {
    fontSize: 36,
    marginBottom: 8,
  },
  allCaughtUpText: {
    fontSize: 17,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  allCaughtUpSub: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 4,
  },

  // ── Health card ────────────────────────────────────────────────────────────
  healthCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  healthRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    marginBottom: 14,
  },
  healthTotal: {
    fontSize: 36,
    fontWeight: "800",
    color: COLORS.primary,
  },
  healthTotalLabel: {
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  healthBarContainer: {
    height: 8,
    backgroundColor: COLORS.lightgreen,
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 8,
  },
  healthBarFill: {
    height: "100%",
    borderRadius: 4,
  },
  healthSummary: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 16,
  },
  viewAllButton: {
    alignSelf: "flex-start",
  },
  viewAllText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.primary,
  },
});

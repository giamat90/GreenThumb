import React, { useCallback, useRef, useEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  Alert,
  StyleSheet,
  Animated,
  PanResponder,
  TouchableOpacity,
  RefreshControl,
  Modal,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { SlidersHorizontal, Droplets, Heart, Leaf, Trash2, X, Check, Plus } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { COLORS } from "@/constants";
import { ResponsiveContainer } from "@/components/ui/ResponsiveContainer";
import { useResponsive } from "@/hooks/useResponsive";
import { usePlants } from "@/hooks/usePlants";
import { usePlantsStore } from "@/store/plants";
import { useUserStore } from "@/store/user";
import { useWeather } from "@/hooks/useWeather";
import { supabase } from "@/lib/supabase";
import { rescheduleReminderForPlant, cancelWateringReminder } from "@/lib/notifications";
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

// ─── Swipeable plant card ─────────────────────────────────────────────────────

const SWIPE_THRESHOLD = 90;

function SwipeablePlantCard({
  plant,
  onPress,
  onWaterPress,
  onDelete,
}: {
  plant: PlantWithStatus;
  onPress: () => void;
  onWaterPress: () => void;
  onDelete: () => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 8 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5,
      onPanResponderMove: (_, gs) => {
        if (gs.dx < 0) translateX.setValue(gs.dx);
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dx < -SWIPE_THRESHOLD) {
          Animated.timing(translateX, {
            toValue: -500,
            duration: 180,
            useNativeDriver: true,
          }).start(onDelete);
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 6,
          }).start();
        }
      },
    })
  ).current;

  return (
    <View style={styles.swipeWrapper}>
      <View style={styles.deleteBackground}>
        <Trash2 size={22} color="#fff" />
      </View>
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        <PlantCard plant={plant} onPress={onPress} onWaterPress={onWaterPress} />
      </Animated.View>
    </View>
  );
}

// ─── Filter / sort types ──────────────────────────────────────────────────────

type SortOption = "name_asc" | "name_desc" | "needs_water" | "health_asc" | "recently_added";
type FilterOption = "all" | "needs_water" | "healthy" | "needs_attention";

const DEFAULT_SORT: SortOption = "name_asc";
const DEFAULT_FILTER: FilterOption = "all";

// ─── Main screen ─────────────────────────────────────────────────────────────

const BANNER_DISMISS_KEY = `weather_banner_dismissed_${new Date().toISOString().slice(0, 10)}`;

export default function MyPlantsScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDesktop } = useResponsive();
  const numColumns = isDesktop ? 2 : 1;
  const { profile } = useUserStore();
  const { updatePlant, removePlant } = usePlantsStore();
  const { plants, isLoading, refetch } = usePlants();
  const { weather } = useWeather();
  const [bannerVisible, setBannerVisible] = useState(false);
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>(DEFAULT_SORT);
  const [filterBy, setFilterBy] = useState<FilterOption>(DEFAULT_FILTER);

  const SORT_LABELS: Record<SortOption, string> = {
    name_asc: t("myPlants.nameAZ"),
    name_desc: t("myPlants.nameZA"),
    needs_water: t("myPlants.needsWaterFirst"),
    health_asc: t("myPlants.healthScore"),
    recently_added: t("myPlants.recentlyAdded"),
  };

  const FILTER_LABELS: Record<FilterOption, string> = {
    all: t("myPlants.allPlants"),
    needs_water: t("myPlants.needsWaterToday"),
    healthy: t("myPlants.healthyOnly"),
    needs_attention: t("myPlants.needsAttention"),
  };

  const isFiltered = sortBy !== DEFAULT_SORT || filterBy !== DEFAULT_FILTER;

  const displayedPlants = useMemo(() => {
    let list = [...plants];

    // Apply filter
    if (filterBy === "needs_water") {
      list = list.filter((p) => p.wateringStatus === "overdue" || p.wateringStatus === "today");
    } else if (filterBy === "healthy") {
      list = list.filter((p) => p.health_score > 80);
    } else if (filterBy === "needs_attention") {
      list = list.filter((p) => p.health_score <= 80);
    }

    // Apply sort
    list.sort((a, b) => {
      if (sortBy === "name_asc") return a.name.localeCompare(b.name);
      if (sortBy === "name_desc") return b.name.localeCompare(a.name);
      if (sortBy === "needs_water") {
        const order = { overdue: 0, today: 1, soon: 2, ok: 3 };
        return (order[a.wateringStatus] ?? 3) - (order[b.wateringStatus] ?? 3);
      }
      if (sortBy === "health_asc") return a.health_score - b.health_score;
      if (sortBy === "recently_added") {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      return 0;
    });

    return list;
  }, [plants, sortBy, filterBy]);

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
        t("myPlants.waterPlant"),
        t("myPlants.markAsWatered", { name: plant.name }),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("myPlants.yesWatered"),
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

                // Reschedule the watering reminder for the updated date
                const updatedPlant = {
                  ...plant,
                  last_watered_at: now,
                  next_watering: nextWatering,
                  health_score: newHealth,
                };
                rescheduleReminderForPlant(updatedPlant).catch(console.warn);

                const nextDate = new Date(nextWatering).toLocaleDateString(i18n.language, {
                  month: "short",
                  day: "numeric",
                });
                Alert.alert(
                  t("plantDetail.wateredSuccess"),
                  t("plantDetail.nextReminderSet", { date: nextDate })
                );
              } catch (err) {
                Alert.alert(
                  t("common.error"),
                  err instanceof Error ? err.message : t("plantDetail.failedToWater")
                );
              }
            },
          },
        ]
      );
    },
    [profile, updatePlant, t]
  );

  const handleDeletePlant = useCallback(
    async (plant: PlantWithStatus) => {
      const notifId = await AsyncStorage.getItem(`watering_notif_${plant.id}`);
      if (notifId) await cancelWateringReminder(notifId);
      removePlant(plant.id);
      await supabase.from("plants").delete().eq("id", plant.id);
    },
    [removePlant]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const renderItem = useCallback(
    ({ item }: { item: PlantWithStatus }) => (
      <View style={isDesktop ? { flex: 1, margin: 4 } : undefined}>
        <SwipeablePlantCard
          plant={item}
          onPress={() => router.push(`/plant/${item.id}`)}
          onWaterPress={() => handleWaterPress(item)}
          onDelete={() => handleDeletePlant(item)}
        />
      </View>
    ),
    [router, handleWaterPress, isDesktop]
  );

  const keyExtractor = useCallback((item: PlantWithStatus) => item.id, []);

  return (
    <ResponsiveContainer>
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>{t("myPlants.myPlants")}</Text>
          <Text style={styles.headerSubtitle}>
            {plants.length} {plants.length === 1 ? t("myPlants.plant") : t("myPlants.plants")}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => router.push("/add-plant")}
            accessibilityLabel={t("addPlant.title")}
            accessibilityRole="button"
          >
            <Plus size={20} color={COLORS.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sortButton, isFiltered && styles.sortButtonActive]}
            onPress={() => setFilterSheetVisible(true)}
            accessibilityLabel="Filter and sort plants"
            accessibilityRole="button"
          >
            <SlidersHorizontal size={20} color={isFiltered ? "#fff" : COLORS.primary} />
          </TouchableOpacity>
        </View>
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
            label={t("myPlants.plants")}
          />
          <View style={styles.summaryDivider} />
          <StatPill
            icon={<Droplets size={14} color={COLORS.secondary} />}
            value={needsWaterCount}
            label={t("myPlants.needWater")}
          />
          <View style={styles.summaryDivider} />
          <StatPill
            icon={<Heart size={14} color={COLORS.danger} />}
            value={`${avgHealth}%`}
            label={t("myPlants.avgHealth")}
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
          data={displayedPlants}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          numColumns={numColumns}
          key={String(numColumns)}
          columnWrapperStyle={isDesktop ? { gap: 0 } : undefined}
          contentContainerStyle={[
            styles.listContent,
            displayedPlants.length === 0 && styles.listContentEmpty,
          ]}
          ListEmptyComponent={
            plants.length === 0 ? (
              <EmptyPlants />
            ) : (
              <View style={styles.emptyFilter}>
                <Text style={styles.emptyFilterText}>{t("myPlants.noPlantsMatchFilter")}</Text>
                <TouchableOpacity onPress={() => { setSortBy(DEFAULT_SORT); setFilterBy(DEFAULT_FILTER); }}>
                  <Text style={styles.emptyFilterReset}>{t("myPlants.clearFilters")}</Text>
                </TouchableOpacity>
              </View>
            )
          }
          ListFooterComponent={
            displayedPlants.length > 0 ? (
              <View style={styles.listFooter}>
                <Text style={styles.listFooterText}>{t("myPlants.gardenLookingGreat")}</Text>
              </View>
            ) : null
          }
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

      {/* ── Filter / Sort sheet ───────────────────────────────────────────── */}
      <Modal
        visible={filterSheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFilterSheetVisible(false)}
      >
        <TouchableOpacity
          style={styles.sheetBackdrop}
          activeOpacity={1}
          onPress={() => setFilterSheetVisible(false)}
        />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          {/* Handle */}
          <View style={styles.sheetHandle} />

          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{t("myPlants.sortAndFilter")}</Text>
            <TouchableOpacity onPress={() => setFilterSheetVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Sort section */}
          <Text style={styles.sheetSectionLabel}>{t("myPlants.sortByLabel")}</Text>
          {(Object.keys(SORT_LABELS) as SortOption[]).map((opt) => (
            <TouchableOpacity
              key={opt}
              style={styles.sheetRow}
              onPress={() => { setSortBy(opt); setFilterSheetVisible(false); }}
              activeOpacity={0.7}
            >
              <Text style={[styles.sheetRowText, sortBy === opt && styles.sheetRowTextActive]}>
                {SORT_LABELS[opt]}
              </Text>
              {sortBy === opt && <Check size={16} color={COLORS.primary} />}
            </TouchableOpacity>
          ))}

          {/* Filter section */}
          <Text style={[styles.sheetSectionLabel, { marginTop: 16 }]}>{t("myPlants.filterByStatus")}</Text>
          {(Object.keys(FILTER_LABELS) as FilterOption[]).map((opt) => (
            <TouchableOpacity
              key={opt}
              style={styles.sheetRow}
              onPress={() => { setFilterBy(opt); setFilterSheetVisible(false); }}
              activeOpacity={0.7}
            >
              <Text style={[styles.sheetRowText, filterBy === opt && styles.sheetRowTextActive]}>
                {FILTER_LABELS[opt]}
              </Text>
              {filterBy === opt && <Check size={16} color={COLORS.primary} />}
            </TouchableOpacity>
          ))}

          {/* Reset */}
          {isFiltered && (
            <TouchableOpacity
              style={styles.sheetResetButton}
              onPress={() => { setSortBy(DEFAULT_SORT); setFilterBy(DEFAULT_FILTER); setFilterSheetVisible(false); }}
            >
              <Text style={styles.sheetResetText}>{t("myPlants.resetDefaults")}</Text>
            </TouchableOpacity>
          )}
        </View>
      </Modal>
    </View>
    </ResponsiveContainer>
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
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.lightgreen,
    alignItems: "center",
    justifyContent: "center",
  },
  sortButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.lightgreen,
    alignItems: "center",
    justifyContent: "center",
  },
  sortButtonActive: {
    backgroundColor: COLORS.primary,
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
  listFooter: {
    paddingVertical: 24,
    alignItems: "center",
  },
  listFooterText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontStyle: "italic",
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
  // ── Empty filter state ───────────────────────────────────────────────────────
  emptyFilter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
    gap: 12,
  },
  emptyFilterText: {
    fontSize: 15,
    color: COLORS.textSecondary,
  },
  emptyFilterReset: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.primary,
  },

  // ── Filter sheet ─────────────────────────────────────────────────────────────
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#E5E7EB",
    alignSelf: "center",
    marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  sheetSectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  sheetRowText: {
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  sheetRowTextActive: {
    fontWeight: "700",
    color: COLORS.primary,
  },
  sheetResetButton: {
    marginTop: 20,
    alignItems: "center",
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderRadius: 14,
  },
  sheetResetText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.primary,
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
  swipeWrapper: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 24,
  },
  deleteBackground: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: 80,
    backgroundColor: COLORS.danger,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
  },
});

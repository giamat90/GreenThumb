import React, { useMemo, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  Image,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  Animated,
  PanResponder,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { CalendarDays, Droplets, Leaf, Stethoscope, Trash2 } from "lucide-react-native";
import { COLORS } from "@/constants";
import { ResponsiveContainer } from "@/components/ui/ResponsiveContainer";
import { supabase } from "@/lib/supabase";
import { usePlantsStore } from "@/store/plants";
import type { Plant } from "@/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysFromToday(dateStr: string): number {
  const today = startOfDay(new Date());
  const target = startOfDay(new Date(dateStr));
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

type Section = "overdue" | "today" | "tomorrow" | "week" | "later";

function getSection(days: number): Section {
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days <= 7) return "week";
  return "later";
}

interface CalendarEntry {
  plant: Plant;
  days: number;
  section: Section;
  type: "watering" | "fertilizer" | "diagnosis";
}

const SECTION_ORDER: Section[] = ["overdue", "today", "tomorrow", "week", "later"];

// ─── Entry row ────────────────────────────────────────────────────────────────

function CareEntry({
  entry,
  onPress,
  style,
}: {
  entry: CalendarEntry;
  onPress: () => void;
  style?: object;
}) {
  const { t } = useTranslation();
  const { plant, days, section, type } = entry;

  const dayColor =
    section === "overdue" || section === "today"
      ? section === "overdue"
        ? COLORS.danger
        : COLORS.warning
      : section === "tomorrow"
        ? COLORS.warning
        : COLORS.textSecondary;

  const dayLabel =
    days < 0
      ? t("calendar.daysOverdue", { n: Math.abs(days) })
      : days === 0
        ? t("calendar.today")
        : days === 1
          ? t("calendar.tomorrow")
          : t("calendar.inNDays", { n: days });

  const icon = type === "fertilizer"
    ? <Leaf size={14} color={dayColor} />
    : type === "diagnosis"
      ? <Stethoscope size={14} color={dayColor} />
      : <Droplets size={14} color={dayColor} />;

  const actionLabel = type === "fertilizer"
    ? t("calendar.fertilize")
    : type === "diagnosis"
      ? t("calendar.diagnosis")
      : t("calendar.water");

  return (
    <TouchableOpacity style={[styles.entry, style]} onPress={onPress} activeOpacity={0.8}>
      {plant.photo_url ? (
        <Image
          source={{ uri: plant.photo_url }}
          style={styles.thumb}
          resizeMode="cover"
        />
      ) : (
        <View style={styles.thumbPlaceholder}>
          <Text style={styles.thumbEmoji}>🌿</Text>
        </View>
      )}

      <View style={styles.entryContent}>
        <View style={styles.entryRow}>
          {icon}
          <Text style={styles.entryTitle} numberOfLines={1}>
            {actionLabel} {plant.name}
          </Text>
        </View>
        {plant.species || plant.common_name ? (
          <Text style={styles.entrySubtitle} numberOfLines={1}>
            {plant.species ?? plant.common_name}
          </Text>
        ) : null}
      </View>

      <View style={[styles.badge, { borderColor: dayColor }]}>
        <Text style={[styles.badgeText, { color: dayColor }]}>{dayLabel}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Swipeable overdue entry ──────────────────────────────────────────────────

const SWIPE_THRESHOLD = 90;

function SwipeableOverdueEntry({
  entry,
  onPress,
  onDismiss,
}: {
  entry: CalendarEntry;
  onPress: () => void;
  onDismiss: () => void;
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
          }).start(onDismiss);
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
      {/* Red delete background — revealed as card slides left */}
      <View style={styles.deleteBackground}>
        <Trash2 size={22} color="#fff" />
      </View>

      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        <CareEntry entry={entry} onPress={onPress} style={styles.entryNoMargin} />
      </Animated.View>
    </View>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ title, danger }: { title: string; danger?: boolean }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, danger && { color: COLORS.danger }]}>
        {title}
      </Text>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CalendarScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { plants, updatePlant } = usePlantsStore();

  const [diagnosisFollowUps, setDiagnosisFollowUps] = useState<
    { plant_id: string; follow_up_date: string }[]
  >([]);

  // Keys of overdue entries the user has dismissed (optimistic)
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());

  useFocusEffect(
    useCallback(() => {
      supabase
        .from("diagnoses")
        .select("plant_id, follow_up_date")
        .not("follow_up_date", "is", null)
        .then(({ data }) => {
          if (data) setDiagnosisFollowUps(data as { plant_id: string; follow_up_date: string }[]);
        });
    }, [])
  );

  const handleDismissOverdue = useCallback(async (entry: CalendarEntry) => {
    const key = `${entry.plant.id}-${entry.type}`;
    // Optimistic: hide immediately
    setDismissedKeys((prev) => new Set([...prev, key]));

    try {
      if (entry.type === "watering") {
        const watering =
          (entry.plant.care_profile as Record<string, unknown>)?.watering as string ?? "average";
        const daysMap: Record<string, number> = { frequent: 2, average: 5, minimum: 10 };
        const interval = daysMap[watering] ?? 5;
        const next = new Date();
        next.setDate(next.getDate() + interval);
        const nextWatering = next.toISOString();
        await supabase.from("plants").update({ next_watering: nextWatering }).eq("id", entry.plant.id);
        updatePlant(entry.plant.id, { next_watering: nextWatering });
      } else if (entry.type === "fertilizer") {
        const next = new Date();
        next.setDate(next.getDate() + 30);
        const nextFertilizer = next.toISOString();
        await supabase.from("plants").update({ next_fertilizer_at: nextFertilizer }).eq("id", entry.plant.id);
        updatePlant(entry.plant.id, { next_fertilizer_at: nextFertilizer });
      } else if (entry.type === "diagnosis") {
        await supabase
          .from("diagnoses")
          .update({ follow_up_date: null })
          .eq("plant_id", entry.plant.id)
          .not("follow_up_date", "is", null);
        setDiagnosisFollowUps((prev) => prev.filter((d) => d.plant_id !== entry.plant.id));
      }
    } catch {
      // Revert optimistic update on error
      setDismissedKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [updatePlant]);

  const SECTION_LABEL: Record<Section, string> = {
    overdue: t("calendar.overdue"),
    today: t("calendar.today"),
    tomorrow: t("calendar.tomorrow"),
    week: t("calendar.thisWeek"),
    later: t("calendar.later"),
  };

  const sections = useMemo(() => {
    const entries: CalendarEntry[] = [];

    for (const p of plants) {
      if (p.next_watering) {
        const days = daysFromToday(p.next_watering);
        entries.push({ plant: p, days, section: getSection(days), type: "watering" });
      }
      if (p.next_fertilizer_at) {
        const days = daysFromToday(p.next_fertilizer_at);
        entries.push({ plant: p, days, section: getSection(days), type: "fertilizer" });
      }
    }

    for (const d of diagnosisFollowUps) {
      const plant = plants.find((p) => p.id === d.plant_id);
      if (plant && d.follow_up_date) {
        const days = daysFromToday(d.follow_up_date);
        entries.push({ plant, days, section: getSection(days), type: "diagnosis" });
      }
    }

    // Filter out dismissed entries
    const visible = entries.filter((e) => !dismissedKeys.has(`${e.plant.id}-${e.type}`));
    visible.sort((a, b) => a.days - b.days);

    const grouped = new Map<Section, CalendarEntry[]>();
    for (const entry of visible) {
      const list = grouped.get(entry.section) ?? [];
      list.push(entry);
      grouped.set(entry.section, list);
    }

    return SECTION_ORDER.filter((s) => grouped.has(s)).map((s) => ({
      key: s,
      title: SECTION_LABEL[s],
      data: grouped.get(s)!,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plants, diagnosisFollowUps, dismissedKeys, t]);

  if (plants.length === 0) {
    return (
      <ResponsiveContainer>
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconBg}>
            <CalendarDays size={36} color={COLORS.primary} />
          </View>
          <Text style={styles.emptyTitle}>{t("calendar.careCalendar")}</Text>
          <Text style={styles.emptySubtitle}>
            {t("calendar.noPlants")}
          </Text>
        </View>
      </ResponsiveContainer>
    );
  }

  if (sections.length === 0) {
    return (
      <ResponsiveContainer>
        <View style={styles.emptyContainer}>
          <Text style={styles.caughtUpEmoji}>🎉</Text>
          <Text style={styles.emptyTitle}>{t("calendar.allCaughtUp")}</Text>
          <Text style={styles.emptySubtitle}>
            {t("calendar.noUpcomingTasks")}
          </Text>
        </View>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer>
      <View style={styles.screen}>
        <Text style={styles.heading}>{t("calendar.careCalendar")}</Text>
        <SectionList
          sections={sections}
          keyExtractor={(item) => `${item.plant.id}-${item.type}`}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <SectionHeader
              title={section.title}
              danger={section.key === "overdue"}
            />
          )}
          renderItem={({ item, section }) =>
            section.key === "overdue" ? (
              <SwipeableOverdueEntry
                entry={item}
                onPress={() => router.push(`/plant/${item.plant.id}`)}
                onDismiss={() => handleDismissOverdue(item)}
              />
            ) : (
              <CareEntry
                entry={item}
                onPress={() => router.push(`/plant/${item.plant.id}`)}
              />
            )
          }
          ListFooterComponent={
            <View style={styles.listFooter}>
              <Text style={styles.listFooterText}>{t("calendar.allCareTasksShown")}</Text>
            </View>
          }
        />
      </View>
    </ResponsiveContainer>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.cream,
  },
  heading: {
    fontSize: 26,
    fontWeight: "700",
    color: COLORS.primary,
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 8,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    flexGrow: 1,
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
  sectionHeader: {
    paddingTop: 20,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  entry: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  entryNoMargin: {
    marginBottom: 0,
  },
  swipeWrapper: {
    marginBottom: 10,
    borderRadius: 16,
    overflow: "hidden",
  },
  deleteBackground: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    backgroundColor: COLORS.danger,
    alignItems: "flex-end",
    justifyContent: "center",
    paddingRight: 20,
  },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: 10,
    marginRight: 12,
  },
  thumbPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.lightgreen,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  thumbEmoji: {
    fontSize: 20,
  },
  entryContent: {
    flex: 1,
    gap: 3,
  },
  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  entryTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textPrimary,
    flex: 1,
  },
  entrySubtitle: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontStyle: "italic",
  },
  badge: {
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginLeft: 8,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.cream,
    paddingHorizontal: 40,
  },
  emptyIconBg: {
    backgroundColor: COLORS.lightgreen,
    borderRadius: 999,
    padding: 20,
    marginBottom: 16,
  },
  caughtUpEmoji: {
    fontSize: 56,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: COLORS.primary,
    marginBottom: 10,
  },
  emptySubtitle: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
});

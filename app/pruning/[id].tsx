import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Dimensions,
  Image,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, Camera, Plus, RefreshCw } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";

import { useTranslation } from "react-i18next";

import { COLORS } from "@/constants";
import { supabase } from "@/lib/supabase";
import { compressImage } from "@/lib/imageUtils";
import { deviceLanguage } from "@/lib/i18n";
import { usePlantsStore } from "@/store/plants";
import { useUserStore } from "@/store/user";
import { classifyError, isConnected, type AppErrorType } from "@/lib/errorHandling";
import ErrorBanner from "@/components/ui/ErrorBanner";
import type { PruningAnalysis } from "@/types";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

// ─── Types ────────────────────────────────────────────────────────────────────

type Recommendation = "prune_now" | "prune_soon" | "wait";
type ScreenState = "form" | "analyzing" | "results";

interface PruningResult {
  recommendation: Recommendation;
  urgency_score: number;
  reasons: string[];
  best_time: string;
  branches_to_remove: string[];
  tools_needed: string[];
  steps: string[];
  aftercare: string[];
  summary: string;
}

// ─── Photo slots ──────────────────────────────────────────────────────────────

interface PhotoSlot {
  key: string;
  emoji: string;
  label: string;
  hint: string;
}

const PHOTO_SLOTS: PhotoSlot[] = [
  { key: "overall", emoji: "🌿", label: "Overall Shape",  hint: "Full plant shape view"      },
  { key: "problem", emoji: "⚠️", label: "Problem Area",   hint: "Show the issue up close"    },
  { key: "branch",  emoji: "🍃", label: "Branch Detail",  hint: "Individual branch detail"   },
  { key: "base",    emoji: "🌱", label: "Base & Stem",    hint: "Plant base and main stem"   },
];

// ─── Option data ──────────────────────────────────────────────────────────────

const LAST_PRUNED_OPTIONS = ["Never", "< 1 month", "1-3 months", "3-6 months", "6-12 months", "> 1 year"];

const GROWTH_STAGE_OPTIONS: { label: string; value: "dormant" | "growing" | "flowering" }[] = [
  { label: "Dormant",           value: "dormant"   },
  { label: "Actively Growing",  value: "growing"   },
  { label: "Flowering",         value: "flowering" },
];

const GOAL_OPTIONS: { label: string; value: "shape" | "size" | "health" | "bushing" }[] = [
  { label: "Shape",             value: "shape"   },
  { label: "Size Control",      value: "size"    },
  { label: "Health",            value: "health"  },
  { label: "Encourage Bushing", value: "bushing" },
];

const OBSERVED_SIGNS = [
  "Dead or dying branches",
  "Leggy / stretched growth",
  "Crossing branches",
  "Recently finished flowering",
  "Overcrowded center",
];

// ─── Recommendation config ────────────────────────────────────────────────────

const REC_CONFIG: Record<Recommendation, { label: string; bg: string; text: string }> = {
  prune_now:  { label: "Prune Now ✂️", bg: "#FEE2E2", text: "#991B1B"       },
  prune_soon: { label: "Prune Soon ⚠️", bg: "#FEF3C7", text: "#92400E"      },
  wait:       { label: "All Good ✅",   bg: "#D8F3DC", text: COLORS.primary  },
};

// ─── Scan line animation ──────────────────────────────────────────────────────

function ScanLine() {
  const translateY = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(translateY, { toValue: SCREEN_HEIGHT * 0.65, duration: 1800, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ])
    ).start();
  }, [translateY]);
  return (
    <Animated.View
      style={[styles.scanLine, { transform: [{ translateY }] }]}
      pointerEvents="none"
    />
  );
}

// ─── Pill selector ────────────────────────────────────────────────────────────

function PillOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.pill, selected && styles.pillSelected]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function PruningScreen() {
  const { t } = useTranslation();
  const { id: plantId, existingAnalysis } = useLocalSearchParams<{ id: string; existingAnalysis?: string }>();
  const navigation = useNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { plants } = usePlantsStore();
  const { profile, subscription } = useUserStore();
  const isPro = subscription === "pro";
  const plant = plants.find((p) => p.id === plantId) ?? null;

  // ── Pro gate — __DEV__ bypass for development testing ─────────────────────
  useFocusEffect(
    useCallback(() => {
      if (__DEV__ || existingAnalysis) return;
      const timer = setTimeout(() => {
        if (!isPro) router.replace("/paywall");
      }, 300);
      return () => clearTimeout(timer);
    }, [isPro, existingAnalysis]) // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── Form state ──────────────────────────────────────────────────────────────
  const [lastPruned, setLastPruned] = useState(LAST_PRUNED_OPTIONS[0]);
  const [growthStage, setGrowthStage] = useState<"dormant" | "growing" | "flowering">("growing");
  const [goal, setGoal] = useState<"shape" | "size" | "health" | "bushing">("health");
  const [selectedSigns, setSelectedSigns] = useState<Set<string>>(new Set());
  const [slotUris, setSlotUris] = useState<Record<string, string | null>>({});

  // ── Screen state ────────────────────────────────────────────────────────────
  const [screenState, setScreenState] = useState<ScreenState>("form");
  const [primaryUri, setPrimaryUri] = useState<string | null>(null);
  const [result, setResult] = useState<PruningResult | null>(null);
  const [isViewingExisting, setIsViewingExisting] = useState(false);
  const [actionBarHeight, setActionBarHeight] = useState(0);
  const [bannerError, setBannerError] = useState<AppErrorType | null>(null);

  // Load existing analysis from history
  useEffect(() => {
    if (!existingAnalysis) return;
    try {
      const record = JSON.parse(existingAnalysis as string) as PruningAnalysis;
      setResult({
        recommendation: record.recommendation,
        urgency_score: record.urgency_score,
        reasons: record.reasons,
        best_time: record.best_time ?? "",
        branches_to_remove: record.branches_to_remove,
        tools_needed: record.tools_needed,
        steps: record.steps,
        aftercare: record.aftercare,
        summary: record.summary,
      });
      setScreenState("results");
      setIsViewingExisting(true);
    } catch {
      // fall back to form
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toggle observed sign ─────────────────────────────────────────────────────
  const toggleSign = useCallback((sign: string) => {
    setSelectedSigns((prev) => {
      const next = new Set(prev);
      if (next.has(sign)) next.delete(sign);
      else next.add(sign);
      return next;
    });
  }, []);

  // ── Pick photo for a slot ────────────────────────────────────────────────────
  const handlePickPhoto = useCallback((slotKey: string) => {
    Alert.alert("Add Photo", "Choose a source", [
      {
        text: "Camera",
        onPress: async () => {
          try {
            const res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85 });
            if (!res.canceled && res.assets[0]?.uri) {
              setSlotUris((prev) => ({ ...prev, [slotKey]: res.assets[0].uri }));
            }
          } catch {
            Alert.alert("Error", "Could not access camera. Please try again.");
          }
        },
      },
      {
        text: "Photo Library",
        onPress: async () => {
          try {
            const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
            if (!res.canceled && res.assets[0]?.uri) {
              setSlotUris((prev) => ({ ...prev, [slotKey]: res.assets[0].uri }));
            }
          } catch {
            Alert.alert("Error", "Could not access library. Please try again.");
          }
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }, []);

  // ── Analyze ──────────────────────────────────────────────────────────────────
  const handleAnalyze = useCallback(async () => {
    if (!plant) return;

    const online = await isConnected();
    if (!online) {
      setBannerError("no_internet");
      return;
    }

    const filledSlots = PHOTO_SLOTS.filter((s) => slotUris[s.key]);
    const bgUri = filledSlots.length > 0 ? (slotUris[filledSlots[0].key] ?? null) : null;
    setPrimaryUri(bgUri);
    setBannerError(null);
    setScreenState("analyzing");

    try {
      // Process all selected photos in parallel
      const photos = await Promise.all(
        filledSlots.map(async (slot) => {
          const uri = slotUris[slot.key]!;
          const filename = `prune_${slot.key}_${Date.now()}.jpg`;
          const destUri = `${FileSystem.cacheDirectory}${filename}`;
          await FileSystem.copyAsync({ from: uri, to: destUri });
          const base64 = await compressImage(destUri);
          return { base64, part: slot.label };
        })
      );

      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseKey) throw new Error("Supabase configuration missing");

      const response = await fetch(`${supabaseUrl}/functions/v1/pruning-advisor`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          plantName: plant.name,
          plantSpecies: plant.species ?? plant.common_name ?? "Unknown",
          lastPruned,
          growthStage,
          goal,
          signs: Array.from(selectedSigns),
          photos: photos.length > 0 ? photos : undefined,
          language: deviceLanguage(),
        }),
      });

      if (!response.ok) {
        const err = await response.json() as { error?: string };
        throw new Error(err.error ?? "Analysis failed");
      }

      const data = await response.json() as PruningResult;

      // Save to Supabase (best-effort)
      if (profile) {
        supabase.from("pruning_analyses").insert({
          plant_id: plantId,
          user_id: profile.id,
          recommendation: data.recommendation,
          urgency_score: data.urgency_score,
          reasons: data.reasons,
          best_time: data.best_time,
          branches_to_remove: data.branches_to_remove,
          tools_needed: data.tools_needed,
          steps: data.steps,
          aftercare: data.aftercare,
          summary: data.summary,
          last_pruned: lastPruned,
          growth_stage: growthStage,
          goal,
          signs: Array.from(selectedSigns),
        }).then(({ error }) => {
          if (error) console.warn("pruning: failed to save analysis", error);
        });
      }

      setResult(data);
      setScreenState("results");
    } catch (err) {
      const errorType = classifyError(err);
      setBannerError(errorType);
      setScreenState("form");
    }
  }, [plant, lastPruned, growthStage, goal, selectedSigns, slotUris, profile, plantId]);

  const handleRetake = useCallback(() => {
    setResult(null);
    setSlotUris({});
    setPrimaryUri(null);
    setIsViewingExisting(false);
    setScreenState("form");
  }, []);

  // ── Guards ─────────────────────────────────────────────────────────────────
  if (!__DEV__ && !isPro && !existingAnalysis) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.cream, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  if (!plant) {
    return (
      <View style={styles.notFound}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.notFoundText}>{t("plantDetail.plantNotFound")}</Text>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backLink}>{t("plantDetail.goBack")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STATE 1 — Form
  // ──────────────────────────────────────────────────────────────────────────

  if (screenState === "form") {
    const photoCount = PHOTO_SLOTS.filter((s) => slotUris[s.key]).length;

    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />

        <ErrorBanner
          error={bannerError}
          onRetry={bannerError ? handleAnalyze : undefined}
          onDismiss={() => setBannerError(null)}
        />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.formContent,
            { paddingTop: insets.top + 16, paddingBottom: actionBarHeight + 16 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.formHeader}>
            <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} accessibilityLabel="Go back">
              <ArrowLeft size={20} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.formTitle}>{t("pruning.title")}</Text>
          </View>

          {/* Plant preview */}
          <View style={styles.plantPreview}>
            {plant.photo_url ? (
              <Image source={{ uri: plant.photo_url }} style={styles.plantThumb} resizeMode="cover" />
            ) : (
              <View style={[styles.plantThumb, styles.plantThumbPlaceholder]}>
                <Text style={{ fontSize: 28 }}>✂️</Text>
              </View>
            )}
            <View style={styles.plantPreviewText}>
              <Text style={styles.plantPreviewName}>{plant.name}</Text>
              {plant.species ? <Text style={styles.plantPreviewSpecies}>{plant.species}</Text> : null}
            </View>
          </View>

          {/* ── Last pruned ───────────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("pruning.lastPruned")}</Text>
            <View style={styles.pillRow}>
              {LAST_PRUNED_OPTIONS.map((opt) => (
                <PillOption key={opt} label={opt} selected={lastPruned === opt} onPress={() => setLastPruned(opt)} />
              ))}
            </View>
          </View>

          {/* ── Growth stage ──────────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("pruning.growthStage")}</Text>
            <View style={styles.pillRow}>
              {GROWTH_STAGE_OPTIONS.map((opt) => (
                <PillOption key={opt.value} label={opt.label} selected={growthStage === opt.value} onPress={() => setGrowthStage(opt.value)} />
              ))}
            </View>
          </View>

          {/* ── Pruning goal ──────────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("pruning.goal")}</Text>
            <View style={styles.pillRow}>
              {GOAL_OPTIONS.map((opt) => (
                <PillOption key={opt.value} label={opt.label} selected={goal === opt.value} onPress={() => setGoal(opt.value)} />
              ))}
            </View>
          </View>

          {/* ── Observed signs ────────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("pruning.observedSigns")}</Text>
            <Text style={styles.sectionSubtitle}>{t("pruning.selectAllThatApply")}</Text>
            {OBSERVED_SIGNS.map((sign) => {
              const checked = selectedSigns.has(sign);
              return (
                <TouchableOpacity
                  key={sign}
                  style={styles.checkRow}
                  onPress={() => toggleSign(sign)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                >
                  <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                    {checked && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <Text style={[styles.checkLabel, checked && styles.checkLabelChecked]}>{sign}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── Photos (optional) ─────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("repotting.photosOptional")}</Text>
            <Text style={styles.sectionSubtitle}>{t("repotting.photosSubtitle")}</Text>
            <View style={styles.slotGrid}>
              {PHOTO_SLOTS.map((slot) => {
                const uri = slotUris[slot.key] ?? null;
                return (
                  <TouchableOpacity
                    key={slot.key}
                    style={[styles.slot, uri && styles.slotFilled]}
                    onPress={() => handlePickPhoto(slot.key)}
                    activeOpacity={0.8}
                    accessibilityLabel={`Add ${slot.label} photo`}
                    accessibilityRole="button"
                  >
                    {uri ? (
                      <>
                        <Image source={{ uri }} style={styles.slotImage} resizeMode="cover" />
                        <View style={styles.slotOverlay}>
                          <Text style={styles.slotOverlayEmoji}>{slot.emoji}</Text>
                          <Text style={styles.slotOverlayLabel}>{slot.label}</Text>
                        </View>
                        <View style={styles.slotChangeBtn}>
                          <Camera size={12} color="#fff" />
                        </View>
                      </>
                    ) : (
                      <>
                        <Text style={styles.slotEmoji}>{slot.emoji}</Text>
                        <Text style={styles.slotLabel}>{slot.label}</Text>
                        <Text style={styles.slotHint}>{slot.hint}</Text>
                        <View style={styles.slotAddIcon}>
                          <Plus size={16} color={COLORS.primary} />
                        </View>
                      </>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </ScrollView>

        {/* Analyze button */}
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]} onLayout={(e) => setActionBarHeight(e.nativeEvent.layout.height)}>
          <TouchableOpacity style={styles.analyzeButton} onPress={handleAnalyze} activeOpacity={0.85}>
            <Text style={styles.analyzeButtonText}>
              {photoCount > 0
                ? `${t("pruning.analyzePruning")} (${photoCount})`
                : t("pruning.analyzePruning")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STATE 2 — Analyzing
  // ──────────────────────────────────────────────────────────────────────────

  if (screenState === "analyzing") {
    return (
      <View style={[styles.screen, styles.analyzingScreen]}>
        <Stack.Screen options={{ headerShown: false }} />

        {primaryUri && (
          <Image source={{ uri: primaryUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        )}
        <View style={[StyleSheet.absoluteFill, styles.analyzingDim]} />
        <ScanLine />

        <View style={styles.analyzingContent}>
          <ActivityIndicator color={COLORS.secondary} size="large" />
          <Text style={styles.analyzingTitle}>{t("pruning.analyzing")}</Text>
          <Text style={styles.analyzingSubtitle}>{t("pruning.analyzePruning")}</Text>
        </View>
      </View>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STATE 3 — Results
  // ──────────────────────────────────────────────────────────────────────────

  if (!result) return null;

  const recConfig = REC_CONFIG[result.recommendation];
  const recLabel = result.recommendation === "prune_now" ? t("pruning.pruneNow")
    : result.recommendation === "prune_soon" ? t("pruning.pruneSoon")
    : t("pruning.wait");

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.resultsContent,
          { paddingTop: insets.top + 16, paddingBottom: actionBarHeight + 16 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Back button */}
        <TouchableOpacity style={styles.resultsBack} onPress={() => navigation.goBack()} accessibilityLabel="Go back">
          <ArrowLeft size={20} color={COLORS.textPrimary} />
        </TouchableOpacity>

        {/* ── Recommendation banner ─────────────────────────────────────── */}
        <View style={[styles.card, styles.recCard, { backgroundColor: recConfig.bg }]}>
          <View style={styles.recRow}>
            <View style={[styles.scoreCircle, { borderColor: recConfig.text }]}>
              <Text style={[styles.scoreValue, { color: recConfig.text }]}>{result.urgency_score}</Text>
              <Text style={[styles.scoreLabel, { color: recConfig.text }]}>/10</Text>
            </View>
            <View style={styles.recTextWrap}>
              <Text style={[styles.recVerdict, { color: recConfig.text }]}>{recLabel}</Text>
              <Text style={[styles.recSummary, { color: recConfig.text }]}>{result.summary}</Text>
            </View>
          </View>
        </View>

        {/* ── Reasons ──────────────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("pruning.reasons")}</Text>
          {result.reasons.map((r, i) => (
            <View key={i} style={styles.bulletRow}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>{r}</Text>
            </View>
          ))}
        </View>

        {/* ── Best time ────────────────────────────────────────────────── */}
        {result.best_time ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("pruning.bestTime")}</Text>
            <Text style={styles.bodyText}>{result.best_time}</Text>
          </View>
        ) : null}

        {/* ── Branches to remove ───────────────────────────────────────── */}
        {result.branches_to_remove.length > 0 && result.recommendation !== "wait" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("pruning.branchesToRemove")}</Text>
            {result.branches_to_remove.map((b, i) => (
              <View key={i} style={styles.bulletRow}>
                <Text style={styles.bulletDot}>✂️</Text>
                <Text style={styles.bulletText}>{b}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Tools needed ─────────────────────────────────────────────── */}
        {result.tools_needed.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("pruning.toolsNeeded")}</Text>
            {result.tools_needed.map((tool, i) => (
              <View key={i} style={styles.bulletRow}>
                <Text style={styles.bulletDot}>🔧</Text>
                <Text style={styles.bulletText}>{tool}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Step-by-step instructions ─────────────────────────────────── */}
        {result.steps.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("pruning.steps")}</Text>
            {result.steps.map((step, i) => (
              <View key={i} style={styles.stepRow}>
                <View style={styles.stepNum}>
                  <Text style={styles.stepNumText}>{i + 1}</Text>
                </View>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Aftercare ─────────────────────────────────────────────────── */}
        {result.aftercare.length > 0 && (
          <View style={[styles.card, styles.aftercareCard]}>
            <Text style={styles.aftercareTitle}>{t("pruning.aftercare")}</Text>
            {result.aftercare.map((tip, i) => (
              <View key={i} style={styles.bulletRow}>
                <Text style={styles.bulletDot}>•</Text>
                <Text style={[styles.bulletText, { color: COLORS.primary }]}>{tip}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* ── Action bar ───────────────────────────────────────────────────── */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]} onLayout={(e) => setActionBarHeight(e.nativeEvent.layout.height)}>
        <TouchableOpacity style={styles.retakeButton} onPress={handleRetake} accessibilityRole="button">
          <RefreshCw size={18} color={COLORS.primary} />
          <Text style={styles.retakeButtonText}>
            {isViewingExisting ? t("pruning.newAnalysis") : t("pruning.checkAgain")}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.doneButton} onPress={() => navigation.goBack()} accessibilityRole="button">
          <Text style={styles.doneButtonText}>{t("common.done")} ✓</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.cream },
  scroll: { flex: 1 },
  notFound: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.cream },
  notFoundText: { fontSize: 18, color: COLORS.textSecondary, marginBottom: 12 },
  backLink: { fontSize: 16, color: COLORS.primary, fontWeight: "600" },

  // ── Form ──────────────────────────────────────────────────────────────────
  formContent: { paddingHorizontal: 16 },
  formHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20 },
  backButton: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 1,
  },
  formTitle: { fontSize: 22, fontWeight: "800", color: COLORS.textPrimary },
  plantPreview: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#fff",
    borderRadius: 20, padding: 14, gap: 14, marginBottom: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  plantThumb: { width: 56, height: 56, borderRadius: 14 },
  plantThumbPlaceholder: { backgroundColor: COLORS.lightgreen, alignItems: "center", justifyContent: "center" },
  plantPreviewText: { flex: 1 },
  plantPreviewName: { fontSize: 16, fontWeight: "700", color: COLORS.textPrimary },
  plantPreviewSpecies: { fontSize: 13, fontStyle: "italic", color: COLORS.textSecondary, marginTop: 2 },
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 14, fontWeight: "700", color: COLORS.textPrimary,
    marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.4,
  },
  sectionSubtitle: { fontSize: 13, color: COLORS.textSecondary, marginTop: -6, marginBottom: 10 },

  // ── Pills ─────────────────────────────────────────────────────────────────
  pillRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  pill: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20,
    backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#E5E7EB",
  },
  pillSelected: { backgroundColor: COLORS.lightgreen, borderColor: COLORS.secondary },
  pillText: { fontSize: 13, fontWeight: "500", color: COLORS.textSecondary },
  pillTextSelected: { color: COLORS.primary, fontWeight: "700" },

  // ── Checkboxes ────────────────────────────────────────────────────────────
  checkRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.cream },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: "#D1D5DB",
    alignItems: "center", justifyContent: "center",
  },
  checkboxChecked: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  checkmark: { fontSize: 13, color: "#fff", fontWeight: "700" },
  checkLabel: { flex: 1, fontSize: 14, color: COLORS.textSecondary },
  checkLabelChecked: { color: COLORS.textPrimary, fontWeight: "600" },

  // ── Photo slots ───────────────────────────────────────────────────────────
  slotGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  slot: {
    width: "47.5%", aspectRatio: 1,
    backgroundColor: "#fff", borderRadius: 16,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#E5E7EB", borderStyle: "dashed",
    padding: 10, gap: 3, overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  slotFilled: { borderStyle: "solid", borderColor: COLORS.primary, padding: 0 },
  slotImage: { width: "100%", height: "100%", borderRadius: 14 },
  slotOverlay: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingVertical: 7, paddingHorizontal: 8,
    borderBottomLeftRadius: 14, borderBottomRightRadius: 14,
    flexDirection: "row", alignItems: "center", gap: 4,
  },
  slotOverlayEmoji: { fontSize: 12 },
  slotOverlayLabel: { fontSize: 11, fontWeight: "700", color: "#fff" },
  slotChangeBtn: {
    position: "absolute", top: 7, right: 7,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center",
  },
  slotEmoji: { fontSize: 24, marginBottom: 1 },
  slotLabel: { fontSize: 12, fontWeight: "700", color: COLORS.textPrimary, textAlign: "center" },
  slotHint: { fontSize: 10, color: COLORS.textSecondary, textAlign: "center", lineHeight: 14 },
  slotAddIcon: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: COLORS.lightgreen, alignItems: "center", justifyContent: "center", marginTop: 3,
  },

  // ── Analyzing ─────────────────────────────────────────────────────────────
  analyzingScreen: { backgroundColor: "#000" },
  analyzingDim: { backgroundColor: "rgba(0,0,0,0.6)" },
  scanLine: {
    position: "absolute", top: 0, left: 0, right: 0, height: 3,
    backgroundColor: COLORS.secondary,
    shadowColor: COLORS.secondary, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 8,
    elevation: 4,
  },
  analyzingContent: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  analyzingTitle: { fontSize: 22, fontWeight: "700", color: "#fff", textAlign: "center" },
  analyzingSubtitle: { fontSize: 15, color: "rgba(255,255,255,0.75)", textAlign: "center" },

  // ── Results ───────────────────────────────────────────────────────────────
  resultsContent: { paddingHorizontal: 16, gap: 12 },
  resultsBack: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center", marginBottom: 4,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 1,
  },
  card: {
    backgroundColor: "#fff", borderRadius: 20, padding: 20,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  cardTitle: { fontSize: 16, fontWeight: "700", color: COLORS.textPrimary, marginBottom: 14 },
  recCard: { shadowOpacity: 0, elevation: 0 },
  recRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  scoreCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: "rgba(255,255,255,0.5)",
    borderWidth: 2,
    alignItems: "center", justifyContent: "center",
    flexDirection: "row", alignContent: "flex-end",
  },
  scoreValue: { fontSize: 26, fontWeight: "800", lineHeight: 30 },
  scoreLabel: { fontSize: 11, fontWeight: "600", alignSelf: "flex-end", marginBottom: 2 },
  recTextWrap: { flex: 1, gap: 4 },
  recVerdict: { fontSize: 18, fontWeight: "800" },
  recSummary: { fontSize: 13, lineHeight: 19, opacity: 0.85 },
  bulletRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  bulletDot: { fontSize: 14, color: COLORS.primary, lineHeight: 22 },
  bulletText: { flex: 1, fontSize: 14, color: COLORS.textSecondary, lineHeight: 22 },
  bodyText: { fontSize: 14, color: COLORS.textSecondary, lineHeight: 22 },
  stepRow: { flexDirection: "row", gap: 12, marginBottom: 12, alignItems: "flex-start" },
  stepNum: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center",
    flexShrink: 0, marginTop: 1,
  },
  stepNumText: { fontSize: 12, fontWeight: "700", color: "#fff" },
  stepText: { flex: 1, fontSize: 14, color: COLORS.textPrimary, lineHeight: 22 },
  aftercareCard: { backgroundColor: "#F0FBF4" },
  aftercareTitle: { fontSize: 15, fontWeight: "700", color: COLORS.primary, marginBottom: 12 },

  // ── Bottom bar ────────────────────────────────────────────────────────────
  bottomBar: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "#fff", paddingTop: 12, paddingHorizontal: 16,
    gap: 10, flexDirection: "row",
    borderTopWidth: 1, borderTopColor: COLORS.cream,
    shadowColor: "#000", shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 8,
  },
  analyzeButton: {
    flex: 1, alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.primary, borderRadius: 16, paddingVertical: 16,
  },
  analyzeButtonText: { fontSize: 16, fontWeight: "700", color: "#fff" },
  retakeButton: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, borderWidth: 2, borderColor: COLORS.primary, borderRadius: 16, paddingVertical: 14,
  },
  retakeButtonText: { fontSize: 14, fontWeight: "600", color: COLORS.primary },
  doneButton: {
    flex: 1, alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.primary, borderRadius: 16, paddingVertical: 16,
  },
  doneButtonText: { fontSize: 16, fontWeight: "700", color: "#fff" },
});

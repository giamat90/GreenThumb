import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
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
import * as ImagePicker from "expo-image-picker";
import { Stack, useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, Camera, Plus, RefreshCw } from "lucide-react-native";
import * as FileSystem from "expo-file-system/legacy";

import { COLORS } from "@/constants";
import { compressImage } from "@/lib/imageUtils";
import { supabase } from "@/lib/supabase";
import { usePlantsStore } from "@/store/plants";
import { useUserStore } from "@/store/user";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

// ─── Types ────────────────────────────────────────────────────────────────────

interface Treatment {
  action: string;
  priority: "immediate" | "soon" | "optional";
  detail: string;
}

interface DiagnosisResult {
  severity: "healthy" | "warning" | "critical";
  condition: string;
  confidence: number;
  description: string;
  causes: string[];
  treatments: Treatment[];
  prevention: string[];
  healthScore: number;
}

type ScreenState = "picker" | "analyzing" | "results";

// ─── Photo slots ──────────────────────────────────────────────────────────────

interface PhotoSlot {
  key: string;
  emoji: string;
  label: string;
  hint: string;
  required: boolean;
}

const PHOTO_SLOTS: PhotoSlot[] = [
  { key: "leaves",  emoji: "🍃", label: "Leaves",       hint: "Show top & bottom of leaves", required: true  },
  { key: "overall", emoji: "🌿", label: "Overall Plant", hint: "Full plant in frame",          required: false },
  { key: "stem",    emoji: "🌱", label: "Stem & Base",   hint: "Stem and soil line",           required: false },
  { key: "soil",    emoji: "🪨", label: "Soil",          hint: "Soil surface texture",         required: false },
];

// ─── Severity helpers ─────────────────────────────────────────────────────────

const SEVERITY_EMOJI: Record<DiagnosisResult["severity"], string> = {
  healthy: "✅",
  warning: "⚠️",
  critical: "🚨",
};

const SEVERITY_BG: Record<DiagnosisResult["severity"], string> = {
  healthy: "#D8F3DC",
  warning: "#FEF3C7",
  critical: "#FEE2E2",
};

const SEVERITY_TEXT: Record<DiagnosisResult["severity"], string> = {
  healthy: COLORS.primary,
  warning: "#92400E",
  critical: "#991B1B",
};

const PRIORITY_STYLE: Record<
  Treatment["priority"],
  { bg: string; text: string; label: string }
> = {
  immediate: { bg: "#FEE2E2", text: "#991B1B", label: "Immediate" },
  soon:      { bg: "#FEF3C7", text: "#92400E", label: "Soon"      },
  optional:  { bg: "#F3F4F6", text: "#6B7280", label: "Optional"  },
};

// ─── Scanning animation ───────────────────────────────────────────────────────

function ScanLine() {
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(translateY, {
          toValue: SCREEN_HEIGHT * 0.65,
          duration: 1800,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 1800,
          useNativeDriver: true,
        }),
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

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function DiagnosisScreen() {
  const { id: plantId, existingDiagnosis } = useLocalSearchParams<{
    id: string;
    existingDiagnosis?: string;
  }>();

  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const { plants, updatePlant } = usePlantsStore();
  const { profile, subscription } = useUserStore();
  const isPro = subscription === "pro";
  const plant = plants.find((p) => p.id === plantId) ?? null;

  // Gate: redirect free users to paywall every time this screen is focused.
  // __DEV__ bypass lets us test diagnosis without a Pro subscription during development.
  useFocusEffect(
    useCallback(() => {
      if (__DEV__ || existingDiagnosis) return;
      const timer = setTimeout(() => {
        if (!isPro) {
          router.replace("/paywall");
        }
      }, 300);
      return () => clearTimeout(timer);
    }, [isPro, existingDiagnosis]) // eslint-disable-line react-hooks/exhaustive-deps
  );

  const [screenState, setScreenState] = useState<ScreenState>("picker");
  const [slotUris, setSlotUris] = useState<Record<string, string | null>>({});
  const [primaryUri, setPrimaryUri] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(null);
  const [analyzedCount, setAnalyzedCount] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isViewingExisting, setIsViewingExisting] = useState(false);
  const [actionBarHeight, setActionBarHeight] = useState(0);

  // ── Load existing diagnosis on mount ──────────────────────────────────────

  useEffect(() => {
    if (!existingDiagnosis) return;
    try {
      const record = JSON.parse(existingDiagnosis as string);
      const result = (record.result ?? record) as DiagnosisResult;
      setDiagnosis(result);
      setScreenState("results");
      setIsViewingExisting(true);
    } catch {
      // Malformed param — fall back to picker flow
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pick photo for a slot ─────────────────────────────────────────────────

  const handlePickPhoto = useCallback((slotKey: string) => {
    Alert.alert("Add Photo", "Choose a source", [
      {
        text: "Camera",
        onPress: async () => {
          const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.85,
            allowsEditing: false,
          });
          if (!result.canceled && result.assets[0]) {
            setSlotUris((prev) => ({ ...prev, [slotKey]: result.assets[0].uri }));
          }
        },
      },
      {
        text: "Photo Library",
        onPress: async () => {
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.85,
            allowsEditing: false,
          });
          if (!result.canceled && result.assets[0]) {
            setSlotUris((prev) => ({ ...prev, [slotKey]: result.assets[0].uri }));
          }
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }, []);

  // ── Analyze ───────────────────────────────────────────────────────────────

  const handleAnalyze = useCallback(async () => {
    if (!plant || !profile) return;

    const filledSlots = PHOTO_SLOTS.filter((s) => slotUris[s.key]);
    if (filledSlots.length === 0) return;

    // Show the leaves photo (or first filled) as the analyzing background
    const bgUri = slotUris["leaves"] ?? slotUris[filledSlots[0].key] ?? null;
    setPrimaryUri(bgUri);
    setScreenState("analyzing");

    try {
      // Process all selected photos in parallel
      const photos = await Promise.all(
        filledSlots.map(async (slot) => {
          const uri = slotUris[slot.key]!;
          const filename = `diagnosis_${slot.key}_${Date.now()}.jpg`;
          const destUri = `${FileSystem.cacheDirectory}${filename}`;
          await FileSystem.copyAsync({ from: uri, to: destUri });
          const base64 = await compressImage(destUri);
          return { base64, part: slot.label };
        })
      );

      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseKey) {
        throw new Error("Supabase configuration missing");
      }

      const response = await fetch(
        `${supabaseUrl}/functions/v1/diagnose-plant`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            photos,
            plantId: plant.id,
            userId: profile.id,
            plantName: plant.name,
            species: plant.species ?? plant.common_name ?? "Unknown",
          }),
        }
      );

      if (!response.ok) {
        const err = (await response.json()) as { error?: string };
        throw new Error(err.error ?? "Diagnosis failed");
      }

      const result = (await response.json()) as DiagnosisResult;
      setDiagnosis(result);
      setAnalyzedCount(photos.length);

      // Update plant health score
      const currentHealth = plant.health_score;
      let newHealth = currentHealth;
      if (result.severity === "healthy") {
        newHealth = Math.min(100, currentHealth + 5);
      } else if (result.severity === "warning") {
        newHealth = Math.max(0, currentHealth - 15);
      } else {
        newHealth = Math.max(0, currentHealth - 30);
      }

      supabase
        .from("plants")
        .update({ health_score: newHealth })
        .eq("id", plant.id)
        .then(({ error }) => {
          if (error) console.warn("diagnosis: health score update failed", error.message);
          else updatePlant(plant.id, { health_score: newHealth });
        });

      setScreenState("results");
    } catch (err) {
      Alert.alert(
        "Diagnosis Failed",
        err instanceof Error ? err.message : "Something went wrong. Please try again."
      );
      setScreenState("picker");
    }
  }, [plant, profile, slotUris, updatePlant]);

  const handleTryAgain = useCallback(() => {
    setDiagnosis(null);
    setSlotUris({});
    setPrimaryUri(null);
    setAnalyzedCount(0);
    setScreenState("picker");
  }, []);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await new Promise((r) => setTimeout(r, 300));
      router.back();
    } finally {
      setIsSaving(false);
    }
  }, [router]);

  // ── Guard: subscription not yet confirmed ──────────────────────────────────

  if (!__DEV__ && !isPro && !existingDiagnosis) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.cream, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  // ── Guard: plant not found ─────────────────────────────────────────────────

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

  // ────────────────────────────────────────────────────────────────────────────
  // STATE 1 — Photo picker
  // ────────────────────────────────────────────────────────────────────────────

  const leavesReady = !!slotUris["leaves"];
  const filledCount = PHOTO_SLOTS.filter((s) => slotUris[s.key]).length;

  if (screenState === "picker") {
    return (
      <View style={[styles.screen, { backgroundColor: COLORS.cream }]}>
        <Stack.Screen options={{ headerShown: false }} />

        <ScrollView
          contentContainerStyle={[
            styles.pickerContent,
            { paddingTop: insets.top + 16, paddingBottom: actionBarHeight + 16 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Back button */}
          <TouchableOpacity
            style={styles.resultsBack}
            onPress={() => navigation.goBack()}
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={20} color={COLORS.textPrimary} />
          </TouchableOpacity>

          {/* Header */}
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>Plant Health Check</Text>
            <Text style={styles.pickerSubtitle}>
              Diagnosing: <Text style={{ fontWeight: "700", color: COLORS.primary }}>{plant.name}</Text>
            </Text>
            <Text style={styles.pickerHint}>
              Add photos from different angles. More photos = more accurate diagnosis.
            </Text>
          </View>

          {/* 2x2 slot grid */}
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
                      {/* Overlay with label */}
                      <View style={styles.slotOverlay}>
                        <Text style={styles.slotOverlayEmoji}>{slot.emoji}</Text>
                        <Text style={styles.slotOverlayLabel}>{slot.label}</Text>
                      </View>
                      {/* Tap to change */}
                      <View style={styles.slotChangeBtn}>
                        <Camera size={12} color="#fff" />
                      </View>
                    </>
                  ) : (
                    <>
                      <Text style={styles.slotEmoji}>{slot.emoji}</Text>
                      <Text style={styles.slotLabel}>
                        {slot.label}
                        {slot.required ? (
                          <Text style={styles.slotRequired}> *</Text>
                        ) : null}
                      </Text>
                      <Text style={styles.slotHint}>{slot.hint}</Text>
                      <View style={styles.slotAddIcon}>
                        <Plus size={18} color={COLORS.primary} />
                      </View>
                    </>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {!leavesReady && (
            <Text style={styles.requiredNote}>
              * Leaves photo is required to start the analysis.
            </Text>
          )}
        </ScrollView>

        {/* Fixed bottom bar */}
        <View style={[styles.actionBar, { paddingBottom: insets.bottom + 12 }]} onLayout={(e) => setActionBarHeight(e.nativeEvent.layout.height)}>
          <TouchableOpacity
            style={[styles.analyzeButton, !leavesReady && styles.analyzeButtonDisabled]}
            onPress={handleAnalyze}
            disabled={!leavesReady}
            accessibilityLabel="Analyze plant health"
            accessibilityRole="button"
          >
            <Text style={styles.analyzeButtonText}>
              {filledCount > 0
                ? `Analyze Health (${filledCount} photo${filledCount > 1 ? "s" : ""})`
                : "Analyze Health"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // STATE 2 — Analyzing
  // ────────────────────────────────────────────────────────────────────────────

  if (screenState === "analyzing") {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />

        {primaryUri && (
          <Image
            source={{ uri: primaryUri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        )}
        <View style={[StyleSheet.absoluteFill, styles.analyzingDim]} />

        <ScanLine />

        <View style={styles.analyzingContent}>
          <ActivityIndicator color={COLORS.secondary} size="large" />
          <Text style={styles.analyzingTitle}>
            Analyzing {filledCount} photo{filledCount > 1 ? "s" : ""}...
          </Text>
          <Text style={styles.analyzingSubtitle}>AI is examining your plant</Text>
        </View>
      </View>
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // STATE 3 — Results
  // ────────────────────────────────────────────────────────────────────────────

  if (!diagnosis) return null;

  const severityBg = SEVERITY_BG[diagnosis.severity];
  const severityTextColor = SEVERITY_TEXT[diagnosis.severity];
  const severityEmoji = SEVERITY_EMOJI[diagnosis.severity];
  const confidencePct = Math.round(diagnosis.confidence * 100);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView
        style={styles.resultsScroll}
        contentContainerStyle={[
          styles.resultsContent,
          { paddingTop: insets.top + 16, paddingBottom: actionBarHeight + 16 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Back button */}
        <TouchableOpacity
          style={styles.resultsBack}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={20} color={COLORS.textPrimary} />
        </TouchableOpacity>

        {/* ── Header card ───────────────────────────────────────────────── */}
        <View style={[styles.card, styles.headerCard, { backgroundColor: severityBg }]}>
          <Text style={styles.severityEmoji}>{severityEmoji}</Text>
          <Text style={[styles.conditionName, { color: severityTextColor }]}>
            {diagnosis.condition}
          </Text>
          <Text style={[styles.confidenceText, { color: severityTextColor }]}>
            {confidencePct}% confidence
          </Text>
          {!isViewingExisting && analyzedCount > 0 && (
            <Text style={[styles.photosAnalyzedText, { color: severityTextColor }]}>
              Photos analyzed: {analyzedCount}
            </Text>
          )}
          <Text style={[styles.descriptionText, { color: severityTextColor }]}>
            {diagnosis.description}
          </Text>
        </View>

        {/* ── Treatments card ───────────────────────────────────────────── */}
        {diagnosis.treatments.length > 0 && diagnosis.severity !== "healthy" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Recommended Actions</Text>
            {diagnosis.treatments.map((t, i) => {
              const ps = PRIORITY_STYLE[t.priority];
              return (
                <View key={i} style={[styles.treatmentRow, i > 0 && styles.treatmentSpacer]}>
                  <View style={[styles.priorityBadge, { backgroundColor: ps.bg }]}>
                    <Text style={[styles.priorityBadgeText, { color: ps.text }]}>
                      {ps.label}
                    </Text>
                  </View>
                  <Text style={styles.treatmentAction}>{t.action}</Text>
                  <Text style={styles.treatmentDetail}>{t.detail}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* ── Causes card ───────────────────────────────────────────────── */}
        {diagnosis.causes.length > 0 && diagnosis.severity !== "healthy" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Possible Causes</Text>
            {diagnosis.causes.map((cause, i) => (
              <View key={i} style={styles.bulletRow}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.bulletText}>{cause}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Prevention card ───────────────────────────────────────────── */}
        {diagnosis.prevention.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Prevention Tips</Text>
            {diagnosis.prevention.map((tip, i) => (
              <View key={i} style={styles.bulletRow}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.bulletText}>{tip}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Health score — only for fresh diagnoses ───────────────────── */}
        {!isViewingExisting && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Health Score Impact</Text>
            <View style={styles.healthScoreRow}>
              <Text style={styles.healthScoreValue}>{plant.health_score}</Text>
              <Text style={styles.healthScoreArrow}>→</Text>
              <Text style={[styles.healthScoreValue, { color: diagnosis.severity === "healthy" ? COLORS.success : COLORS.danger }]}>
                {diagnosis.severity === "healthy"
                  ? Math.min(100, plant.health_score + 5)
                  : diagnosis.severity === "warning"
                  ? Math.max(0, plant.health_score - 15)
                  : Math.max(0, plant.health_score - 30)}
              </Text>
            </View>
            <Text style={styles.healthScoreLabel}>Updated health score for {plant.name}</Text>
          </View>
        )}
      </ScrollView>

      {/* ── Fixed action bar ──────────────────────────────────────────── */}
      <View style={[styles.actionBar, { paddingBottom: insets.bottom + 12 }]} onLayout={(e) => setActionBarHeight(e.nativeEvent.layout.height)}>
        {isViewingExisting ? (
          <TouchableOpacity
            style={styles.saveButton}
            onPress={() => navigation.goBack()}
            accessibilityLabel="Go back to plant detail"
            accessibilityRole="button"
          >
            <Text style={styles.saveButtonText}>Done</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity
              style={styles.tryAgainButton}
              onPress={handleTryAgain}
              accessibilityLabel="Try again with new photos"
              accessibilityRole="button"
            >
              <RefreshCw size={18} color={COLORS.primary} />
              <Text style={styles.tryAgainText}>Try Again</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.saveButton}
              onPress={handleSave}
              disabled={isSaving}
              accessibilityLabel="Save diagnosis and go back"
              accessibilityRole="button"
            >
              {isSaving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.saveButtonText}>Save Diagnosis</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#000",
  },

  // ── Not found ──────────────────────────────────────────────────────────────
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

  // ── Picker ─────────────────────────────────────────────────────────────────
  pickerContent: {
    paddingHorizontal: 16,
  },
  pickerHeader: {
    marginBottom: 20,
    gap: 6,
  },
  pickerTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: COLORS.primary,
    letterSpacing: -0.5,
  },
  pickerSubtitle: {
    fontSize: 15,
    color: COLORS.textSecondary,
  },
  pickerHint: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 19,
    marginTop: 2,
  },
  slotGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  slot: {
    width: "47.5%",
    aspectRatio: 1,
    backgroundColor: "#fff",
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#E5E7EB",
    borderStyle: "dashed",
    padding: 12,
    gap: 4,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  slotFilled: {
    borderStyle: "solid",
    borderColor: COLORS.primary,
    padding: 0,
  },
  slotImage: {
    width: "100%",
    height: "100%",
    borderRadius: 18,
  },
  slotOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  slotOverlayEmoji: {
    fontSize: 13,
  },
  slotOverlayLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#fff",
  },
  slotChangeBtn: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  slotEmoji: {
    fontSize: 28,
    marginBottom: 2,
  },
  slotLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textPrimary,
    textAlign: "center",
  },
  slotRequired: {
    color: COLORS.danger,
  },
  slotHint: {
    fontSize: 11,
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 15,
  },
  slotAddIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.lightgreen,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  requiredNote: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 12,
    textAlign: "center",
  },
  analyzeButton: {
    flex: 1,
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  analyzeButtonDisabled: {
    backgroundColor: "#A3A3A3",
  },
  analyzeButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },

  // ── Analyzing ──────────────────────────────────────────────────────────────
  analyzingDim: {
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  scanLine: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: COLORS.secondary,
    shadowColor: COLORS.secondary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 4,
  },
  analyzingContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  analyzingTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#fff",
    textAlign: "center",
  },
  analyzingSubtitle: {
    fontSize: 15,
    color: "rgba(255,255,255,0.75)",
    textAlign: "center",
  },

  // ── Results ────────────────────────────────────────────────────────────────
  resultsScroll: {
    flex: 1,
    backgroundColor: COLORS.cream,
  },
  resultsContent: {
    paddingHorizontal: 16,
    gap: 12,
  },
  resultsBack: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  headerCard: {
    alignItems: "center",
    gap: 8,
  },
  severityEmoji: {
    fontSize: 48,
  },
  conditionName: {
    fontSize: 24,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: -0.5,
  },
  confidenceText: {
    fontSize: 14,
    fontWeight: "600",
    opacity: 0.75,
  },
  photosAnalyzedText: {
    fontSize: 12,
    fontWeight: "600",
    opacity: 0.65,
  },
  descriptionText: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
    marginTop: 4,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 14,
  },

  // ── Treatments ─────────────────────────────────────────────────────────────
  treatmentRow: {
    gap: 4,
  },
  treatmentSpacer: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "#F3F4F6",
  },
  priorityBadge: {
    alignSelf: "flex-start",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 4,
  },
  priorityBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  treatmentAction: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  treatmentDetail: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 19,
  },

  // ── Bullets ────────────────────────────────────────────────────────────────
  bulletRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  bullet: {
    fontSize: 16,
    color: COLORS.secondary,
    lineHeight: 22,
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 22,
  },

  // ── Health score ───────────────────────────────────────────────────────────
  healthScoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 6,
  },
  healthScoreValue: {
    fontSize: 36,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  healthScoreArrow: {
    fontSize: 24,
    color: COLORS.textSecondary,
  },
  healthScoreLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },

  // ── Action bar ─────────────────────────────────────────────────────────────
  actionBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    paddingTop: 12,
    paddingHorizontal: 16,
    flexDirection: "row",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.cream,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 8,
  },
  tryAgainButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderRadius: 16,
    paddingVertical: 14,
  },
  tryAgainText: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.primary,
  },
  saveButton: {
    flex: 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    paddingVertical: 16,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
});

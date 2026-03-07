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
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, RefreshCw, Camera, ImageIcon } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";

import { COLORS } from "@/constants";
import { supabase } from "@/lib/supabase";
import { compressImage } from "@/lib/imageUtils";
import { usePlantsStore } from "@/store/plants";
import { useUserStore } from "@/store/user";
import type { RepottingAnalysis } from "@/types";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

// ─── Types ────────────────────────────────────────────────────────────────────

type Recommendation = "repot_now" | "repot_soon" | "wait";
type ScreenState = "form" | "analyzing" | "results";

interface RepottingResult {
  recommendation: Recommendation;
  urgency_score: number;
  reasons: string[];
  best_time: string;
  pot_size: string;
  soil_mix: string;
  steps: string[];
  warnings: string[];
  summary: string;
}

// ─── Option data ──────────────────────────────────────────────────────────────

const POT_SIZE_OPTIONS = ["< 4\"", "4-6\"", "6-8\"", "8-10\"", "> 10\""];
const POT_MATERIAL_OPTIONS = ["Plastic", "Ceramic", "Terracotta", "Other"];
const LAST_REPOTTED_OPTIONS = ["Never", "< 6 months", "6-12 months", "1-2 years", "> 2 years"];

const OBSERVED_SIGNS = [
  "Roots coming out of drainage holes",
  "Roots circling the surface",
  "Plant drying out faster than usual",
  "Slow or no growth",
  "Plant looks too big for pot",
  "Soil drains very slowly",
];

// ─── Recommendation config ────────────────────────────────────────────────────

const REC_CONFIG: Record<Recommendation, { label: string; bg: string; text: string }> = {
  repot_now: { label: "Repot Now 🚨", bg: "#FEE2E2", text: "#991B1B" },
  repot_soon: { label: "Repot Soon ⚠️", bg: "#FEF3C7", text: "#92400E" },
  wait: { label: "All Good ✅", bg: "#D8F3DC", text: COLORS.primary },
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

export default function RepottingScreen() {
  const { id: plantId, existingAnalysis } = useLocalSearchParams<{ id: string; existingAnalysis?: string }>();
  const navigation = useNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { plants } = usePlantsStore();
  const { profile } = useUserStore();
  const plant = plants.find((p) => p.id === plantId) ?? null;

  // ── Form state ──────────────────────────────────────────────────────────────
  const [potSize, setPotSize] = useState(POT_SIZE_OPTIONS[1]);
  const [potMaterial, setPotMaterial] = useState(POT_MATERIAL_OPTIONS[0]);
  const [lastRepotted, setLastRepotted] = useState(LAST_REPOTTED_OPTIONS[3]);
  const [selectedSigns, setSelectedSigns] = useState<Set<string>>(new Set());
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  // ── Screen state ────────────────────────────────────────────────────────────
  const [screenState, setScreenState] = useState<ScreenState>("form");
  const [result, setResult] = useState<RepottingResult | null>(null);
  const [isViewingExisting, setIsViewingExisting] = useState(false);

  // Jump straight to results when viewing an existing analysis from history
  useEffect(() => {
    if (!existingAnalysis) return;
    try {
      const record = JSON.parse(existingAnalysis as string) as RepottingAnalysis;
      setResult({
        recommendation: record.recommendation,
        urgency_score: record.urgency_score,
        reasons: record.reasons,
        best_time: record.best_time ?? "",
        pot_size: record.pot_size ?? "",
        soil_mix: record.soil_mix ?? "",
        steps: record.steps,
        warnings: record.warnings ?? [],
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

  // ── Pick photo ───────────────────────────────────────────────────────────────
  const handlePickPhoto = useCallback(async (source: "camera" | "gallery") => {
    try {
      let pickerResult: ImagePicker.ImagePickerResult;
      if (source === "camera") {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Camera access required", "Please allow camera access in your device settings.");
          return;
        }
        pickerResult = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 });
      } else {
        pickerResult = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
      }
      if (!pickerResult.canceled && pickerResult.assets[0]?.uri) {
        setPhotoUri(pickerResult.assets[0].uri);
      }
    } catch {
      Alert.alert("Error", "Could not access photo. Please try again.");
    }
  }, []);

  // ── Analyze ──────────────────────────────────────────────────────────────────
  const handleAnalyze = useCallback(async () => {
    if (!plant) return;
    setScreenState("analyzing");

    try {
      let photoBase64: string | undefined;
      if (photoUri) {
        const filename = `repot_${Date.now()}.jpg`;
        const destUri = `${FileSystem.cacheDirectory}${filename}`;
        await FileSystem.copyAsync({ from: photoUri, to: destUri });
        photoBase64 = await compressImage(destUri);
      }

      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseKey) throw new Error("Supabase configuration missing");

      const response = await fetch(`${supabaseUrl}/functions/v1/repotting-advisor`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          plantName: plant.name,
          species: plant.species ?? plant.common_name ?? "Unknown",
          currentPotSize: potSize,
          currentPotMaterial: potMaterial,
          lastRepotted,
          observedSigns: Array.from(selectedSigns),
          photoBase64,
        }),
      });

      if (!response.ok) {
        const err = await response.json() as { error?: string };
        throw new Error(err.error ?? "Analysis failed");
      }

      const data = await response.json() as RepottingResult;

      // Save to Supabase (best-effort)
      if (profile) {
        supabase.from("repotting_analyses").insert({
          plant_id: plantId,
          user_id: profile.id,
          recommendation: data.recommendation,
          urgency_score: data.urgency_score,
          reasons: data.reasons,
          best_time: data.best_time,
          pot_size: data.pot_size,
          soil_mix: data.soil_mix,
          steps: data.steps,
          warnings: data.warnings,
          summary: data.summary,
          current_pot_size: potSize,
          current_pot_material: potMaterial,
          observed_signs: Array.from(selectedSigns),
        }).then(({ error }) => {
          if (error) console.warn("repotting: failed to save analysis", error);
        });
      }

      setResult(data);
      setScreenState("results");
    } catch (err) {
      Alert.alert("Analysis Failed", err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setScreenState("form");
    }
  }, [plant, potSize, potMaterial, lastRepotted, selectedSigns, photoUri, profile, plantId]);

  const handleRetake = useCallback(() => {
    setResult(null);
    setIsViewingExisting(false);
    setScreenState("form");
  }, []);

  // ── Guard ─────────────────────────────────────────────────────────────────
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

  // ──────────────────────────────────────────────────────────────────────────
  // STATE 1 — Form
  // ──────────────────────────────────────────────────────────────────────────

  if (screenState === "form") {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.formContent,
            { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.formHeader}>
            <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} accessibilityLabel="Go back">
              <ArrowLeft size={20} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.formTitle}>Repotting Advisor</Text>
          </View>

          {/* Plant preview */}
          <View style={styles.plantPreview}>
            {plant.photo_url ? (
              <Image source={{ uri: plant.photo_url }} style={styles.plantThumb} resizeMode="cover" />
            ) : (
              <View style={[styles.plantThumb, styles.plantThumbPlaceholder]}>
                <Text style={{ fontSize: 28 }}>🪴</Text>
              </View>
            )}
            <View style={styles.plantPreviewText}>
              <Text style={styles.plantPreviewName}>{plant.name}</Text>
              {plant.species ? <Text style={styles.plantPreviewSpecies}>{plant.species}</Text> : null}
            </View>
          </View>

          {/* ── Current pot size ──────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Current pot size</Text>
            <View style={styles.pillRow}>
              {POT_SIZE_OPTIONS.map((opt) => (
                <PillOption key={opt} label={opt} selected={potSize === opt} onPress={() => setPotSize(opt)} />
              ))}
            </View>
          </View>

          {/* ── Pot material ──────────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pot material</Text>
            <View style={styles.pillRow}>
              {POT_MATERIAL_OPTIONS.map((opt) => (
                <PillOption key={opt} label={opt} selected={potMaterial === opt} onPress={() => setPotMaterial(opt)} />
              ))}
            </View>
          </View>

          {/* ── Last repotted ─────────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Last repotted</Text>
            <View style={styles.pillRow}>
              {LAST_REPOTTED_OPTIONS.map((opt) => (
                <PillOption key={opt} label={opt} selected={lastRepotted === opt} onPress={() => setLastRepotted(opt)} />
              ))}
            </View>
          </View>

          {/* ── Observed signs ────────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Observed signs</Text>
            <Text style={styles.sectionSubtitle}>Select all that apply</Text>
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

          {/* ── Photo (optional) ──────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Photo of plant/roots (optional)</Text>
            <Text style={styles.sectionSubtitle}>Adding a photo helps AI spot root-bound signs</Text>
            {photoUri ? (
              <View style={styles.photoWrap}>
                <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />
                <TouchableOpacity style={styles.removePhotoButton} onPress={() => setPhotoUri(null)}>
                  <Text style={styles.removePhotoText}>✕ Remove</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.photoButtonRow}>
                <TouchableOpacity style={styles.photoButton} onPress={() => handlePickPhoto("camera")}>
                  <Camera size={20} color={COLORS.primary} />
                  <Text style={styles.photoButtonText}>Camera</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.photoButton} onPress={() => handlePickPhoto("gallery")}>
                  <ImageIcon size={20} color={COLORS.primary} />
                  <Text style={styles.photoButtonText}>Library</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </ScrollView>

        {/* Analyze button */}
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity style={styles.analyzeButton} onPress={handleAnalyze} activeOpacity={0.85}>
            <Text style={styles.analyzeButtonText}>Analyze Repotting Need 🪴</Text>
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

        {photoUri && (
          <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        )}
        <View style={[StyleSheet.absoluteFill, styles.analyzingDim]} />
        <ScanLine />

        <View style={styles.analyzingContent}>
          <ActivityIndicator color={COLORS.secondary} size="large" />
          <Text style={styles.analyzingTitle}>Analyzing repotting needs...</Text>
          <Text style={styles.analyzingSubtitle}>Checking root health, pot fit, and growth stage</Text>
        </View>
      </View>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STATE 3 — Results
  // ──────────────────────────────────────────────────────────────────────────

  if (!result) return null;

  const recConfig = REC_CONFIG[result.recommendation];

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.resultsContent,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 },
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
              <Text style={[styles.scoreLabel, { color: recConfig.text }]}>/100</Text>
            </View>
            <View style={styles.recTextWrap}>
              <Text style={[styles.recVerdict, { color: recConfig.text }]}>{recConfig.label}</Text>
              <Text style={[styles.recSummary, { color: recConfig.text }]}>{result.summary}</Text>
            </View>
          </View>
        </View>

        {/* ── Reasons ──────────────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Why this recommendation</Text>
          {result.reasons.map((r, i) => (
            <View key={i} style={styles.bulletRow}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>{r}</Text>
            </View>
          ))}
        </View>

        {/* ── Repotting details ─────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Repotting details</Text>
          {result.best_time ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Best time</Text>
              <Text style={styles.detailValue}>{result.best_time}</Text>
            </View>
          ) : null}
          {result.pot_size ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>New pot size</Text>
              <Text style={styles.detailValue}>{result.pot_size}</Text>
            </View>
          ) : null}
          {result.soil_mix ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Soil mix</Text>
              <Text style={styles.detailValue}>{result.soil_mix}</Text>
            </View>
          ) : null}
        </View>

        {/* ── Step-by-step instructions ─────────────────────────────────── */}
        {result.steps.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>How to repot</Text>
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

        {/* ── Warnings ─────────────────────────────────────────────────── */}
        {result.warnings && result.warnings.length > 0 && (
          <View style={[styles.card, styles.warningCard]}>
            <Text style={styles.warningTitle}>⚠️ Things to watch out for</Text>
            {result.warnings.map((w, i) => (
              <View key={i} style={styles.bulletRow}>
                <Text style={styles.bulletDot}>•</Text>
                <Text style={styles.warningText}>{w}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* ── Action bar ───────────────────────────────────────────────────── */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity style={styles.retakeButton} onPress={handleRetake} accessibilityRole="button">
          <RefreshCw size={18} color={COLORS.primary} />
          <Text style={styles.retakeButtonText}>
            {isViewingExisting ? "New Analysis" : "Start over"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.doneButton} onPress={() => navigation.goBack()} accessibilityRole="button">
          <Text style={styles.doneButtonText}>Done ✓</Text>
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

  // ── Photo ─────────────────────────────────────────────────────────────────
  photoButtonRow: { flexDirection: "row", gap: 10 },
  photoButton: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: "#fff", borderRadius: 14, paddingVertical: 14,
    borderWidth: 1.5, borderColor: COLORS.secondary,
  },
  photoButtonText: { fontSize: 14, fontWeight: "600", color: COLORS.primary },
  photoWrap: { borderRadius: 16, overflow: "hidden" },
  photo: { width: "100%", height: 160, borderRadius: 16 },
  removePhotoButton: {
    position: "absolute", top: 8, right: 8,
    backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  removePhotoText: { color: "#fff", fontSize: 12, fontWeight: "600" },

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
  bulletDot: { fontSize: 16, color: COLORS.primary, lineHeight: 22 },
  bulletText: { flex: 1, fontSize: 14, color: COLORS.textSecondary, lineHeight: 22 },
  detailRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.cream,
    gap: 12,
  },
  detailLabel: { fontSize: 13, color: COLORS.textSecondary, fontWeight: "500", flex: 1 },
  detailValue: { fontSize: 14, fontWeight: "600", color: COLORS.textPrimary, flex: 2, textAlign: "right" },
  stepRow: { flexDirection: "row", gap: 12, marginBottom: 12, alignItems: "flex-start" },
  stepNum: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center",
    flexShrink: 0, marginTop: 1,
  },
  stepNumText: { fontSize: 12, fontWeight: "700", color: "#fff" },
  stepText: { flex: 1, fontSize: 14, color: COLORS.textPrimary, lineHeight: 22 },
  warningCard: { backgroundColor: "#FEF3C7" },
  warningTitle: { fontSize: 15, fontWeight: "700", color: "#92400E", marginBottom: 12 },
  warningText: { flex: 1, fontSize: 14, color: "#92400E", lineHeight: 22 },

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

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
import { CameraView } from "expo-camera";
import { Stack, useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, RefreshCw } from "lucide-react-native";
import * as FileSystem from "expo-file-system/legacy";

import { COLORS } from "@/constants";
import { useCamera } from "@/hooks/useCamera";
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

type ScreenState = "camera" | "analyzing" | "results";

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
  soon: { bg: "#FEF3C7", text: "#92400E", label: "Soon" },
  optional: { bg: "#F3F4F6", text: "#6B7280", label: "Optional" },
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
  // useFocusEffect + a short delay ensures the Zustand store is fully hydrated
  // from the RevenueCat listener before we read isPro, preventing a false
  // redirect on first render when subscription defaults to "free".
  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(() => {
        if (!isPro) {
          router.replace("/paywall");
        }
      }, 300);
      return () => clearTimeout(timer);
    }, [isPro]) // eslint-disable-line react-hooks/exhaustive-deps
  );

  const [screenState, setScreenState] = useState<ScreenState>("camera");
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isViewingExisting, setIsViewingExisting] = useState(false);

  const { hasPermission, requestPermission } = useCamera();
  const cameraRef = useRef<CameraView | null>(null);

  // ── Load existing diagnosis on mount ──────────────────────────────────────
  // useLocalSearchParams params may not be populated on the very first render,
  // so we read them in a mount effect rather than using them as useState
  // initial values — this guarantees we see the fully-resolved params.

  useEffect(() => {
    if (!existingDiagnosis) return;
    try {
      const record = JSON.parse(existingDiagnosis as string);
      // The Diagnosis DB record stores the DiagnosisResult in its `result` field
      const result = (record.result ?? record) as DiagnosisResult;
      setDiagnosis(result);
      setScreenState("results");
      setIsViewingExisting(true);
    } catch {
      // Malformed param — fall back to the normal camera flow
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Camera permission ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Capture + analyse ─────────────────────────────────────────────────────

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || !plant || !profile) return;

    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
      if (!photo?.uri) throw new Error("No photo captured");

      setCapturedUri(photo.uri);
      setScreenState("analyzing");

      // Android's camera URI uses a scheme that FileSystem / manipulateAsync
      // can't read directly. Copy to the app's cache dir first so the path
      // has a supported file:// scheme, then compress + get base64.
      const filename = `diagnosis_${Date.now()}.jpg`;
      const destUri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.copyAsync({ from: photo.uri, to: destUri });

      const base64 = await compressImage(destUri);

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
            image: base64,
            plantId: plant.id,
            userId: profile.id,
            plantName: plant.name,
            species: plant.species ?? plant.common_name ?? "Unknown",
          }),
        }
      );

      if (!response.ok) {
        const err = await response.json() as { error?: string };
        throw new Error(err.error ?? "Diagnosis failed");
      }

      const result = await response.json() as DiagnosisResult;
      setDiagnosis(result);

      // Update the plant's health score in Supabase + local store based on severity
      const currentHealth = plant.health_score;
      let newHealth = currentHealth;
      if (result.severity === "healthy") {
        newHealth = Math.min(100, currentHealth + 5);
      } else if (result.severity === "warning") {
        newHealth = Math.max(0, currentHealth - 15);
      } else {
        newHealth = Math.max(0, currentHealth - 30);
      }

      // Fire-and-forget the health score update — results are already available
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
      setScreenState("camera");
      setCapturedUri(null);
    }
  }, [plant, profile, updatePlant]);

  const handleTryAgain = useCallback(() => {
    setDiagnosis(null);
    setCapturedUri(null);
    setScreenState("camera");
  }, []);

  // ── Save diagnosis and go back ─────────────────────────────────────────────
  // The Edge Function already persisted the row during analysis.
  // "Save Diagnosis" here just navigates back to plant detail with confirmation.

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      // Brief delay so the button press feels acknowledged
      await new Promise((r) => setTimeout(r, 300));
      router.back();
    } finally {
      setIsSaving(false);
    }
  }, [router]);

  // ── Guard: subscription not yet confirmed (redirect pending) ──────────────

  if (!isPro) {
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

  // ── Camera permission denied ───────────────────────────────────────────────

  if (!hasPermission) {
    return (
      <View style={styles.permissionScreen}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.permissionTitle}>Camera Access Required</Text>
        <Text style={styles.permissionBody}>
          GreenThumb needs camera access to photograph your plant's leaves.
        </Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant Access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // STATE 1 — Camera viewfinder
  // ────────────────────────────────────────────────────────────────────────────

  if (screenState === "camera") {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />

        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
        />

        {/* Dark overlay — top bar */}
        <View style={[styles.overlay, styles.overlayTop, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={20} color="#fff" />
          </TouchableOpacity>

          <View style={styles.cameraInstructions}>
            <Text style={styles.cameraTitle}>📸 Photo a leaf clearly</Text>
            <Text style={styles.cameraSubtitle}>
              Get close to show any spots, discoloration or damage
            </Text>
          </View>
        </View>

        {/* Plant name badge */}
        <View style={styles.plantNameBadge}>
          <Text style={styles.plantNameBadgeText}>
            Diagnosing: {plant.name}
          </Text>
        </View>

        {/* Capture button */}
        <View style={[styles.captureRow, { paddingBottom: insets.bottom + 24 }]}>
          <TouchableOpacity
            style={styles.captureButton}
            onPress={handleCapture}
            accessibilityLabel="Take photo for diagnosis"
            accessibilityRole="button"
          >
            <View style={styles.captureButtonInner} />
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

        {/* Captured photo as dimmed background */}
        {capturedUri && (
          <Image
            source={{ uri: capturedUri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        )}
        <View style={[StyleSheet.absoluteFill, styles.analyzingDim]} />

        {/* Scanning line animation */}
        <ScanLine />

        {/* Centered text */}
        <View style={styles.analyzingContent}>
          <ActivityIndicator color={COLORS.secondary} size="large" />
          <Text style={styles.analyzingTitle}>Analyzing plant health...</Text>
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
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 120 },
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

        {/* ── Health score change — only shown for fresh diagnoses ─────── */}
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
      <View style={[styles.actionBar, { paddingBottom: insets.bottom + 12 }]}>
        {isViewingExisting ? (
          // Viewing a past diagnosis — just allow going back
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
              accessibilityLabel="Try again with a new photo"
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
                <Text style={styles.saveButtonText}>Save Diagnosis ✓</Text>
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

  // ── Not found / permission ─────────────────────────────────────────────────
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
  permissionScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.cream,
    paddingHorizontal: 32,
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 12,
    textAlign: "center",
  },
  permissionBody: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 28,
  },
  permissionButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  permissionButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },

  // ── Camera ─────────────────────────────────────────────────────────────────
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  overlayTop: {
    top: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  cameraInstructions: {
    alignItems: "center",
  },
  cameraTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#fff",
    textAlign: "center",
  },
  cameraSubtitle: {
    fontSize: 14,
    color: "rgba(255,255,255,0.8)",
    textAlign: "center",
    marginTop: 6,
    lineHeight: 20,
  },
  plantNameBadge: {
    position: "absolute",
    bottom: 130,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  plantNameBadgeText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  captureRow: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  captureButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  captureButtonInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#fff",
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

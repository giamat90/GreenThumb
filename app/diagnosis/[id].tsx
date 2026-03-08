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

import { useTranslation } from "react-i18next";

import { COLORS } from "@/constants";
import { compressImage } from "@/lib/imageUtils";
import { supabase } from "@/lib/supabase";
import { deviceLanguage } from "@/lib/i18n";
import { scheduleFollowUpDiagnosisNotification } from "@/lib/notifications";
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

// Labels/hints are translated inside the component; key is English for API use.
const PHOTO_SLOT_DEFS = [
  { key: "leaves",  emoji: "🍃", labelKey: "diagnosis.leavesRequired", hintKey: "diagnosis.leavesHint",  required: true  },
  { key: "overall", emoji: "🌿", labelKey: "diagnosis.overallPlant",   hintKey: "diagnosis.overallHint", required: false },
  { key: "stem",    emoji: "🌱", labelKey: "diagnosis.stemBase",       hintKey: "diagnosis.stemHint",    required: false },
  { key: "soil",    emoji: "🪨", labelKey: "diagnosis.soil",           hintKey: "diagnosis.soilHint",    required: false },
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

// Priority labels are translated inside the component using t()
const PRIORITY_STYLE: Record<
  Treatment["priority"],
  { bg: string; text: string }
> = {
  immediate: { bg: "#FEE2E2", text: "#991B1B" },
  soon:      { bg: "#FEF3C7", text: "#92400E" },
  optional:  { bg: "#F3F4F6", text: "#6B7280" },
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
  const { t } = useTranslation();
  const { id: plantId, existingDiagnosis, isFollowUp, previousCondition } = useLocalSearchParams<{
    id: string;
    existingDiagnosis?: string;
    isFollowUp?: string;
    previousCondition?: string;
  }>();

  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const PHOTO_SLOTS: PhotoSlot[] = PHOTO_SLOT_DEFS.map((d) => ({
    key: d.key,
    emoji: d.emoji,
    label: t(d.labelKey),
    hint: t(d.hintKey),
    required: d.required,
  }));

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

  // Closed-loop care state
  const [wateringAdjusted, setWateringAdjusted] = useState(false);
  const [followUpDate, setFollowUpDate] = useState<Date | null>(null);
  const [followUpScheduled, setFollowUpScheduled] = useState(false);
  const [wateringAdjustmentDone, setWateringAdjustmentDone] = useState(false);
  const [suggestedWateringDays, setSuggestedWateringDays] = useState<number>(5);

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

  // ── Compute follow-up date and suggested watering when diagnosis is ready ──

  useEffect(() => {
    if (diagnosis && !isViewingExisting) {
      // Compute follow-up date based on severity
      const days = diagnosis.severity === "critical" ? 3 : diagnosis.severity === "warning" ? 7 : 14;
      const date = new Date();
      date.setDate(date.getDate() + days);
      setFollowUpDate(date);

      // Compute suggested watering days
      const currentDays =
        plant?.care_profile?.watering === "frequent" ? 2 :
        plant?.care_profile?.watering === "minimum" ? 10 : 5;

      const conditionText = (diagnosis.condition + " " + diagnosis.description).toLowerCase();
      const isUnderwatering = ["underwatering", "under-watering", "too dry", "drought", "thirsty", "wilting", "dehydrat"].some(k => conditionText.includes(k));
      const isOverwatering = ["overwatering", "over-watering", "root rot", "waterlogged", "soggy", "too wet", "excess water"].some(k => conditionText.includes(k));

      if (isUnderwatering) {
        setSuggestedWateringDays(Math.max(1, currentDays - 2));
      } else if (isOverwatering) {
        setSuggestedWateringDays(currentDays + 3);
      } else {
        setSuggestedWateringDays(currentDays);
      }
    }
  }, [diagnosis, isViewingExisting]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pick photo for a slot ─────────────────────────────────────────────────

  const handlePickPhoto = useCallback((slotKey: string) => {
    Alert.alert(t("diagnosis.addPhoto"), t("diagnosis.chooseSource"), [
      {
        text: t("common.takePhoto"),
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
        text: t("common.chooseFromGallery"),
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
      { text: t("common.cancel"), style: "cancel" },
    ]);
  }, [t]);

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
            language: deviceLanguage(),
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
        t("diagnosis.diagnosisFailed"),
        err instanceof Error ? err.message : t("common.somethingWentWrong")
      );
      setScreenState("picker");
    }
  }, [plant, profile, slotUris, updatePlant, t]);

  const handleTryAgain = useCallback(() => {
    setDiagnosis(null);
    setSlotUris({});
    setPrimaryUri(null);
    setAnalyzedCount(0);
    setWateringAdjusted(false);
    setWateringAdjustmentDone(false);
    setFollowUpDate(null);
    setFollowUpScheduled(false);
    setScreenState("picker");
  }, []);

  const handleSave = useCallback(async () => {
    if (!plant || !profile || !diagnosis) return;
    setIsSaving(true);
    try {
      await supabase.from("diagnoses").insert({
        plant_id: plant.id,
        user_id: profile.id,
        result: diagnosis as unknown as Record<string, unknown>,
        severity: diagnosis.severity,
        follow_up_date: followUpDate ? followUpDate.toISOString() : null,
        watering_adjusted: wateringAdjusted,
        watering_adjustment_days: wateringAdjusted ? suggestedWateringDays : null,
      });
      router.back();
    } catch (err) {
      Alert.alert(t("common.error"), err instanceof Error ? err.message : t("common.somethingWentWrong"));
    } finally {
      setIsSaving(false);
    }
  }, [plant, profile, diagnosis, followUpDate, wateringAdjusted, suggestedWateringDays, router, t]);

  // ── Watering adjustment handler ────────────────────────────────────────────

  const handleApplyWateringAdjustment = useCallback(async (detectedType: "underwatering" | "overwatering") => {
    if (!plant) return;
    const currentDays =
      plant.care_profile?.watering === "frequent" ? 2 :
      plant.care_profile?.watering === "minimum" ? 10 : 5;
    const suggested = detectedType === "underwatering" ? Math.max(1, currentDays - 2) : currentDays + 3;

    try {
      await supabase.from("plants").update({
        care_profile: { ...plant.care_profile, watering_interval_days: suggested },
      }).eq("id", plant.id);
      updatePlant(plant.id, { care_profile: { ...plant.care_profile, watering_interval_days: suggested } });
      setWateringAdjusted(true);
      setWateringAdjustmentDone(true);
    } catch (err) {
      console.warn("diagnosis: failed to update watering interval", err);
      setWateringAdjusted(true);
      setWateringAdjustmentDone(true);
    }
  }, [plant, updatePlant]);

  // ── Follow-up scheduling handler ──────────────────────────────────────────

  const handleScheduleFollowUp = useCallback(async () => {
    if (!plant || !diagnosis || !followUpDate) return;
    try {
      await scheduleFollowUpDiagnosisNotification(plant.id, plant.name, diagnosis.condition, followUpDate);
    } catch (err) {
      console.warn("diagnosis: failed to schedule follow-up notification", err);
    }
    setFollowUpScheduled(true);
  }, [plant, diagnosis, followUpDate]);

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
        <Text style={styles.notFoundText}>{t("plantDetail.plantNotFound")}</Text>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backLink}>{t("plantDetail.goBack")}</Text>
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
            <Text style={styles.pickerTitle}>{t("diagnosis.title")}</Text>
            <Text style={styles.pickerSubtitle}>
              {t("diagnosis.diagnosing", { name: plant.name })}
            </Text>
            <Text style={styles.pickerHint}>
              {t("diagnosis.morePhotosAccurate")}
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
              {t("diagnosis.leafPhotoRequired")}
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
                ? t("common.analyzeNPhotos", { n: filledCount })
                : t("diagnosis.analyzeHealth")}
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
            {t("diagnosis.analyzing", { n: filledCount })}
          </Text>
          <Text style={styles.analyzingSubtitle}>{t("diagnosis.aiExamining")}</Text>
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

  // Compute watering detection for action cards
  const conditionText = (diagnosis.condition + " " + diagnosis.description).toLowerCase();
  const isUnderwatering = ["underwatering", "under-watering", "too dry", "drought", "thirsty", "wilting", "dehydrat"].some(k => conditionText.includes(k));
  const isOverwatering = ["overwatering", "over-watering", "root rot", "waterlogged", "soggy", "too wet", "excess water"].some(k => conditionText.includes(k));
  const detectedWateringIssue: "underwatering" | "overwatering" | null =
    isUnderwatering ? "underwatering" : isOverwatering ? "overwatering" : null;
  const currentWateringDays =
    plant.care_profile?.watering === "frequent" ? 2 :
    plant.care_profile?.watering === "minimum" ? 10 : 5;

  // Recovery banner logic (follow-up flow)
  const isFollowUpFlow = isFollowUp === "true";
  let recoveryStatusText = t("diagnosis.noSignificantChange");
  let recoveryStatusColor = COLORS.textSecondary;
  if (isFollowUpFlow) {
    if (diagnosis.severity === "healthy") {
      recoveryStatusText = t("diagnosis.conditionImproved");
      recoveryStatusColor = COLORS.success ?? COLORS.primary;
    } else if (diagnosis.severity === "critical") {
      recoveryStatusText = t("diagnosis.conditionWorsened");
      recoveryStatusColor = COLORS.danger ?? "#991B1B";
    }
  }

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

        {/* ── Recovery banner (follow-up flow only) ─────────────────────── */}
        {isFollowUpFlow && previousCondition && (
          <View style={styles.recoveryBanner}>
            <Text style={styles.recoveryTitle}>{t("diagnosis.recoveryProgress")}</Text>
            <Text style={styles.recoverySubtitle}>
              {t("diagnosis.followUpCheckFor", { condition: previousCondition })}
            </Text>
            <Text style={[styles.recoveryStatus, { color: recoveryStatusColor }]}>
              {recoveryStatusText}
            </Text>
          </View>
        )}

        {/* ── Header card ───────────────────────────────────────────────── */}
        <View style={[styles.card, styles.headerCard, { backgroundColor: severityBg }]}>
          <Text style={styles.severityEmoji}>{severityEmoji}</Text>
          <Text style={[styles.conditionName, { color: severityTextColor }]}>
            {diagnosis.condition}
          </Text>
          <Text style={[styles.confidenceText, { color: severityTextColor }]}>
            {confidencePct}% {t("diagnosis.confidence")}
          </Text>
          {!isViewingExisting && analyzedCount > 0 && (
            <Text style={[styles.photosAnalyzedText, { color: severityTextColor }]}>
              {t("common.photosAnalyzed", { n: analyzedCount })}
            </Text>
          )}
          <Text style={[styles.descriptionText, { color: severityTextColor }]}>
            {diagnosis.description}
          </Text>
        </View>

        {/* ── Treatments card ───────────────────────────────────────────── */}
        {diagnosis.treatments.length > 0 && diagnosis.severity !== "healthy" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("diagnosis.recommendedActions")}</Text>
            {diagnosis.treatments.map((treatment, i) => {
              const ps = PRIORITY_STYLE[treatment.priority];
              // Priority label is an AI-defined classification; capitalize for display
              const priorityLabel = treatment.priority.charAt(0).toUpperCase() + treatment.priority.slice(1);
              return (
                <View key={i} style={[styles.treatmentRow, i > 0 && styles.treatmentSpacer]}>
                  <View style={[styles.priorityBadge, { backgroundColor: ps.bg }]}>
                    <Text style={[styles.priorityBadgeText, { color: ps.text }]}>
                      {priorityLabel}
                    </Text>
                  </View>
                  <Text style={styles.treatmentAction}>{treatment.action}</Text>
                  <Text style={styles.treatmentDetail}>{treatment.detail}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* ── Causes card ───────────────────────────────────────────────── */}
        {diagnosis.causes.length > 0 && diagnosis.severity !== "healthy" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("diagnosis.possibleCauses")}</Text>
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
            <Text style={styles.cardTitle}>{t("diagnosis.preventionTips")}</Text>
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
            <Text style={styles.cardTitle}>{t("diagnosis.healthScoreImpact")}</Text>
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
            <Text style={styles.healthScoreLabel}>{t("diagnosis.updatedHealthScore", { name: plant.name })}</Text>
          </View>
        )}

        {/* ── Watering Adjustment card — fresh diagnoses only ───────────── */}
        {!isViewingExisting && detectedWateringIssue && (
          <View style={styles.actionCard}>
            <Text style={styles.actionCardTitle}>{t("diagnosis.wateringAdjustment")}</Text>
            <Text style={styles.actionCardText}>
              {detectedWateringIssue === "underwatering"
                ? t("diagnosis.underwateringDetected")
                : t("diagnosis.overwateringDetected")}
            </Text>
            <Text style={styles.actionCardText}>
              {t("diagnosis.currentInterval", { days: currentWateringDays })}
            </Text>
            <Text style={styles.actionCardText}>
              {t("diagnosis.suggestedInterval", { days: suggestedWateringDays })}
            </Text>
            {wateringAdjustmentDone ? (
              <Text style={styles.actionCardSuccess}>{"✅ " + t("diagnosis.wateringUpdated")}</Text>
            ) : (
              <View style={styles.actionCardButtons}>
                <TouchableOpacity
                  style={styles.actionCardBtnSecondary}
                  onPress={() => setWateringAdjustmentDone(true)}
                  accessibilityRole="button"
                >
                  <Text style={styles.actionCardBtnTextSecondary}>{t("diagnosis.keepCurrent")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionCardBtnPrimary}
                  onPress={() => handleApplyWateringAdjustment(detectedWateringIssue)}
                  accessibilityRole="button"
                >
                  <Text style={styles.actionCardBtnTextPrimary}>{t("diagnosis.applyAdjustment")}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* ── Follow-Up Diagnosis card — fresh diagnoses only ──────────── */}
        {!isViewingExisting && followUpDate && (
          <View style={styles.actionCard}>
            <Text style={styles.actionCardTitle}>{t("diagnosis.followUpDiagnosis")}</Text>
            <Text style={styles.actionCardText}>
              {followUpDate.toLocaleDateString()}
            </Text>
            {followUpScheduled ? (
              <Text style={styles.actionCardSuccess}>{"✅ " + t("diagnosis.followUpScheduled")}</Text>
            ) : (
              <View style={styles.actionCardButtons}>
                <TouchableOpacity
                  style={styles.actionCardBtnSecondary}
                  onPress={() => setFollowUpScheduled(true)}
                  accessibilityRole="button"
                >
                  <Text style={styles.actionCardBtnTextSecondary}>{t("diagnosis.skip")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionCardBtnPrimary}
                  onPress={handleScheduleFollowUp}
                  accessibilityRole="button"
                >
                  <Text style={styles.actionCardBtnTextPrimary}>{t("diagnosis.scheduleFollowUp")}</Text>
                </TouchableOpacity>
              </View>
            )}
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
            <Text style={styles.saveButtonText}>{t("common.done")}</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity
              style={styles.tryAgainButton}
              onPress={handleTryAgain}
              accessibilityLabel={t("diagnosis.tryAgain")}
              accessibilityRole="button"
            >
              <RefreshCw size={18} color={COLORS.primary} />
              <Text style={styles.tryAgainText}>{t("diagnosis.tryAgain")}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.saveButton}
              onPress={handleSave}
              disabled={isSaving}
              accessibilityLabel={t("diagnosis.saveDiagnosis")}
              accessibilityRole="button"
            >
              {isSaving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.saveButtonText}>{t("diagnosis.saveDiagnosis")}</Text>
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

  // ── Action cards (closed-loop care) ────────────────────────────────────────
  actionCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    gap: 10,
  },
  actionCardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  actionCardText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  actionCardButtons: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  actionCardBtnSecondary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    alignItems: "center",
  },
  actionCardBtnPrimary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: "center",
  },
  actionCardBtnTextSecondary: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.primary,
  },
  actionCardBtnTextPrimary: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
  actionCardSuccess: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.success,
    textAlign: "center",
    paddingVertical: 8,
  },

  // ── Recovery banner ────────────────────────────────────────────────────────
  recoveryBanner: {
    backgroundColor: "#EFF6FF",
    borderRadius: 20,
    padding: 16,
    gap: 6,
  },
  recoveryTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1E40AF",
  },
  recoverySubtitle: {
    fontSize: 13,
    color: "#3B82F6",
  },
  recoveryStatus: {
    fontSize: 15,
    fontWeight: "700",
    marginTop: 4,
  },
});

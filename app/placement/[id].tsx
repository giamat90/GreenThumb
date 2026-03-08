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
  Modal,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeft,
  RefreshCw,
  Sun,
  Droplets,
  Thermometer,
  Camera,
  Plus,
} from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Magnetometer } from "expo-sensors";

import { COLORS } from "@/constants";
import { supabase } from "@/lib/supabase";
import { compressImage } from "@/lib/imageUtils";
import { usePlantsStore } from "@/store/plants";
import { useUserStore } from "@/store/user";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

// ─── Photo slots ──────────────────────────────────────────────────────────────

interface PhotoSlot {
  key: string;
  emoji: string;
  label: string;
  hint: string;
}

const PHOTO_SLOTS: PhotoSlot[] = [
  { key: "window",  emoji: "🪟", label: "Window / Light Source",    hint: "Show the nearest window"         },
  { key: "room",    emoji: "🏠", label: "Full Room View",            hint: "Wide shot of the whole room"     },
  { key: "spot",    emoji: "🌡️", label: "Placement Spot",            hint: "The exact spot you have in mind" },
  { key: "current", emoji: "🌿", label: "Current Plant Location",    hint: "Where the plant sits now"        },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type WindowDirection = "north" | "south" | "east" | "west" | "none";
type RoomType = "living room" | "bedroom" | "bathroom" | "kitchen" | "office" | "balcony";
type LightLevel = "bright direct" | "bright indirect" | "medium" | "low";
type FactorStatus = "good" | "warning" | "poor";

interface PlacementFactor {
  status: FactorStatus;
  advice: string;
}

interface PlacementResult {
  overall: FactorStatus;
  score: number;
  light: PlacementFactor;
  humidity: PlacementFactor;
  temperature: PlacementFactor;
  summary: string;
  tips: string[];
}

type ScreenState = "form" | "analyzing" | "results";

// ─── Option data ──────────────────────────────────────────────────────────────

const WINDOW_OPTIONS: { label: string; value: WindowDirection; emoji: string }[] = [
  { label: "North", value: "north", emoji: "N" },
  { label: "South", value: "south", emoji: "S" },
  { label: "East", value: "east", emoji: "E" },
  { label: "West", value: "west", emoji: "W" },
  { label: "None", value: "none", emoji: "–" },
];

const ROOM_OPTIONS: { label: string; value: RoomType; emoji: string }[] = [
  { label: "Living Room", value: "living room", emoji: "🛋️" },
  { label: "Bedroom", value: "bedroom", emoji: "🛏️" },
  { label: "Bathroom", value: "bathroom", emoji: "🚿" },
  { label: "Kitchen", value: "kitchen", emoji: "🍳" },
  { label: "Office", value: "office", emoji: "💼" },
  { label: "Balcony", value: "balcony", emoji: "🌿" },
];

const LIGHT_OPTIONS: { label: string; value: LightLevel; desc: string }[] = [
  { label: "Bright Direct", value: "bright direct", desc: "Sun hits the plant" },
  { label: "Bright Indirect", value: "bright indirect", desc: "Bright but no direct sun" },
  { label: "Medium", value: "medium", desc: "A few feet from window" },
  { label: "Low", value: "low", desc: "Far from windows" },
];

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_EMOJI: Record<FactorStatus, string> = {
  good: "✅",
  warning: "⚠️",
  poor: "❌",
};

const OVERALL_BG: Record<FactorStatus, string> = {
  good: "#D8F3DC",
  warning: "#FEF3C7",
  poor: "#FEE2E2",
};

const OVERALL_TEXT: Record<FactorStatus, string> = {
  good: COLORS.primary,
  warning: "#92400E",
  poor: "#991B1B",
};

const OVERALL_LABEL: Record<FactorStatus, string> = {
  good: "Great spot! 🌟",
  warning: "Could be better ⚠️",
  poor: "Not ideal 🚨",
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

// ─── Pill selector ────────────────────────────────────────────────────────────

function PillOption<T extends string>({
  label,
  value,
  selected,
  onPress,
  prefix,
}: {
  label: string;
  value: T;
  selected: boolean;
  onPress: (v: T) => void;
  prefix?: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.pill, selected && styles.pillSelected]}
      onPress={() => onPress(value)}
      accessibilityLabel={label}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      {prefix ? <Text style={styles.pillPrefix}>{prefix}</Text> : null}
      <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Factor card ─────────────────────────────────────────────────────────────

function FactorCard({
  label,
  icon,
  factor,
}: {
  label: string;
  icon: React.ReactNode;
  factor: PlacementFactor;
}) {
  const statusBg: Record<FactorStatus, string> = {
    good: "#D8F3DC",
    warning: "#FEF3C7",
    poor: "#FEE2E2",
  };
  const statusText: Record<FactorStatus, string> = {
    good: COLORS.primary,
    warning: "#92400E",
    poor: "#991B1B",
  };

  return (
    <View style={[styles.factorCard, { backgroundColor: statusBg[factor.status] }]}>
      <View style={styles.factorHeader}>
        <View style={styles.factorIconWrap}>{icon}</View>
        <Text style={[styles.factorLabel, { color: statusText[factor.status] }]}>
          {label}
        </Text>
        <Text style={styles.factorStatusEmoji}>{STATUS_EMOJI[factor.status]}</Text>
      </View>
      <Text style={[styles.factorAdvice, { color: statusText[factor.status] }]}>
        {factor.advice}
      </Text>
    </View>
  );
}

// ─── Compass helpers ──────────────────────────────────────────────────────────

/** Convert raw magnetometer x/y to a 0–360 heading (0 = magnetic north). */
function headingFromMagnetometer(x: number, y: number): number {
  let angle = Math.atan2(y, x) * (180 / Math.PI);
  if (angle < 0) angle += 360;
  return angle;
}

function headingToDirection(heading: number): Exclude<WindowDirection, "none"> {
  if (heading >= 315 || heading < 45) return "north";
  if (heading >= 45 && heading < 135) return "east";
  if (heading >= 135 && heading < 225) return "south";
  return "west";
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function PlacementScreen() {
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
  const [windowDirection, setWindowDirection] = useState<WindowDirection>("east");
  const [roomType, setRoomType] = useState<RoomType>("living room");
  const [lightLevel, setLightLevel] = useState<LightLevel>("bright indirect");
  const [slotUris, setSlotUris] = useState<Record<string, string | null>>({});

  // ── Screen state ────────────────────────────────────────────────────────────
  const [screenState, setScreenState] = useState<ScreenState>("form");
  const [primaryUri, setPrimaryUri] = useState<string | null>(null);
  const [result, setResult] = useState<PlacementResult | null>(null);
  const [isViewingExisting, setIsViewingExisting] = useState(false);

  // Jump straight to results when viewing an existing analysis from history
  useEffect(() => {
    if (!existingAnalysis) return;
    try {
      const record = JSON.parse(existingAnalysis as string) as PlacementResult;
      setResult(record);
      setScreenState("results");
      setIsViewingExisting(true);
    } catch {
      // fall back to form
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Compass state ────────────────────────────────────────────────────────────
  // null = availability not yet known; false = unavailable; true = available
  const [compassAvailable, setCompassAvailable] = useState<boolean | null>(null);
  const [showCompassModal, setShowCompassModal] = useState(false);
  const [compassDetected, setCompassDetected] = useState<Exclude<WindowDirection, "none"> | null>(null);
  const [actionBarHeight, setActionBarHeight] = useState(0);
  const compassRotation = useRef(new Animated.Value(0)).current;
  const compassAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  // Check magnetometer availability once on mount
  useEffect(() => {
    Magnetometer.isAvailableAsync()
      .then(setCompassAvailable)
      .catch(() => setCompassAvailable(false));
  }, []);

  // ── Detect window direction with compass ─────────────────────────────────────

  const handleDetectCompass = useCallback(async () => {
    setCompassDetected(null);
    setShowCompassModal(true);

    // Spin the compass arrow while collecting readings
    compassRotation.setValue(0);
    const anim = Animated.loop(
      Animated.timing(compassRotation, {
        toValue: 1,
        duration: 1500,
        useNativeDriver: true,
      })
    );
    compassAnimRef.current = anim;
    anim.start();

    const readings: { x: number; y: number }[] = [];
    Magnetometer.setUpdateInterval(100); // 10 readings/sec

    const subscription = Magnetometer.addListener(({ x, y }) => {
      readings.push({ x, y });
    });

    // Collect for 3 seconds then resolve
    await new Promise<void>((resolve) => setTimeout(resolve, 3000));

    subscription.remove();
    compassAnimRef.current?.stop();
    setShowCompassModal(false);

    if (readings.length === 0) return;

    const avgX = readings.reduce((s, r) => s + r.x, 0) / readings.length;
    const avgY = readings.reduce((s, r) => s + r.y, 0) / readings.length;
    const heading = headingFromMagnetometer(avgX, avgY);
    const detected = headingToDirection(heading);

    setWindowDirection(detected);
    setCompassDetected(detected);

    // Clear confirmation badge after 3 s
    setTimeout(() => setCompassDetected(null), 3000);
  }, [compassRotation]);

  // ── Pick photo for a slot ────────────────────────────────────────────────────

  const handlePickPhoto = useCallback((slotKey: string) => {
    Alert.alert("Add Photo", "Choose a source", [
      {
        text: "Camera",
        onPress: async () => {
          try {
            const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85 });
            if (!result.canceled && result.assets[0]?.uri) {
              setSlotUris((prev) => ({ ...prev, [slotKey]: result.assets[0].uri }));
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
            const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
            if (!result.canceled && result.assets[0]?.uri) {
              setSlotUris((prev) => ({ ...prev, [slotKey]: result.assets[0].uri }));
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

    const filledSlots = PHOTO_SLOTS.filter((s) => slotUris[s.key]);
    const bgUri = filledSlots.length > 0 ? (slotUris[filledSlots[0].key] ?? null) : null;
    setPrimaryUri(bgUri);
    setScreenState("analyzing");

    try {
      // Process all selected photos in parallel
      const photos = await Promise.all(
        filledSlots.map(async (slot) => {
          const uri = slotUris[slot.key]!;
          const filename = `placement_${slot.key}_${Date.now()}.jpg`;
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
        `${supabaseUrl}/functions/v1/placement-advisor`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            plantName: plant.name,
            species: plant.species ?? plant.common_name ?? "Unknown",
            careProfile: plant.care_profile,
            windowDirection,
            roomType,
            lightLevel,
            photos: photos.length > 0 ? photos : undefined,
          }),
        }
      );

      if (!response.ok) {
        const err = await response.json() as { error?: string };
        throw new Error(err.error ?? "Analysis failed");
      }

      const data = await response.json() as PlacementResult;

      // Save to Supabase (best-effort — don't block results on failure)
      if (profile) {
        supabase.from("placement_analyses").insert({
          plant_id: plantId,
          user_id: profile.id,
          overall: data.overall,
          score: data.score,
          light: data.light,
          humidity: data.humidity,
          temperature: data.temperature,
          summary: data.summary,
          tips: data.tips,
          window_direction: windowDirection,
          room_type: roomType,
          light_level: lightLevel,
        }).then(({ error }) => {
          if (error) console.warn("placement: failed to save analysis", error);
        });
      }

      setResult(data);
      setScreenState("results");
    } catch (err) {
      Alert.alert(
        "Analysis Failed",
        err instanceof Error ? err.message : "Something went wrong. Please try again."
      );
      setScreenState("form");
    }
  }, [plant, windowDirection, roomType, lightLevel, slotUris, profile, plantId]);

  const handleRetake = useCallback(() => {
    setResult(null);
    setSlotUris({});
    setPrimaryUri(null);
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
        <Text style={styles.notFoundText}>Plant not found.</Text>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backLink}>← Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // STATE 1 — Form
  // ────────────────────────────────────────────────────────────────────────────

  if (screenState === "form") {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />

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
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => navigation.goBack()}
              accessibilityLabel="Go back"
            >
              <ArrowLeft size={20} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.formTitle}>Check Placement</Text>
          </View>

          {/* Plant preview */}
          <View style={styles.plantPreview}>
            {plant.photo_url ? (
              <Image
                source={{ uri: plant.photo_url }}
                style={styles.plantThumb}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.plantThumb, styles.plantThumbPlaceholder]}>
                <Text style={{ fontSize: 32 }}>🌿</Text>
              </View>
            )}
            <View style={styles.plantPreviewText}>
              <Text style={styles.plantPreviewName}>{plant.name}</Text>
              {plant.species ? (
                <Text style={styles.plantPreviewSpecies}>{plant.species}</Text>
              ) : null}
            </View>
          </View>

          {/* ── Window direction ─────────────────────────────────────────── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Nearest window direction</Text>
              {compassAvailable && (
                <TouchableOpacity
                  style={styles.detectButton}
                  onPress={handleDetectCompass}
                  accessibilityLabel="Detect window direction with compass"
                  accessibilityRole="button"
                >
                  <Text style={styles.detectButtonText}>🧭 Detect</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.pillRow}>
              {WINDOW_OPTIONS.map((opt) => (
                <PillOption
                  key={opt.value}
                  label={opt.label}
                  value={opt.value}
                  selected={windowDirection === opt.value}
                  onPress={setWindowDirection}
                  prefix={opt.emoji}
                />
              ))}
            </View>
            {compassDetected && (
              <Text style={styles.detectedConfirm}>
                Detected: {compassDetected.charAt(0).toUpperCase() + compassDetected.slice(1)} ✅
              </Text>
            )}
          </View>

          {/* ── Room type ────────────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Room type</Text>
            <View style={styles.pillGrid}>
              {ROOM_OPTIONS.map((opt) => (
                <PillOption
                  key={opt.value}
                  label={`${opt.emoji} ${opt.label}`}
                  value={opt.value}
                  selected={roomType === opt.value}
                  onPress={setRoomType}
                />
              ))}
            </View>
          </View>

          {/* ── Light level ──────────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Light level in this spot</Text>
            {LIGHT_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.lightOption, lightLevel === opt.value && styles.lightOptionSelected]}
                onPress={() => setLightLevel(opt.value)}
                accessibilityLabel={opt.label}
                accessibilityRole="radio"
                accessibilityState={{ selected: lightLevel === opt.value }}
              >
                <View style={styles.lightOptionLeft}>
                  <View
                    style={[
                      styles.lightRadio,
                      lightLevel === opt.value && styles.lightRadioSelected,
                    ]}
                  />
                  <View>
                    <Text
                      style={[
                        styles.lightOptionLabel,
                        lightLevel === opt.value && styles.lightOptionLabelSelected,
                      ]}
                    >
                      {opt.label}
                    </Text>
                    <Text style={styles.lightOptionDesc}>{opt.desc}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── Photos (optional) ─────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Photos (optional)</Text>
            <Text style={styles.sectionSubtitle}>Add photos for better assessment — tap any slot to add</Text>
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

        {/* ── Compass detection modal ───────────────────────────────────── */}
        <Modal
          visible={showCompassModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowCompassModal(false)}
        >
          <View style={styles.compassModalBackdrop}>
            <View style={styles.compassModalSheet}>
              <Animated.Text
                style={[
                  styles.compassArrow,
                  {
                    transform: [
                      {
                        rotate: compassRotation.interpolate({
                          inputRange: [0, 1],
                          outputRange: ["0deg", "360deg"],
                        }),
                      },
                    ],
                  },
                ]}
              >
                ↑
              </Animated.Text>
              <Text style={styles.compassTitle}>Point your phone at the window</Text>
              <Text style={styles.compassSubtitle}>
                Hold steady for 3 seconds while facing the window
              </Text>
            </View>
          </View>
        </Modal>

        {/* ── Analyze button ─────────────────────────────────────────────── */}
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]} onLayout={(e) => setActionBarHeight(e.nativeEvent.layout.height)}>
          <TouchableOpacity
            style={styles.analyzeButton}
            onPress={handleAnalyze}
            accessibilityLabel="Analyze plant placement"
            accessibilityRole="button"
            activeOpacity={0.85}
          >
            <Text style={styles.analyzeButtonText}>
              {(() => {
                const n = PHOTO_SLOTS.filter((s) => slotUris[s.key]).length;
                return n > 0 ? `Analyze Placement (${n} photo${n > 1 ? "s" : ""})` : "Analyze Placement";
              })()}
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
      <View style={[styles.screen, styles.analyzingScreen]}>
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
          <Text style={styles.analyzingTitle}>Analyzing placement conditions...</Text>
          <Text style={styles.analyzingSubtitle}>
            Checking light, humidity, and temperature
          </Text>
        </View>
      </View>
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // STATE 3 — Results
  // ────────────────────────────────────────────────────────────────────────────

  if (!result) return null;

  const overallBg = OVERALL_BG[result.overall];
  const overallTextColor = OVERALL_TEXT[result.overall];

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
        <TouchableOpacity
          style={styles.resultsBack}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={20} color={COLORS.textPrimary} />
        </TouchableOpacity>

        {/* ── Overall verdict banner ─────────────────────────────────────── */}
        <View style={[styles.card, styles.overallCard, { backgroundColor: overallBg }]}>
          <View style={styles.overallRow}>
            <View style={styles.scoreCircle}>
              <Text style={[styles.scoreValue, { color: overallTextColor }]}>
                {result.score}
              </Text>
              <Text style={[styles.scoreLabel, { color: overallTextColor }]}>/100</Text>
            </View>
            <View style={styles.overallText}>
              <Text style={[styles.overallVerdict, { color: overallTextColor }]}>
                {OVERALL_LABEL[result.overall]}
              </Text>
              <Text style={[styles.overallSummary, { color: overallTextColor }]}>
                {result.summary}
              </Text>
            </View>
          </View>
        </View>

        {/* ── Factor cards ──────────────────────────────────────────────── */}
        <FactorCard
          label="Light"
          icon={<Sun size={18} color={OVERALL_TEXT[result.light.status]} />}
          factor={result.light}
        />
        <FactorCard
          label="Humidity"
          icon={<Droplets size={18} color={OVERALL_TEXT[result.humidity.status]} />}
          factor={result.humidity}
        />
        <FactorCard
          label="Temperature"
          icon={<Thermometer size={18} color={OVERALL_TEXT[result.temperature.status]} />}
          factor={result.temperature}
        />

        {/* ── Tips ─────────────────────────────────────────────────────── */}
        {result.tips.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Tips to improve this spot</Text>
            {result.tips.map((tip, i) => (
              <View key={i} style={styles.tipRow}>
                <Text style={styles.tipBullet}>💡</Text>
                <Text style={styles.tipText}>{tip}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* ── Fixed action bar ──────────────────────────────────────────── */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]} onLayout={(e) => setActionBarHeight(e.nativeEvent.layout.height)}>
        <TouchableOpacity
          style={styles.retakeButton}
          onPress={handleRetake}
          accessibilityLabel={isViewingExisting ? "Run a new analysis" : "Change conditions and re-analyze"}
          accessibilityRole="button"
        >
          <RefreshCw size={18} color={COLORS.primary} />
          <Text style={styles.retakeButtonText}>
            {isViewingExisting ? "New Analysis" : "Change conditions"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.doneButton}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Done, go back"
          accessibilityRole="button"
        >
          <Text style={styles.doneButtonText}>Done ✓</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.cream,
  },
  scroll: {
    flex: 1,
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

  // ── Form ───────────────────────────────────────────────────────────────────
  formContent: {
    paddingHorizontal: 16,
    gap: 0,
  },
  formHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  formTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  plantPreview: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 14,
    gap: 14,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  plantThumb: {
    width: 56,
    height: 56,
    borderRadius: 14,
  },
  plantThumbPlaceholder: {
    backgroundColor: COLORS.lightgreen,
    alignItems: "center",
    justifyContent: "center",
  },
  plantPreviewText: {
    flex: 1,
  },
  plantPreviewName: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  plantPreviewSpecies: {
    fontSize: 13,
    fontStyle: "italic",
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 10,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: -6,
    marginBottom: 10,
  },

  // ── Pills ──────────────────────────────────────────────────────────────────
  pillRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  pillGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
  },
  pillSelected: {
    backgroundColor: COLORS.lightgreen,
    borderColor: COLORS.secondary,
  },
  pillPrefix: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textSecondary,
  },
  pillText: {
    fontSize: 13,
    fontWeight: "500",
    color: COLORS.textSecondary,
  },
  pillTextSelected: {
    color: COLORS.primary,
    fontWeight: "700",
  },

  // ── Light level ────────────────────────────────────────────────────────────
  lightOption: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
  },
  lightOptionSelected: {
    backgroundColor: COLORS.lightgreen,
    borderColor: COLORS.secondary,
  },
  lightOptionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  lightRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: "#D1D5DB",
  },
  lightRadioSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary,
  },
  lightOptionLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textPrimary,
  },
  lightOptionLabelSelected: {
    color: COLORS.primary,
  },
  lightOptionDesc: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 1,
  },

  // ── Photo slots ────────────────────────────────────────────────────────────
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

  // ── Bottom bar ─────────────────────────────────────────────────────────────
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    paddingTop: 12,
    paddingHorizontal: 16,
    gap: 10,
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: COLORS.cream,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 8,
  },
  analyzeButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    paddingVertical: 16,
  },
  analyzeButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
  retakeButton: {
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
  retakeButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.primary,
  },
  doneButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    paddingVertical: 16,
  },
  doneButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },

  // ── Analyzing ──────────────────────────────────────────────────────────────
  analyzingScreen: {
    backgroundColor: "#000",
  },
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
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 14,
  },
  overallCard: {
    shadowOpacity: 0,
    elevation: 0,
  },
  overallRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  scoreCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(255,255,255,0.5)",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    alignContent: "flex-end",
  },
  scoreValue: {
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 32,
  },
  scoreLabel: {
    fontSize: 12,
    fontWeight: "600",
    alignSelf: "flex-end",
    marginBottom: 3,
  },
  overallText: {
    flex: 1,
    gap: 4,
  },
  overallVerdict: {
    fontSize: 18,
    fontWeight: "800",
  },
  overallSummary: {
    fontSize: 13,
    lineHeight: 19,
    opacity: 0.85,
  },

  // ── Factor card ────────────────────────────────────────────────────────────
  factorCard: {
    borderRadius: 20,
    padding: 16,
    gap: 8,
  },
  factorHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  factorIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  factorLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
  },
  factorStatusEmoji: {
    fontSize: 16,
  },
  factorAdvice: {
    fontSize: 13,
    lineHeight: 20,
    opacity: 0.85,
  },

  // ── Tips ───────────────────────────────────────────────────────────────────
  tipRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  tipBullet: {
    fontSize: 14,
    lineHeight: 22,
  },
  tipText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 22,
  },

  // ── Compass ────────────────────────────────────────────────────────────────
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  detectButton: {
    backgroundColor: COLORS.lightgreen,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: COLORS.secondary,
  },
  detectButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.primary,
  },
  detectedConfirm: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.primary,
    marginTop: 8,
  },
  compassModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  compassModalSheet: {
    backgroundColor: "#fff",
    borderRadius: 24,
    paddingVertical: 36,
    paddingHorizontal: 32,
    alignItems: "center",
    width: 280,
    gap: 12,
  },
  compassArrow: {
    fontSize: 64,
    lineHeight: 72,
    color: COLORS.primary,
  },
  compassTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: COLORS.textPrimary,
    textAlign: "center",
  },
  compassSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 19,
  },
});

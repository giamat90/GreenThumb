import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
} from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  Animated,
  Alert,
  Dimensions,
  StatusBar,
  Image,
  ActivityIndicator,
  Linking,
  type GestureResponderEvent,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { CameraView } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  X,
  Zap,
  ZapOff,
  AlertCircle,
  Leaf,
  ChevronLeft,
} from "lucide-react-native";

import { useTranslation } from "react-i18next";

import { COLORS } from "@/constants";
import { useCamera } from "@/hooks/useCamera";
import { useIdentificationLimit } from "@/hooks/useIdentificationLimit";
import { compressImage } from "@/lib/imageUtils";
import { identifyPlant } from "@/lib/plantid";
import type { IdentificationResult, PlantSuggestion } from "@/lib/plantid";
import { deviceLanguage } from "@/lib/i18n";
import { usePlantsStore } from "@/store/plants";
import { useUserStore } from "@/store/user";
import { supabase } from "@/lib/supabase";
import { invalidateSeasonalTipsCache } from "@/lib/seasonalTips";
import * as FileSystem from "expo-file-system/legacy";
import type { PlantLocation, PotSize, Plant } from "@/types";

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const VIEWFINDER_SIZE = Math.floor(SCREEN_WIDTH * 0.75);

const CONFIDENCE = {
  HIGH: 0.70,
  MEDIUM: 0.40,
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

type ScreenState = "source" | "camera" | "loading" | "results";


function calculateNextWatering(
  watering: "frequent" | "average" | "minimum"
): string {
  const daysMap = { frequent: 2, average: 5, minimum: 10 } as const;
  const days = daysMap[watering];
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Semi-transparent viewfinder overlay — 4 panels + green corner brackets + hint text. */
function ViewfinderOverlay() {
  const { t } = useTranslation();
  const sideMargin = (SCREEN_WIDTH - VIEWFINDER_SIZE) / 2;
  // Position the viewfinder slightly above center for ergonomics
  const topOffset = (SCREEN_HEIGHT - VIEWFINDER_SIZE) / 2 - 60;
  const CORNER = 28;
  const BORDER = 3;

  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
    >
      {/* Top panel */}
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: topOffset,
          backgroundColor: "rgba(0,0,0,0.55)",
        }}
      />
      {/* Bottom panel */}
      <View
        style={{
          position: "absolute",
          top: topOffset + VIEWFINDER_SIZE,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0,0,0,0.55)",
        }}
      />
      {/* Left panel */}
      <View
        style={{
          position: "absolute",
          top: topOffset,
          left: 0,
          width: sideMargin,
          height: VIEWFINDER_SIZE,
          backgroundColor: "rgba(0,0,0,0.55)",
        }}
      />
      {/* Right panel */}
      <View
        style={{
          position: "absolute",
          top: topOffset,
          right: 0,
          width: sideMargin,
          height: VIEWFINDER_SIZE,
          backgroundColor: "rgba(0,0,0,0.55)",
        }}
      />

      {/* Corner brackets */}
      <View
        style={{
          position: "absolute",
          top: topOffset,
          left: sideMargin,
          width: VIEWFINDER_SIZE,
          height: VIEWFINDER_SIZE,
        }}
      >
        {/* Top-left */}
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: CORNER,
            height: CORNER,
            borderTopWidth: BORDER,
            borderLeftWidth: BORDER,
            borderColor: COLORS.primary,
            borderTopLeftRadius: 16,
          }}
        />
        {/* Top-right */}
        <View
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: CORNER,
            height: CORNER,
            borderTopWidth: BORDER,
            borderRightWidth: BORDER,
            borderColor: COLORS.primary,
            borderTopRightRadius: 16,
          }}
        />
        {/* Bottom-left */}
        <View
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            width: CORNER,
            height: CORNER,
            borderBottomWidth: BORDER,
            borderLeftWidth: BORDER,
            borderColor: COLORS.primary,
            borderBottomLeftRadius: 16,
          }}
        />
        {/* Bottom-right */}
        <View
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            width: CORNER,
            height: CORNER,
            borderBottomWidth: BORDER,
            borderRightWidth: BORDER,
            borderColor: COLORS.primary,
            borderBottomRightRadius: 16,
          }}
        />
      </View>

      {/* Hint text below frame */}
      <View
        style={{
          position: "absolute",
          top: topOffset + VIEWFINDER_SIZE + 16,
          left: sideMargin,
          right: sideMargin,
          alignItems: "center",
        }}
      >
        <Text
          style={{
            color: "white",
            fontSize: 14,
            fontWeight: "500",
            textAlign: "center",
            textShadowColor: "rgba(0,0,0,0.6)",
            textShadowOffset: { width: 0, height: 1 },
            textShadowRadius: 3,
          }}
        >
          {t("identify.frameGuide")}
        </Text>
        <Text
          style={{
            color: "rgba(255,255,255,0.65)",
            fontSize: 12,
            textAlign: "center",
            marginTop: 4,
          }}
        >
          {t("identify.holdSteady")}
        </Text>
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function IdentifyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const spinAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  const { hasPermission, requestPermission } = useCamera();
  const { canIdentify, isLoading: limitLoading } = useIdentificationLimit();
  const { addPlant } = usePlantsStore();
  const { profile } = useUserStore();

  const [screenState, setScreenState] = useState<ScreenState>("source");
  const [isFlashOn, setIsFlashOn] = useState(false);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [identificationResult, setIdentificationResult] =
    useState<IdentificationResult | null>(null);

  // Paywall modal state
  const [showPaywallModal, setShowPaywallModal] = useState(false);

  // Add-plant bottom sheet state
  const [showAddModal, setShowAddModal] = useState(false);
  const [plantNickname, setPlantNickname] = useState("");
  const [selectedPotSize, setSelectedPotSize] = useState<PotSize>("medium");
  const [selectedLocation, setSelectedLocation] =
    useState<PlantLocation>("indoor");
  const [isSaving, setIsSaving] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [isManualAdd, setIsManualAdd] = useState(false);
  const [manualSpecies, setManualSpecies] = useState("");

  // Show paywall when limit check completes and user is over quota
  useEffect(() => {
    if (!limitLoading && !canIdentify) {
      setShowPaywallModal(true);
    }
  }, [limitLoading, canIdentify]);

  // Spin animation for the loading leaf icon
  useEffect(() => {
    if (screenState === "loading") {
      spinAnim.setValue(0);
      const loop = Animated.loop(
        Animated.timing(spinAnim, {
          toValue: 1,
          duration: 1400,
          useNativeDriver: true,
        })
      );
      loop.start();
      return () => loop.stop();
    }
  }, [screenState, spinAnim]);

  const openAddModal = useCallback(
    (topSuggestion: PlantSuggestion) => {
      setIsManualAdd(false);
      const name = topSuggestion.commonNames[0] ?? topSuggestion.name;
      setPlantNickname(name);
      setShowAddModal(true);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    },
    [slideAnim]
  );

  const closeAddModal = useCallback(() => {
    Animated.timing(slideAnim, {
      toValue: SCREEN_HEIGHT,
      duration: 260,
      useNativeDriver: true,
    }).start(() => {
      setShowAddModal(false);
      setIsManualAdd(false);
    });
  }, [slideAnim]);

  const handleManualAdd = useCallback(() => {
    setIsManualAdd(true);
    setPlantNickname("");
    setManualSpecies("");
    setShowAddModal(true);
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
  }, [slideAnim]);

  const handleTakePhoto = useCallback(async () => {
    if (!hasPermission) {
      const result = await requestPermission();
      if (!result.granted) return;
    }
    setScreenState("camera");
  }, [hasPermission, requestPermission]);

  const handleGalleryPick = useCallback(async () => {
    if (!canIdentify && !limitLoading) {
      setShowPaywallModal(true);
      return;
    }

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        t("identify.galleryPermissionTitle"),
        t("identify.galleryPermissionMessage"),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("identify.openSettings"),
            onPress: () => Linking.openSettings(),
          },
        ]
      );
      return;
    }

    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 1,
    });

    if (pickerResult.canceled || !pickerResult.assets[0]) return;

    const asset = pickerResult.assets[0];
    setCapturedUri(asset.uri);
    setScreenState("loading");

    try {
      let base64Image: string;
      try {
        base64Image = await compressImage(asset.uri);
      } catch {
        base64Image = await FileSystem.readAsStringAsync(asset.uri, {
          encoding: "base64",
        });
      }

      if (!base64Image) throw new Error("Could not encode image.");

      const identResult = await identifyPlant(base64Image, deviceLanguage());
      setIdentificationResult(identResult);
      setScreenState("results");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("common.somethingWentWrong");
      Alert.alert(t("identify.identificationFailed"), message);
      setScreenState("source");
    }
  }, [canIdentify, limitLoading, t]);

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current) return;

    // Double-check limit at capture time (in case modal was dismissed)
    if (!canIdentify && !limitLoading) {
      setShowPaywallModal(true);
      return;
    }

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        base64: true, // fallback if image-manipulator isn't installed
      });

      if (!photo) return;

      setCapturedUri(photo.uri);
      setScreenState("loading");

      // Attempt resize+compress; fall back to camera's own base64
      let base64Image: string;
      try {
        base64Image = await compressImage(photo.uri);
      } catch {
        // expo-image-manipulator might not be installed yet — fall back gracefully
        base64Image = photo.base64 ?? "";
      }

      if (!base64Image) throw new Error("Could not encode image.");

      const result = await identifyPlant(base64Image, deviceLanguage());
      setIdentificationResult(result);
      setScreenState("results");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("common.somethingWentWrong");
      Alert.alert(t("identify.identificationFailed"), message);
      setScreenState("camera");
    }
  }, [canIdentify, limitLoading, t]);

  const handleTryAgain = useCallback(() => {
    setScreenState("source");
    setCapturedUri(null);
    setIdentificationResult(null);
    setSelectedSuggestionIndex(0);
  }, []);

  const handleSavePlant = useCallback(async () => {
    if (!capturedUri || !identificationResult || !profile) return;

    const topSuggestion = isManualAdd
      ? null
      : (identificationResult.suggestions[selectedSuggestionIndex] ??
          identificationResult.suggestions[0]);
    if (!isManualAdd && !topSuggestion) return;

    setIsSaving(true);
    console.log("Supabase URL:", process.env.EXPO_PUBLIC_SUPABASE_URL);
    try {
      const plantId = generateUUID();
      const filePath = `${profile.id}/${plantId}.jpg`;

      // Upload photo to Supabase Storage
      let photoUrl: string;
      try {
        console.log("Starting photo upload...");
        console.log("Storage bucket: plant-photos");
        console.log("Upload path:", filePath);

        const base64 = await FileSystem.readAsStringAsync(capturedUri, {
          encoding: "base64",
        });
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const { error: uploadError } = await supabase.storage
          .from("plant-photos")
          .upload(filePath, bytes, { contentType: "image/jpeg", upsert: false });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from("plant-photos")
          .getPublicUrl(filePath);
        photoUrl = urlData.publicUrl;
      } catch (error) {
        console.error("Photo upload failed:", (error as Error).message);
        throw error;
      }

      // Calculate next watering from care profile
      const watering = topSuggestion?.careProfile.watering ?? "average";
      const nextWatering = calculateNextWatering(watering);

      const finalName =
        plantNickname.trim() ||
        (!isManualAdd
          ? topSuggestion?.commonNames[0] ?? topSuggestion?.name ?? ""
          : "");

      const newPlantData = {
        id: plantId,
        user_id: profile.id,
        name: finalName,
        species: isManualAdd
          ? manualSpecies.trim() || null
          : topSuggestion?.name ?? null,
        common_name: isManualAdd ? null : topSuggestion?.commonNames[0] ?? null,
        photo_url: photoUrl,
        pot_size: selectedPotSize,
        location: selectedLocation,
        soil_type: null,
        last_watered_at: null,
        next_watering: nextWatering,
        health_score: 100,
        care_profile: {
          watering: watering,
          light: topSuggestion?.careProfile.light ?? "indirect light",
          soilType: topSuggestion?.careProfile.soilType ?? "well-draining",
        },
        notes: null,
      };

      // Insert plant row into database
      let savedPlant: unknown;
      try {
        console.log("Starting database insert...");
        const { data, error: insertError } = await supabase
          .from("plants")
          .insert(newPlantData)
          .select()
          .single();

        if (insertError) throw insertError;
        savedPlant = data;
      } catch (error) {
        console.error("Database insert failed:", (error as Error).message);
        throw error;
      }

      addPlant(savedPlant as Plant);
      // Invalidate seasonal tips cache so the next home screen load
      // re-fetches tips tailored to the updated plant set.
      if (profile?.id) {
        await invalidateSeasonalTipsCache(profile.id);
      }
      closeAddModal();

      Alert.alert(
        t("identify.plantAdded"),
        t("identify.plantAddedMessage", { name: finalName }),
        [
          {
            text: t("identify.viewMyPlants"),
            onPress: () => router.replace("/(tabs)/my-plants"),
          },
        ]
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("common.somethingWentWrong");
      Alert.alert(t("identify.saveFailed"), message);
    } finally {
      setIsSaving(false);
    }
  }, [
    capturedUri,
    identificationResult,
    profile,
    plantNickname,
    selectedPotSize,
    selectedLocation,
    selectedSuggestionIndex,
    isManualAdd,
    manualSpecies,
    addPlant,
    closeAddModal,
    router,
    t,
  ]);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  // ── Loading gate (limit check) ──────────────────────────────────────────────
  if (limitLoading) {
    return (
      <View
        style={{ flex: 1, backgroundColor: "black", alignItems: "center", justifyContent: "center" }}
      >
        <StatusBar barStyle="light-content" />
        <ActivityIndicator color="white" size="large" />
      </View>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: "black" }}>
      <StatusBar barStyle="light-content" />

      {/* ── State 0: Source choice ── */}
      {screenState === "source" && (
        <View style={{ flex: 1, backgroundColor: COLORS.cream }}>
          <StatusBar barStyle="dark-content" />

          {/* Close button */}
          <TouchableOpacity
            onPress={() => router.back()}
            style={{
              position: "absolute",
              top: insets.top + 12,
              right: 20,
              zIndex: 10,
              backgroundColor: "#F3F4F6",
              borderRadius: 999,
              padding: 8,
            }}
            accessibilityLabel="Close"
          >
            <X size={22} color={COLORS.textSecondary} />
          </TouchableOpacity>

          {/* Centered content */}
          <View
            style={{
              flex: 1,
              justifyContent: "center",
              paddingHorizontal: 28,
            }}
          >
            <Text
              style={{
                fontSize: 28,
                fontWeight: "700",
                color: COLORS.primary,
                textAlign: "center",
                marginBottom: 10,
              }}
            >
              {t("identify.chooseSource")}
            </Text>
            <Text
              style={{
                fontSize: 15,
                color: COLORS.textSecondary,
                textAlign: "center",
                marginBottom: 40,
                lineHeight: 22,
              }}
            >
              {t("identify.sourceSubtitle")}
            </Text>

            {/* Take a photo card */}
            <TouchableOpacity
              onPress={handleTakePhoto}
              style={{
                backgroundColor: COLORS.primary,
                borderRadius: 24,
                paddingVertical: 36,
                alignItems: "center",
                marginBottom: 16,
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.12,
                shadowRadius: 12,
                elevation: 4,
              }}
              accessibilityLabel={t("identify.takePhoto")}
            >
              <Text style={{ fontSize: 44, marginBottom: 12 }}>📷</Text>
              <Text
                style={{ fontSize: 18, fontWeight: "700", color: "white" }}
              >
                {t("identify.takePhoto")}
              </Text>
            </TouchableOpacity>

            {/* Choose from gallery card */}
            <TouchableOpacity
              onPress={handleGalleryPick}
              style={{
                backgroundColor: "white",
                borderRadius: 24,
                paddingVertical: 36,
                alignItems: "center",
                borderWidth: 2,
                borderColor: COLORS.primary,
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.06,
                shadowRadius: 8,
                elevation: 2,
              }}
              accessibilityLabel={t("identify.chooseFromGallery")}
            >
              <Text style={{ fontSize: 44, marginBottom: 12 }}>🖼️</Text>
              <Text
                style={{
                  fontSize: 18,
                  fontWeight: "700",
                  color: COLORS.primary,
                }}
              >
                {t("identify.chooseFromGallery")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── State 1: Camera ── */}
      {screenState === "camera" && !hasPermission && (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: COLORS.cream,
            paddingHorizontal: 32,
          }}
        >
          <StatusBar barStyle="dark-content" />
          <View
            style={{
              backgroundColor: COLORS.lightgreen,
              borderRadius: 999,
              padding: 24,
              marginBottom: 24,
            }}
          >
            <Leaf size={40} color={COLORS.primary} />
          </View>
          <Text
            style={{
              fontSize: 22,
              fontWeight: "700",
              color: COLORS.primary,
              textAlign: "center",
              marginBottom: 12,
            }}
          >
            {t("identify.cameraAccessNeeded")}
          </Text>
          <Text
            style={{
              fontSize: 15,
              color: COLORS.textSecondary,
              textAlign: "center",
              marginBottom: 32,
              lineHeight: 22,
            }}
          >
            {t("identify.cameraAccessDescription")}
          </Text>
          <TouchableOpacity
            onPress={requestPermission}
            style={{
              backgroundColor: COLORS.primary,
              borderRadius: 18,
              paddingHorizontal: 32,
              paddingVertical: 14,
            }}
            accessibilityLabel={t("identify.allowCamera")}
          >
            <Text style={{ color: "white", fontWeight: "600", fontSize: 16 }}>
              {t("identify.allowCamera")}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {screenState === "camera" && hasPermission && (
        <>
          <CameraView
            ref={cameraRef}
            style={{ flex: 1 }}
            facing="back"
            flash={isFlashOn ? "on" : "off"}
          />

          {/* Viewfinder overlay */}
          <ViewfinderOverlay />

          {/* Top bar: back + flash */}
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 20,
              paddingTop: insets.top + 12,
            }}
          >
            <TouchableOpacity
              onPress={() => setScreenState("source")}
              style={{
                backgroundColor: "rgba(0,0,0,0.4)",
                borderRadius: 999,
                padding: 8,
              }}
              accessibilityLabel="Go back"
            >
              <X size={24} color="white" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setIsFlashOn((prev) => !prev)}
              style={{
                backgroundColor: "rgba(0,0,0,0.4)",
                borderRadius: 999,
                padding: 8,
              }}
              accessibilityLabel={isFlashOn ? "Turn off flash" : "Turn on flash"}
            >
              {isFlashOn ? (
                <Zap size={22} color="#FFD700" />
              ) : (
                <ZapOff size={22} color="white" />
              )}
            </TouchableOpacity>
          </View>

          {/* Bottom bar: hint + capture button */}
          <View
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              alignItems: "center",
              paddingBottom: insets.bottom + 28,
            }}
          >
            <Text
              style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, marginBottom: 20 }}
            >
              {t("identify.centerInFrame")}
            </Text>

            {/* Capture button — outer ring + inner fill */}
            <TouchableOpacity
              onPress={handleCapture}
              accessibilityLabel="Take photo to identify plant"
              style={{
                width: 76,
                height: 76,
                borderRadius: 38,
                backgroundColor: "white",
                borderWidth: 4,
                borderColor: COLORS.primary,
                alignItems: "center",
                justifyContent: "center",
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 3 },
                shadowOpacity: 0.35,
                shadowRadius: 6,
                elevation: 8,
              }}
            >
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  backgroundColor: COLORS.primary,
                }}
              />
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* ── State 2: Loading / Analyzing ── */}
      {screenState === "loading" && capturedUri && (
        <View style={{ flex: 1 }}>
          <Image
            source={{ uri: capturedUri }}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
            resizeMode="cover"
          />
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0,0,0,0.62)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <View
              style={{
                backgroundColor: "rgba(255,255,255,0.12)",
                borderRadius: 24,
                paddingHorizontal: 36,
                paddingVertical: 36,
                alignItems: "center",
                marginHorizontal: 32,
              }}
            >
              <Animated.View
                style={{ transform: [{ rotate: spin }], marginBottom: 18 }}
              >
                <Leaf size={52} color="white" />
              </Animated.View>
              <Text
                style={{
                  color: "white",
                  fontSize: 20,
                  fontWeight: "600",
                  marginBottom: 6,
                  textAlign: "center",
                }}
              >
                {t("identify.identifyingPlant")}
              </Text>
              <Text
                style={{ color: "rgba(255,255,255,0.65)", fontSize: 14, textAlign: "center" }}
              >
                {t("identify.takesAMoment")}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* ── State 3: Results ── */}
      {screenState === "results" && identificationResult && (
        <View style={{ flex: 1, backgroundColor: COLORS.cream }}>
          {/* Back button */}
          <TouchableOpacity
            onPress={handleTryAgain}
            style={{
              position: "absolute",
              top: insets.top + 10,
              left: 16,
              zIndex: 10,
              backgroundColor: "rgba(0,0,0,0.3)",
              borderRadius: 999,
              padding: 8,
            }}
            accessibilityLabel="Go back to camera"
          >
            <ChevronLeft size={24} color="white" />
          </TouchableOpacity>

          {/* Not a plant */}
          {!identificationResult.isPlant ? (
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 32,
              }}
            >
              <AlertCircle size={64} color={COLORS.warning} />
              <Text
                style={{
                  fontSize: 22,
                  fontWeight: "700",
                  color: COLORS.primary,
                  textAlign: "center",
                  marginTop: 20,
                  marginBottom: 10,
                }}
              >
                {t("identify.noPlantFound")}
              </Text>
              <Text
                style={{
                  fontSize: 15,
                  color: COLORS.textSecondary,
                  textAlign: "center",
                  marginBottom: 36,
                  lineHeight: 22,
                }}
              >
                {t("identify.noPlantFoundHint")}
              </Text>
              <TouchableOpacity
                onPress={handleTryAgain}
                style={{
                  backgroundColor: COLORS.primary,
                  borderRadius: 16,
                  paddingHorizontal: 32,
                  paddingVertical: 14,
                }}
                accessibilityLabel={t("identify.tryAgain")}
              >
                <Text style={{ color: "white", fontWeight: "600", fontSize: 16 }}>
                  {t("identify.tryAgain")}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (() => {
            const activeSuggestion =
              identificationResult.suggestions[selectedSuggestionIndex] ??
              identificationResult.suggestions[0];
            if (!activeSuggestion) return null;
            const prob = activeSuggestion.probability;

            // LOW confidence — failure screen
            if (prob < CONFIDENCE.MEDIUM) {
              return (
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ flexGrow: 1 }}
                >
                  <View
                    style={{
                      flex: 1,
                      alignItems: "center",
                      justifyContent: "center",
                      paddingHorizontal: 32,
                      paddingTop: 80,
                      paddingBottom: 40,
                    }}
                  >
                    <Text style={{ fontSize: 64, marginBottom: 20 }}>🔍</Text>
                    <Text
                      style={{
                        fontSize: 22,
                        fontWeight: "700",
                        color: COLORS.primary,
                        textAlign: "center",
                        marginBottom: 10,
                      }}
                    >
                      {t("identify.lowConfidence")}
                    </Text>
                    <Text
                      style={{
                        fontSize: 15,
                        color: COLORS.textSecondary,
                        textAlign: "center",
                        marginBottom: 32,
                        lineHeight: 22,
                      }}
                    >
                      {t("identify.lowConfidenceSubtitle")}
                    </Text>

                    {/* Photo tips card */}
                    <View
                      style={{
                        backgroundColor: "white",
                        borderRadius: 20,
                        padding: 20,
                        width: "100%",
                        marginBottom: 28,
                        shadowColor: "#000",
                        shadowOffset: { width: 0, height: 1 },
                        shadowOpacity: 0.05,
                        shadowRadius: 4,
                        elevation: 2,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 15,
                          fontWeight: "700",
                          color: COLORS.primary,
                          marginBottom: 16,
                        }}
                      >
                        {t("identify.photoTipsTitle")}
                      </Text>
                      {(
                        [
                          { emoji: "📸", tipKey: "identify.photoTip1" },
                          { emoji: "💡", tipKey: "identify.photoTip2" },
                          { emoji: "🍃", tipKey: "identify.photoTip3" },
                          { emoji: "🔍", tipKey: "identify.photoTip4" },
                        ] as { emoji: string; tipKey: string }[]
                      ).map(({ emoji, tipKey }) => (
                        <View
                          key={tipKey}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            marginBottom: 12,
                          }}
                        >
                          <Text style={{ fontSize: 18, marginRight: 12 }}>
                            {emoji}
                          </Text>
                          <Text
                            style={{
                              fontSize: 14,
                              color: COLORS.textPrimary,
                              flex: 1,
                            }}
                          >
                            {t(tipKey)}
                          </Text>
                        </View>
                      ))}
                    </View>

                    {/* Try Again button */}
                    <TouchableOpacity
                      onPress={handleTryAgain}
                      style={{
                        backgroundColor: COLORS.primary,
                        borderRadius: 18,
                        paddingVertical: 16,
                        alignItems: "center",
                        width: "100%",
                        marginBottom: 16,
                      }}
                      accessibilityLabel={t("identify.tryAgain")}
                    >
                      <Text
                        style={{ color: "white", fontWeight: "600", fontSize: 16 }}
                      >
                        {t("identify.tryAgain")}
                      </Text>
                    </TouchableOpacity>

                    {/* Add manually link */}
                    <TouchableOpacity
                      onPress={handleManualAdd}
                      style={{ paddingVertical: 12, alignItems: "center" }}
                      accessibilityLabel={t("identify.addManually")}
                    >
                      <Text
                        style={{
                          color: COLORS.primary,
                          fontWeight: "500",
                          fontSize: 15,
                        }}
                      >
                        {t("identify.addManually")}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              );
            }

            // MEDIUM or HIGH confidence — show result
            return (
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 40 }}
              >
                {/* Captured photo */}
                {capturedUri && (
                  <Image
                    source={{ uri: capturedUri }}
                    style={{ width: SCREEN_WIDTH, height: 240 }}
                    resizeMode="cover"
                  />
                )}

                <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
                  {/* MEDIUM confidence: amber warning banner */}
                  {prob < CONFIDENCE.HIGH && (
                    <View
                      style={{
                        backgroundColor: "#FFF8E1",
                        borderWidth: 1,
                        borderColor: "#F57C00",
                        borderRadius: 16,
                        padding: 16,
                        marginBottom: 16,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 15,
                          fontWeight: "700",
                          color: "#F57C00",
                          marginBottom: 4,
                        }}
                      >
                        {"⚠️ " + t("identify.mediumConfidence")}
                      </Text>
                      <Text
                        style={{
                          fontSize: 13,
                          color: "#E65100",
                          lineHeight: 20,
                        }}
                      >
                        {t("identify.confidenceWarning")}
                      </Text>
                    </View>
                  )}

                  {/* Plant name + confidence */}
                  <View style={{ alignItems: "center", marginBottom: 20 }}>
                    {/* HIGH confidence: green title badge */}
                    {prob >= CONFIDENCE.HIGH && (
                      <View
                        style={{
                          backgroundColor: "#D1FAE5",
                          paddingHorizontal: 16,
                          paddingVertical: 6,
                          borderRadius: 999,
                          marginBottom: 12,
                        }}
                      >
                        <Text
                          style={{
                            color: COLORS.success,
                            fontWeight: "600",
                            fontSize: 13,
                          }}
                        >
                          {t("identify.highConfidence")}
                        </Text>
                      </View>
                    )}

                    <Text
                      style={{
                        fontSize: 28,
                        fontWeight: "700",
                        color: COLORS.primary,
                        textAlign: "center",
                        marginBottom: 4,
                      }}
                    >
                      {activeSuggestion.commonNames[0] ?? activeSuggestion.name}
                    </Text>
                    <Text
                      style={{
                        fontSize: 15,
                        color: COLORS.textSecondary,
                        fontStyle: "italic",
                        marginBottom: 6,
                      }}
                    >
                      {activeSuggestion.name}
                    </Text>
                    <Text
                      style={{
                        fontSize: 13,
                        color: prob >= CONFIDENCE.HIGH ? "#9CA3AF" : "#F57C00",
                        fontWeight: prob >= CONFIDENCE.HIGH ? "400" : "600",
                      }}
                    >
                      {t("identify.confidenceScore", {
                        score: Math.round(prob * 100),
                      })}
                    </Text>
                  </View>

                  {/* Care profile card */}
                  <View
                    style={{
                      backgroundColor: "white",
                      borderRadius: 24,
                      padding: 20,
                      marginBottom: 16,
                      shadowColor: "#000",
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.06,
                      shadowRadius: 8,
                      elevation: 3,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 15,
                        fontWeight: "600",
                        color: COLORS.primary,
                        marginBottom: 16,
                      }}
                    >
                      {t("identify.careGuide")}
                    </Text>
                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-around",
                      }}
                    >
                      {/* Watering */}
                      <View style={{ alignItems: "center", flex: 1 }}>
                        <Text style={{ fontSize: 24, marginBottom: 4 }}>
                          💧
                        </Text>
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: "600",
                            color: COLORS.textPrimary,
                            textTransform: "capitalize",
                            textAlign: "center",
                          }}
                        >
                          {activeSuggestion.careProfile.watering}
                        </Text>
                        <Text
                          style={{ fontSize: 11, color: COLORS.textSecondary }}
                        >
                          {t("identify.watering")}
                        </Text>
                      </View>

                      {/* Light */}
                      <View style={{ alignItems: "center", flex: 1 }}>
                        <Text style={{ fontSize: 24, marginBottom: 4 }}>
                          ☀️
                        </Text>
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: "600",
                            color: COLORS.textPrimary,
                            textAlign: "center",
                          }}
                          numberOfLines={2}
                        >
                          {activeSuggestion.careProfile.light ||
                            t("identify.brightLight")}
                        </Text>
                        <Text
                          style={{ fontSize: 11, color: COLORS.textSecondary }}
                        >
                          {t("identify.light")}
                        </Text>
                      </View>

                      {/* Soil */}
                      <View style={{ alignItems: "center", flex: 1 }}>
                        <Text style={{ fontSize: 24, marginBottom: 4 }}>
                          🌱
                        </Text>
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: "600",
                            color: COLORS.textPrimary,
                            textAlign: "center",
                          }}
                          numberOfLines={2}
                        >
                          {activeSuggestion.careProfile.soilType ||
                            t("identify.wellDraining")}
                        </Text>
                        <Text
                          style={{ fontSize: 11, color: COLORS.textSecondary }}
                        >
                          {t("identify.soil")}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* MEDIUM confidence: alternative matches */}
                  {prob < CONFIDENCE.HIGH &&
                    identificationResult.suggestions.length > 1 && (
                      <View
                        style={{
                          backgroundColor: "white",
                          borderRadius: 20,
                          padding: 16,
                          marginBottom: 20,
                          shadowColor: "#000",
                          shadowOffset: { width: 0, height: 1 },
                          shadowOpacity: 0.05,
                          shadowRadius: 4,
                          elevation: 2,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 14,
                            fontWeight: "600",
                            color: COLORS.textSecondary,
                            marginBottom: 12,
                          }}
                        >
                          {t("identify.alternativeMatches")}
                        </Text>
                        {identificationResult.suggestions
                          .map((sug, idx) => ({ sug, idx }))
                          .filter(({ idx }) => idx !== selectedSuggestionIndex)
                          .slice(0, 3)
                          .map(({ sug, idx }) => (
                            <View
                              key={sug.id}
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                paddingVertical: 10,
                                borderTopWidth: 1,
                                borderTopColor: "#F3F4F6",
                              }}
                            >
                              <View style={{ flex: 1 }}>
                                <Text
                                  style={{
                                    fontSize: 14,
                                    fontWeight: "500",
                                    color: COLORS.textPrimary,
                                  }}
                                >
                                  {sug.commonNames[0] ?? sug.name}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 12,
                                    color: COLORS.textSecondary,
                                    fontStyle: "italic",
                                  }}
                                >
                                  {sug.name}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 12,
                                    color: COLORS.textSecondary,
                                  }}
                                >
                                  {Math.round(sug.probability * 100)}%
                                </Text>
                              </View>
                              <TouchableOpacity
                                onPress={() => setSelectedSuggestionIndex(idx)}
                                style={{
                                  backgroundColor: COLORS.lightgreen,
                                  borderRadius: 10,
                                  paddingHorizontal: 12,
                                  paddingVertical: 8,
                                  marginLeft: 12,
                                }}
                                accessibilityLabel={t("identify.useThisInstead")}
                              >
                                <Text
                                  style={{
                                    fontSize: 12,
                                    fontWeight: "600",
                                    color: COLORS.primary,
                                  }}
                                >
                                  {t("identify.useThisInstead")}
                                </Text>
                              </TouchableOpacity>
                            </View>
                          ))}
                      </View>
                    )}

                  {/* Add to collection button */}
                  <TouchableOpacity
                    onPress={() => openAddModal(activeSuggestion)}
                    style={{
                      backgroundColor: COLORS.primary,
                      borderRadius: 18,
                      paddingVertical: 16,
                      alignItems: "center",
                      marginBottom: 12,
                    }}
                    accessibilityLabel={t("identify.addToMyPlants")}
                  >
                    <Text
                      style={{
                        color: "white",
                        fontWeight: "600",
                        fontSize: 16,
                      }}
                    >
                      {t("identify.addToMyPlants")}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={handleTryAgain}
                    style={{ paddingVertical: 12, alignItems: "center" }}
                    accessibilityLabel={
                      prob < CONFIDENCE.HIGH
                        ? t("identify.tryBetterPhoto")
                        : t("identify.tryAgain")
                    }
                  >
                    <Text
                      style={{
                        color: COLORS.textSecondary,
                        fontWeight: "500",
                        fontSize: 15,
                      }}
                    >
                      {prob < CONFIDENCE.HIGH
                        ? t("identify.tryBetterPhoto")
                        : t("identify.tryAgain")}
                    </Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            );
          })()}
        </View>
      )}

      {/* ── Paywall Modal ── */}
      <Modal
        visible={showPaywallModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPaywallModal(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.65)",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <View
            style={{
              backgroundColor: "white",
              borderRadius: 28,
              padding: 28,
              width: "100%",
            }}
          >
            <Text style={{ fontSize: 32, textAlign: "center", marginBottom: 4 }}>
              🌿
            </Text>
            <Text
              style={{
                fontSize: 20,
                fontWeight: "700",
                color: COLORS.primary,
                textAlign: "center",
                marginBottom: 10,
              }}
            >
              {t("identify.limitReached")}
            </Text>
            <Text
              style={{
                fontSize: 15,
                color: COLORS.textSecondary,
                textAlign: "center",
                lineHeight: 22,
                marginBottom: 24,
              }}
            >
              {t("identify.limitReachedMessage")}
            </Text>

            <TouchableOpacity
              onPress={() => {
                setShowPaywallModal(false);
                router.push("/paywall" as never);
              }}
              style={{
                backgroundColor: COLORS.primary,
                borderRadius: 16,
                paddingVertical: 14,
                alignItems: "center",
                marginBottom: 10,
              }}
              accessibilityLabel={t("identify.upgradeToPro")}
            >
              <Text style={{ color: "white", fontWeight: "700", fontSize: 16 }}>
                {t("identify.upgradeToPro")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setShowPaywallModal(false)}
              style={{ paddingVertical: 10, alignItems: "center" }}
              accessibilityLabel={t("identify.maybeLater")}
            >
              <Text style={{ color: COLORS.textSecondary, fontSize: 14 }}>
                {t("identify.maybeLater")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Add Plant Bottom Sheet ── */}
      <Modal
        visible={showAddModal}
        transparent
        animationType="none"
        onRequestClose={closeAddModal}
      >
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }}
          activeOpacity={1}
          onPress={closeAddModal}
        >
          <Animated.View
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              transform: [{ translateY: slideAnim }],
            }}
          >
            {/* Prevent taps on the sheet from closing it */}
            <TouchableOpacity activeOpacity={1}>
              <View
                style={{
                  backgroundColor: "white",
                  borderTopLeftRadius: 28,
                  borderTopRightRadius: 28,
                  paddingHorizontal: 24,
                  paddingTop: 12,
                  paddingBottom: insets.bottom + 24,
                }}
              >
                {/* Drag handle */}
                <View
                  style={{
                    width: 40,
                    height: 4,
                    backgroundColor: "#E5E7EB",
                    borderRadius: 2,
                    alignSelf: "center",
                    marginBottom: 20,
                  }}
                />

                <Text
                  style={{
                    fontSize: 20,
                    fontWeight: "700",
                    color: COLORS.primary,
                    marginBottom: 20,
                  }}
                >
                  {t("identify.nameYourPlant")}
                </Text>

                {/* Nickname input */}
                <TextInput
                  value={plantNickname}
                  onChangeText={setPlantNickname}
                  placeholder={t("identify.nicknamePlaceholder")}
                  placeholderTextColor="#9CA3AF"
                  style={{
                    backgroundColor: "#F9FAFB",
                    borderRadius: 14,
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    fontSize: 16,
                    color: COLORS.textPrimary,
                    marginBottom: 20,
                    borderWidth: 1,
                    borderColor: "#E5E7EB",
                  }}
                  accessibilityLabel="Plant nickname"
                />

                {/* Species input — manual add only */}
                {isManualAdd && (
                  <>
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: "600",
                        color: COLORS.textSecondary,
                        marginBottom: 10,
                      }}
                    >
                      {t("identify.speciesOptional")}
                    </Text>
                    <TextInput
                      value={manualSpecies}
                      onChangeText={setManualSpecies}
                      placeholder={t("identify.speciesPlaceholder")}
                      placeholderTextColor="#9CA3AF"
                      style={{
                        backgroundColor: "#F9FAFB",
                        borderRadius: 14,
                        paddingHorizontal: 16,
                        paddingVertical: 14,
                        fontSize: 16,
                        color: COLORS.textPrimary,
                        marginBottom: 20,
                        borderWidth: 1,
                        borderColor: "#E5E7EB",
                      }}
                      accessibilityLabel="Plant species"
                    />
                  </>
                )}

                {/* Pot size selector */}
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: "600",
                    color: COLORS.textSecondary,
                    marginBottom: 10,
                  }}
                >
                  {t("identify.potSize")}
                </Text>
                <View
                  style={{ flexDirection: "row", gap: 8, marginBottom: 20 }}
                >
                  {(
                    [
                      { value: "small", label: "Small 🪴" },
                      { value: "medium", label: "Medium 🌿" },
                      { value: "large", label: "Large 🌳" },
                    ] as { value: PotSize; label: string }[]
                  ).map(({ value, label }) => (
                    <TouchableOpacity
                      key={value}
                      onPress={() => setSelectedPotSize(value)}
                      style={{
                        flex: 1,
                        paddingVertical: 10,
                        borderRadius: 12,
                        borderWidth: 2,
                        borderColor:
                          selectedPotSize === value
                            ? COLORS.primary
                            : "#E5E7EB",
                        backgroundColor:
                          selectedPotSize === value
                            ? COLORS.lightgreen
                            : "white",
                        alignItems: "center",
                      }}
                      accessibilityLabel={`Select ${value} pot size`}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: "600",
                          color:
                            selectedPotSize === value
                              ? COLORS.primary
                              : COLORS.textSecondary,
                        }}
                      >
                        {label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Location selector */}
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: "600",
                    color: COLORS.textSecondary,
                    marginBottom: 10,
                  }}
                >
                  {t("identify.location")}
                </Text>
                <View
                  style={{ flexDirection: "row", gap: 8, marginBottom: 28 }}
                >
                  {(
                    [
                      { value: "indoor", label: "Indoor 🏠" },
                      { value: "outdoor", label: "Outdoor 🌤️" },
                      { value: "balcony", label: "Balcony 🌅" },
                    ] as { value: PlantLocation; label: string }[]
                  ).map(({ value, label }) => (
                    <TouchableOpacity
                      key={value}
                      onPress={() => setSelectedLocation(value)}
                      style={{
                        flex: 1,
                        paddingVertical: 10,
                        borderRadius: 12,
                        borderWidth: 2,
                        borderColor:
                          selectedLocation === value
                            ? COLORS.primary
                            : "#E5E7EB",
                        backgroundColor:
                          selectedLocation === value
                            ? COLORS.lightgreen
                            : "white",
                        alignItems: "center",
                      }}
                      accessibilityLabel={`Select ${value} location`}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: "600",
                          color:
                            selectedLocation === value
                              ? COLORS.primary
                              : COLORS.textSecondary,
                        }}
                      >
                        {label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Save button */}
                <TouchableOpacity
                  onPress={handleSavePlant}
                  disabled={isSaving}
                  style={{
                    backgroundColor: isSaving ? "#9CA3AF" : COLORS.primary,
                    borderRadius: 18,
                    paddingVertical: 16,
                    alignItems: "center",
                  }}
                  accessibilityLabel="Save plant to collection"
                >
                  {isSaving ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text
                      style={{ color: "white", fontWeight: "700", fontSize: 16 }}
                    >
                      {t("identify.savePlant")}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </Animated.View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

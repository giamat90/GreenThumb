import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Image,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, Camera, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import * as FileSystem from "expo-file-system/legacy";

import { COLORS } from "@/constants";
import { compressImage } from "@/lib/imageUtils";
import { invalidateSeasonalTipsCache } from "@/lib/seasonalTips";
import { supabase } from "@/lib/supabase";
import { usePlantsStore } from "@/store/plants";
import { useUserStore } from "@/store/user";
import type { PlantLocation, PotSize, Plant } from "@/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function calculateNextWatering(
  watering: "frequent" | "average" | "minimum"
): string {
  const daysMap = { frequent: 2, average: 5, minimum: 10 } as const;
  const days = daysMap[watering];
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function AddPlantScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { addPlant } = usePlantsStore();
  const { profile } = useUserStore();

  // Form state
  const [plantName, setPlantName] = useState("");
  const [species, setSpecies] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [selectedPotSize, setSelectedPotSize] = useState<PotSize>("medium");
  const [selectedLocation, setSelectedLocation] = useState<PlantLocation>("indoor");
  const [selectedWatering, setSelectedWatering] = useState<"frequent" | "average" | "minimum">("average");
  const [isSaving, setIsSaving] = useState(false);

  const handlePickPhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        t("identify.galleryPermissionTitle"),
        t("identify.galleryPermissionMessage"),
        [{ text: t("common.cancel"), style: "cancel" }]
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });

    if (result.canceled || !result.assets[0]) return;
    setPhotoUri(result.assets[0].uri);
  }, [t]);

  const handleRemovePhoto = useCallback(() => {
    setPhotoUri(null);
  }, []);

  const handleSave = useCallback(async () => {
    const trimmedName = plantName.trim();
    if (!trimmedName) {
      Alert.alert(t("common.error"), t("addPlant.plantNameRequired"));
      return;
    }
    if (!profile) return;

    setIsSaving(true);
    try {
      const plantId = generateUUID();
      let photoUrl: string | null = null;

      // Upload photo if one was selected
      if (photoUri) {
        const filePath = `${profile.id}/${plantId}.jpg`;
        try {
          let base64: string;
          try {
            base64 = await compressImage(photoUri);
          } catch {
            base64 = await FileSystem.readAsStringAsync(photoUri, {
              encoding: "base64",
            });
          }

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
      }

      const nextWatering = calculateNextWatering(selectedWatering);

      const newPlantData = {
        id: plantId,
        user_id: profile.id,
        name: trimmedName,
        species: species.trim() || null,
        common_name: null,
        photo_url: photoUrl,
        pot_size: selectedPotSize,
        location: selectedLocation,
        soil_type: null,
        last_watered_at: null,
        next_watering: nextWatering,
        health_score: 100,
        care_profile: {
          watering: selectedWatering,
          light: "indirect light",
          soilType: "well-draining",
        },
        notes: null,
      };

      const { data, error: insertError } = await supabase
        .from("plants")
        .insert(newPlantData)
        .select()
        .single();

      if (insertError) throw insertError;

      addPlant(data as Plant);

      if (profile.id) {
        await invalidateSeasonalTipsCache(profile.id);
      }

      Alert.alert(
        t("addPlant.plantAdded"),
        t("addPlant.plantAddedMessage", { name: trimmedName }),
        [
          {
            text: t("addPlant.viewMyPlants"),
            onPress: () => router.replace("/(tabs)/my-plants"),
          },
        ]
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("common.somethingWentWrong");
      Alert.alert(t("addPlant.saveFailed"), message);
    } finally {
      setIsSaving(false);
    }
  }, [
    plantName,
    species,
    photoUri,
    selectedPotSize,
    selectedLocation,
    selectedWatering,
    profile,
    addPlant,
    router,
    t,
  ]);

  const canSave = plantName.trim().length > 0 && !isSaving;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityLabel={t("common.back")}
          accessibilityRole="button"
        >
          <ChevronLeft size={24} color={COLORS.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("addPlant.title")}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Photo picker */}
        <Text style={styles.label}>{t("addPlant.photo")}</Text>
        <View style={styles.photoRow}>
          <TouchableOpacity
            onPress={handlePickPhoto}
            style={styles.photoPicker}
            accessibilityLabel={photoUri ? t("addPlant.changePhoto") : t("addPlant.addPhoto")}
            accessibilityRole="button"
          >
            {photoUri ? (
              <>
                <Image source={{ uri: photoUri }} style={styles.photoPreview} resizeMode="cover" />
                <TouchableOpacity
                  onPress={handleRemovePhoto}
                  style={styles.removePhotoButton}
                  accessibilityLabel={t("addPlant.removePhoto")}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <X size={14} color="white" />
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.photoEmpty}>
                <Camera size={28} color={COLORS.textSecondary} />
                <Text style={styles.photoEmptyText}>{t("addPlant.addPhoto")}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Plant name */}
        <Text style={styles.label}>{t("addPlant.plantName")}</Text>
        <TextInput
          value={plantName}
          onChangeText={setPlantName}
          placeholder={t("addPlant.plantNamePlaceholder")}
          placeholderTextColor="#9CA3AF"
          style={styles.input}
          accessibilityLabel={t("addPlant.plantName")}
          autoCapitalize="words"
          returnKeyType="next"
        />

        {/* Species */}
        <Text style={styles.label}>{t("addPlant.species")}</Text>
        <TextInput
          value={species}
          onChangeText={setSpecies}
          placeholder={t("addPlant.speciesPlaceholder")}
          placeholderTextColor="#9CA3AF"
          style={styles.input}
          accessibilityLabel={t("addPlant.species")}
          autoCapitalize="none"
          returnKeyType="done"
        />

        {/* Pot size */}
        <Text style={styles.label}>{t("addPlant.potSize")}</Text>
        <View style={styles.selectorRow}>
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
              style={[
                styles.selectorButton,
                selectedPotSize === value && styles.selectorButtonActive,
              ]}
              accessibilityLabel={`Select ${value} pot size`}
            >
              <Text
                style={[
                  styles.selectorButtonText,
                  selectedPotSize === value && styles.selectorButtonTextActive,
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Location */}
        <Text style={styles.label}>{t("addPlant.location")}</Text>
        <View style={styles.selectorRow}>
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
              style={[
                styles.selectorButton,
                selectedLocation === value && styles.selectorButtonActive,
              ]}
              accessibilityLabel={`Select ${value} location`}
            >
              <Text
                style={[
                  styles.selectorButtonText,
                  selectedLocation === value && styles.selectorButtonTextActive,
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Watering frequency */}
        <Text style={styles.label}>{t("addPlant.wateringFrequency")}</Text>
        <View style={styles.selectorRow}>
          {(
            [
              { value: "frequent", labelKey: "addPlant.frequentLabel", descKey: "addPlant.frequentDesc" },
              { value: "average", labelKey: "addPlant.averageLabel", descKey: "addPlant.averageDesc" },
              { value: "minimum", labelKey: "addPlant.minimumLabel", descKey: "addPlant.minimumDesc" },
            ] as { value: "frequent" | "average" | "minimum"; labelKey: string; descKey: string }[]
          ).map(({ value, labelKey, descKey }) => (
            <TouchableOpacity
              key={value}
              onPress={() => setSelectedWatering(value)}
              style={[
                styles.wateringButton,
                selectedWatering === value && styles.selectorButtonActive,
              ]}
              accessibilityLabel={`Select ${value} watering frequency`}
            >
              <Text
                style={[
                  styles.selectorButtonText,
                  selectedWatering === value && styles.selectorButtonTextActive,
                ]}
              >
                {t(labelKey)}
              </Text>
              <Text
                style={[
                  styles.wateringDesc,
                  selectedWatering === value && styles.wateringDescActive,
                ]}
              >
                {t(descKey)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Save button */}
        <TouchableOpacity
          onPress={handleSave}
          disabled={!canSave}
          style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
          accessibilityLabel={t("addPlant.savePlant")}
          accessibilityRole="button"
        >
          {isSaving ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.saveButtonText}>{t("addPlant.savePlant")}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
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
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.lightgreen,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: "700",
    color: COLORS.primary,
    textAlign: "center",
  },
  headerSpacer: {
    width: 40,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textSecondary,
    marginBottom: 10,
    marginTop: 20,
  },
  photoRow: {
    alignItems: "flex-start",
    marginTop: 4,
  },
  photoPicker: {
    width: 120,
    height: 120,
    borderRadius: 20,
    overflow: "hidden",
  },
  photoPreview: {
    width: 120,
    height: 120,
    borderRadius: 20,
  },
  photoEmpty: {
    width: 120,
    height: 120,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: "#D1D5DB",
    borderStyle: "dashed",
    backgroundColor: "#F9FAFB",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  photoEmptyText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: "center",
    paddingHorizontal: 8,
  },
  removePhotoButton: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    backgroundColor: "#F9FAFB",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  selectorRow: {
    flexDirection: "row",
    gap: 8,
  },
  selectorButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#E5E7EB",
    backgroundColor: "white",
    alignItems: "center",
  },
  selectorButtonActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.lightgreen,
  },
  selectorButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  selectorButtonTextActive: {
    color: COLORS.primary,
  },
  wateringButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#E5E7EB",
    backgroundColor: "white",
    alignItems: "center",
  },
  wateringDesc: {
    fontSize: 10,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  wateringDescActive: {
    color: COLORS.primary,
  },
  saveButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 32,
  },
  saveButtonDisabled: {
    backgroundColor: "#9CA3AF",
  },
  saveButtonText: {
    color: "white",
    fontWeight: "700",
    fontSize: 16,
  },
});

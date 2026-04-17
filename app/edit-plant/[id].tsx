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
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, Camera, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import * as FileSystem from "expo-file-system/legacy";

import { COLORS } from "@/constants";
import { compressImage } from "@/lib/imageUtils";
import { supabase } from "@/lib/supabase";
import { usePlantsStore } from "@/store/plants";
import { useUserStore } from "@/store/user";
import type { PlantLocation, PotSize } from "@/types";

const GROWING_MEDIUM_OPTIONS = [
  { value: 'soil',       label: 'Soil 🌱' },
  { value: 'hydroponic', label: 'Hydroponic 💧' },
  { value: 'leca',       label: 'LECA 🪨' },
  { value: 'moss',       label: 'Moss 🌿' },
  { value: 'bark',       label: 'Bark 🌸' },
  { value: 'coco',       label: 'Coco Coir 🥥' },
] as const;

function deriveGrowingMedium(careProfile: Record<string, unknown> | null): string {
  const soil = (careProfile?.soilType as string | undefined) ?? '';
  const nonSoilValues = ['hydroponic', 'leca', 'moss', 'bark', 'coco'];
  return nonSoilValues.includes(soil) ? soil : 'soil';
}

export default function EditPlantScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { plants, updatePlant } = usePlantsStore();
  const { profile } = useUserStore();

  const plant = plants.find((p) => p.id === id) ?? null;

  // Pre-fill from existing plant
  const [plantName, setPlantName] = useState(plant?.name ?? "");
  const [species, setSpecies] = useState(plant?.species ?? "");
  // photoUri = local URI if user picked a new photo; null means "keep existing or cleared"
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  // photoCleared = user explicitly removed the existing photo
  const [photoCleared, setPhotoCleared] = useState(false);
  const [selectedPotSize, setSelectedPotSize] = useState<PotSize>(
    plant?.pot_size ?? "medium"
  );
  const [selectedLocation, setSelectedLocation] = useState<PlantLocation>(
    plant?.location ?? "indoor"
  );
  const [growingMedium, setGrowingMedium] = useState(
    deriveGrowingMedium(plant?.care_profile as Record<string, unknown> | null)
  );
  const [isSaving, setIsSaving] = useState(false);

  const canSave = plantName.trim().length > 0 && !isSaving;

  // Derive what photo is currently "shown" in the preview
  const previewUri = photoUri ?? (photoCleared ? null : plant?.photo_url ?? null);

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
    setPhotoCleared(false);
  }, [t]);

  const handleRemovePhoto = useCallback(() => {
    setPhotoUri(null);
    setPhotoCleared(true);
  }, []);

  const handleSave = useCallback(async () => {
    const trimmedName = plantName.trim();
    if (!trimmedName || !profile || !plant) return;

    setIsSaving(true);
    try {
      const filePath = `${profile.id}/${plant.id}.jpg`;
      let newPhotoUrl: string | null | undefined = undefined; // undefined = no change

      if (photoUri) {
        // User picked a new photo — upload and overwrite
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
            .upload(filePath, bytes, { contentType: "image/jpeg", upsert: true });

          if (uploadError) throw uploadError;

          const { data: urlData } = supabase.storage
            .from("plant-photos")
            .getPublicUrl(filePath);
          // Append cache-buster so the app reloads the new image
          newPhotoUrl = `${urlData.publicUrl}?v=${Date.now()}`;
        } catch (error) {
          console.error("Photo upload failed:", (error as Error).message);
          throw error;
        }
      } else if (photoCleared) {
        // User removed the photo — delete from storage and clear the URL
        await supabase.storage.from("plant-photos").remove([filePath]);
        newPhotoUrl = null;
      }

      const existingCareProfile = (plant.care_profile as Record<string, unknown>) ?? {};
      const updates: Record<string, unknown> = {
        name: trimmedName,
        species: species.trim() || null,
        pot_size: selectedPotSize,
        location: selectedLocation,
        care_profile: {
          ...existingCareProfile,
          soilType: growingMedium === 'soil' ? 'well-draining' : growingMedium,
        },
      };

      if (newPhotoUrl !== undefined) {
        updates.photo_url = newPhotoUrl;
      }

      const { error: updateError } = await supabase
        .from("plants")
        .update(updates)
        .eq("id", plant.id);

      if (updateError) throw updateError;

      updatePlant(plant.id, {
        name: trimmedName,
        species: species.trim() || null,
        pot_size: selectedPotSize,
        location: selectedLocation,
        care_profile: updates.care_profile as Record<string, unknown>,
        ...(newPhotoUrl !== undefined ? { photo_url: newPhotoUrl } : {}),
      });

      router.back();
    } catch (err) {
      console.error("Edit plant failed:", err);
      Alert.alert(t("common.error"), t("editPlant.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  }, [
    plantName,
    species,
    photoUri,
    photoCleared,
    selectedPotSize,
    selectedLocation,
    growingMedium,
    profile,
    plant,
    updatePlant,
    router,
    t,
  ]);

  if (!plant) return null;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityLabel={t("common.back")}
          accessibilityRole="button"
        >
          <ChevronLeft size={24} color={COLORS.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("editPlant.title")}</Text>
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
            accessibilityLabel={previewUri ? t("addPlant.changePhoto") : t("addPlant.addPhoto")}
            accessibilityRole="button"
          >
            {previewUri ? (
              <>
                <Image source={{ uri: previewUri }} style={styles.photoPreview} resizeMode="cover" />
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

        {/* Growing medium */}
        <Text style={styles.label}>{t("addPlant.growingMedium")}</Text>
        <View style={styles.selectorRowWrap}>
          {GROWING_MEDIUM_OPTIONS.map(({ value, label }) => (
            <TouchableOpacity
              key={value}
              onPress={() => setGrowingMedium(value)}
              style={[
                styles.selectorButtonWrap,
                growingMedium === value && styles.selectorButtonActive,
              ]}
              accessibilityLabel={label}
            >
              <Text
                style={[
                  styles.selectorButtonText,
                  growingMedium === value && styles.selectorButtonTextActive,
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Save button */}
        <TouchableOpacity
          onPress={handleSave}
          disabled={!canSave}
          style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
          accessibilityLabel={t("editPlant.saveChanges")}
          accessibilityRole="button"
        >
          {isSaving ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.saveButtonText}>{t("editPlant.saveChanges")}</Text>
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
  selectorRowWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
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
  selectorButtonWrap: {
    width: "31.5%",
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

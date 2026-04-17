import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Image,
  Alert,
  ActivityIndicator,
  StyleSheet,
  Keyboard,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Stack, useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, Camera, ImageIcon, ChevronDown } from "lucide-react-native";
import * as FileSystem from "expo-file-system/legacy";
import { useTranslation } from "react-i18next";

import { COLORS } from "@/constants";
import { supabase } from "@/lib/supabase";
import { useUserStore } from "@/store/user";
import { usePlantsStore } from "@/store/plants";
import { compressImage } from "@/lib/imageUtils";

export default function NewPostScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const { profile } = useUserStore();
  const { plants } = usePlantsStore();

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [selectedPlantId, setSelectedPlantId] = useState<string | null>(null);
  const [showPlantPicker, setShowPlantPicker] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  const selectedPlant = plants.find((p) => p.id === selectedPlantId);
  const scrollRef = useRef<ScrollView>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const keyboardHeightRef = useRef(0);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => {
      keyboardHeightRef.current = e.endCoordinates.height;
      setKeyboardHeight(e.endCoordinates.height);
      // scrollToEnd triggered by ScrollView's onLayout once layout settles.
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      keyboardHeightRef.current = 0;
      setKeyboardHeight(0);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    });
    return () => { show.remove(); hide.remove(); };
  }, []);

  const handlePickPhoto = useCallback(() => {
    Alert.alert(t("community.sharePost"), t("diagnosis.chooseSource"), [
      {
        text: t("common.takePhoto"),
        onPress: async () => {
          const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.85,
            allowsEditing: true,
            aspect: [1, 1],
          });
          if (!result.canceled && result.assets[0]) {
            setPhotoUri(result.assets[0].uri);
          }
        },
      },
      {
        text: t("common.chooseFromGallery"),
        onPress: async () => {
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.85,
            allowsEditing: true,
            aspect: [1, 1],
          });
          if (!result.canceled && result.assets[0]) {
            setPhotoUri(result.assets[0].uri);
          }
        },
      },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  }, [t]);

  const handleShare = useCallback(async () => {
    if (!photoUri || !profile) return;
    setIsSharing(true);
    try {
      // Compress and read as base64
      const filename = `community_${Date.now()}.jpg`;
      const destUri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.copyAsync({ from: photoUri, to: destUri });
      const base64 = await compressImage(destUri);

      // Convert base64 to Uint8Array for Supabase storage
      const byteCharacters = atob(base64);
      const byteArray = new Uint8Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteArray[i] = byteCharacters.charCodeAt(i);
      }

      const storagePath = `${profile.id}/${filename}`;
      const { error: uploadError } = await supabase.storage
        .from("community-photos")
        .upload(storagePath, byteArray, { contentType: "image/jpeg", upsert: false });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("community-photos")
        .getPublicUrl(storagePath);
      const photoUrl = urlData.publicUrl;

      const { error: insertError } = await supabase.from("posts").insert({
        user_id: profile.id,
        plant_id: selectedPlantId ?? null,
        photo_url: photoUrl,
        caption: caption.trim() || null,
        is_public: true,
      });

      if (insertError) throw insertError;

      Alert.alert("", t("community.postShared"), [
        { text: t("common.ok"), onPress: () => router.back() },
      ]);
    } catch (err) {
      Alert.alert(t("common.error"), err instanceof Error ? err.message : t("community.postFailed"));
    } finally {
      setIsSharing(false);
    }
  }, [photoUri, profile, caption, selectedPlantId, router, t]);

  return (
    <View style={[styles.screen, { paddingBottom: keyboardHeight }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 16, paddingBottom: 16 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onLayout={() => {
          if (keyboardHeightRef.current > 0) {
            scrollRef.current?.scrollToEnd({ animated: true });
          }
        }}
      >
        {/* Back */}
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <ArrowLeft size={20} color={COLORS.textPrimary} />
        </TouchableOpacity>

        <Text style={styles.title}>{t("community.sharePost")}</Text>

        {/* Photo picker */}
        <TouchableOpacity style={styles.photoArea} onPress={handlePickPhoto} activeOpacity={0.8}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.photoPreview} resizeMode="cover" />
          ) : (
            <View style={styles.photoPlaceholder}>
              <ImageIcon size={40} color={COLORS.textSecondary} />
              <Text style={styles.photoPlaceholderText}>{t("identify.takePhoto")}</Text>
            </View>
          )}
          {photoUri && (
            <View style={styles.changePhotoOverlay}>
              <Camera size={20} color="#fff" />
            </View>
          )}
        </TouchableOpacity>

        {/* Caption */}
        <TextInput
          style={styles.captionInput}
          value={caption}
          onChangeText={(v) => setCaption(v.slice(0, 280))}
          placeholder={t("community.writeCaption")}
          placeholderTextColor={COLORS.textSecondary}
          multiline
          maxLength={280}
        />
        <Text style={styles.charCount}>{caption.length}/280</Text>

        {/* Plant selector */}
        <TouchableOpacity
          style={styles.plantSelector}
          onPress={() => setShowPlantPicker(!showPlantPicker)}
          activeOpacity={0.7}
        >
          <Text style={styles.plantSelectorText}>
            {selectedPlant ? t("community.plantTag", { name: selectedPlant.name }) : t("community.selectPlant")}
          </Text>
          <ChevronDown size={18} color={COLORS.textSecondary} />
        </TouchableOpacity>

        {showPlantPicker && (
          <View style={styles.plantList}>
            <TouchableOpacity
              style={styles.plantOption}
              onPress={() => { setSelectedPlantId(null); setShowPlantPicker(false); }}
            >
              <Text style={styles.plantOptionText}>{t("community.selectPlant")}</Text>
            </TouchableOpacity>
            {plants.map((plant) => (
              <TouchableOpacity
                key={plant.id}
                style={[styles.plantOption, plant.id === selectedPlantId && styles.plantOptionSelected]}
                onPress={() => { setSelectedPlantId(plant.id); setShowPlantPicker(false); }}
              >
                <Text style={[styles.plantOptionText, plant.id === selectedPlantId && styles.plantOptionTextSelected]}>
                  {plant.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Action bar — sits above the keyboard-height spacer */}
      <View style={[styles.actionBar, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[styles.shareButton, (!photoUri || isSharing) && styles.shareButtonDisabled]}
          onPress={handleShare}
          disabled={!photoUri || isSharing}
          activeOpacity={0.85}
        >
          {isSharing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.shareButtonText}>{t("community.sharePost")}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.cream },
  content: { paddingHorizontal: 20, gap: 14 },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#fff", alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 1,
    marginBottom: 4,
  },
  title: {
    fontSize: 26, fontWeight: "800", color: COLORS.primary, letterSpacing: -0.5,
  },
  photoArea: {
    width: "100%", aspectRatio: 1,
    borderRadius: 20, overflow: "hidden",
    backgroundColor: "#fff",
    borderWidth: 2, borderColor: "#E5E7EB", borderStyle: "dashed",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  photoPlaceholder: {
    flex: 1, alignItems: "center", justifyContent: "center", gap: 10,
  },
  photoPlaceholderText: { fontSize: 15, color: COLORS.textSecondary },
  photoPreview: { width: "100%", height: "100%" },
  changePhotoOverlay: {
    position: "absolute", top: 12, right: 12,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center", justifyContent: "center",
  },
  captionInput: {
    backgroundColor: "#fff", borderRadius: 16,
    padding: 16, minHeight: 100, textAlignVertical: "top",
    fontSize: 15, color: COLORS.textPrimary, lineHeight: 22,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  charCount: { fontSize: 12, color: COLORS.textSecondary, textAlign: "right", marginTop: -8 },
  plantSelector: {
    backgroundColor: "#fff", borderRadius: 16, padding: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  plantSelectorText: { fontSize: 15, color: COLORS.textSecondary },
  plantList: {
    backgroundColor: "#fff", borderRadius: 16, overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 6, elevation: 3,
  },
  plantOption: { padding: 16, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  plantOptionSelected: { backgroundColor: COLORS.lightgreen },
  plantOptionText: { fontSize: 15, color: COLORS.textPrimary },
  plantOptionTextSelected: { color: COLORS.primary, fontWeight: "700" },
  actionBar: {
    backgroundColor: "#fff", paddingTop: 12, paddingHorizontal: 20,
    borderTopWidth: 1, borderTopColor: COLORS.cream,
    shadowColor: "#000", shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 8,
  },
  shareButton: {
    backgroundColor: COLORS.primary, borderRadius: 16,
    paddingVertical: 16, alignItems: "center",
  },
  shareButtonDisabled: { backgroundColor: "#A3A3A3" },
  shareButtonText: { fontSize: 16, fontWeight: "700", color: "#fff" },
});

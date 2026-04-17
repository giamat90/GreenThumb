import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  StyleSheet,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, Plus, Camera, ImageIcon, TrendingUp } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useTranslation } from "react-i18next";

import { COLORS } from "@/constants";
import { supabase } from "@/lib/supabase";
import { compressImage } from "@/lib/imageUtils";
import { usePlantsStore } from "@/store/plants";
import { useUserStore } from "@/store/user";
import type { GrowthLog } from "@/types";

type ScreenState = "timeline" | "add";

// ─── Timeline entry ───────────────────────────────────────────────────────────

function TimelineEntry({
  log,
  prevLog,
  isLast,
}: {
  log: GrowthLog;
  prevLog?: GrowthLog;
  isLast: boolean;
}) {
  const { t, i18n } = useTranslation();

  const heightDiff =
    log.height_cm != null && prevLog?.height_cm != null
      ? log.height_cm - prevLog.height_cm
      : null;

  const dateStr = new Date(log.logged_at).toLocaleDateString(i18n.language, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <View style={styles.timelineEntry}>
      {/* Left: dot + connector line */}
      <View style={styles.timelineLeft}>
        <View style={styles.timelineDot} />
        {!isLast && <View style={styles.timelineLine} />}
      </View>

      {/* Right: content card */}
      <View style={[styles.timelineCard, isLast && { marginBottom: 0 }]}>
        <Text style={styles.timelineDate}>{dateStr}</Text>

        {log.photo_url ? (
          <Image
            source={{ uri: log.photo_url }}
            style={styles.timelinePhoto}
            resizeMode="cover"
          />
        ) : null}

        {log.height_cm != null ? (
          <Text style={styles.timelineHeight}>📏 {log.height_cm} cm</Text>
        ) : null}

        {log.notes ? (
          <Text style={styles.timelineNotes}>{log.notes}</Text>
        ) : null}

        {heightDiff !== null && (
          <Text
            style={[
              styles.timelineDiff,
              heightDiff >= 0 ? styles.diffPositive : styles.diffNegative,
            ]}
          >
            {heightDiff >= 0 ? "+" : ""}
            {heightDiff.toFixed(1)} {t("growth.sinceLastEntry")}
          </Text>
        )}
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function GrowthScreen() {
  const { t } = useTranslation();
  const { id: plantId } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const { plants } = usePlantsStore();
  const { profile } = useUserStore();
  const plant = plants.find((p) => p.id === plantId) ?? null;

  // ── Data state ──────────────────────────────────────────────────────────────
  const [logs, setLogs] = useState<GrowthLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // ── Screen state ────────────────────────────────────────────────────────────
  const [screenState, setScreenState] = useState<ScreenState>("timeline");

  // ── Add form state ──────────────────────────────────────────────────────────
  const [addPhotoUri, setAddPhotoUri] = useState<string | null>(null);
  const [addHeight, setAddHeight] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [actionBarHeight, setActionBarHeight] = useState(0);

  // ── Fetch logs ───────────────────────────────────────────────────────────────
  const fetchLogs = useCallback(async () => {
    if (!plantId) return;
    setIsLoading(true);
    const { data } = await supabase
      .from("growth_logs")
      .select("*")
      .eq("plant_id", plantId)
      .order("logged_at", { ascending: false });
    setLogs((data ?? []) as GrowthLog[]);
    setIsLoading(false);
  }, [plantId]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // ── Pick photo ────────────────────────────────────────────────────────────────
  const handlePickPhoto = useCallback(async (source: "camera" | "gallery") => {
    try {
      let result: ImagePicker.ImagePickerResult;
      if (source === "camera") {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(t("growth.cameraAccessRequired"), t("growth.allowCameraAccess"));
          return;
        }
        result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
      }
      if (!result.canceled && result.assets[0]?.uri) {
        setAddPhotoUri(result.assets[0].uri);
      }
    } catch {
      Alert.alert(t("common.error"), t("common.tryAgain"));
    }
  }, [t]);

  // ── Save entry ────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!profile || !plantId) return;
    if (!addPhotoUri && !addHeight.trim() && !addNotes.trim()) {
      Alert.alert(t("growth.nothingToSave"), t("growth.addPhotoHeightOrNote"));
      return;
    }

    // Validate height before starting the async work
    const heightValue = addHeight.trim() ? parseFloat(addHeight.trim()) : null;
    if (heightValue !== null && isNaN(heightValue)) {
      Alert.alert(t("growth.invalidHeight"), t("growth.enterValidNumber"));
      return;
    }

    setIsSaving(true);
    try {
      let photoUrl: string | null = null;

      console.log("Step 1: starting save, photoUri:", addPhotoUri);

      if (addPhotoUri) {
        // Copy picker URI to cache first — content:// URIs can't be read directly
        console.log("Step 2: copying to cache...");
        const cacheDir = FileSystem.cacheDirectory + "growth/";
        await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });
        const destUri = cacheDir + Date.now() + ".jpg";
        await FileSystem.copyAsync({ from: addPhotoUri, to: destUri });
        console.log("Step 2 done, destUri:", destUri);

        // compressImage returns base64 directly — no second file read needed
        console.log("Step 3: compressing...");
        const base64 = await compressImage(destUri);
        console.log("Step 3 done, base64 length:", base64.length);

        // Upload as Uint8Array with a 15-second timeout
        console.log("Step 4: uploading to storage...");
        const byteArray = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const path = `growth/${profile.id}/${plantId}/${Date.now()}.jpg`;
        const uploadPromise = supabase.storage
          .from("plant-photos")
          .upload(path, byteArray, { contentType: "image/jpeg", upsert: false });
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => {
            console.log("Step 4: TIMEOUT fired after 15s");
            reject(new Error("Upload timed out. Check your connection and try again."));
          }, 15000)
        );
        const { data: uploadData, error: uploadError } = await Promise.race([uploadPromise, timeoutPromise]) as Awaited<typeof uploadPromise>;
        if (uploadError) throw uploadError;
        console.log("Step 4 done, path:", uploadData.path);

        const { data: urlData } = supabase.storage
          .from("plant-photos")
          .getPublicUrl(uploadData.path);
        photoUrl = urlData.publicUrl;
      }

      console.log("Step 6: inserting to DB...");
      const now = new Date().toISOString();
      const { data: inserted, error } = await supabase
        .from("growth_logs")
        .insert({
          plant_id: plantId,
          user_id: profile.id,
          photo_url: photoUrl,
          height_cm: heightValue,
          notes: addNotes.trim() || null,
          logged_at: now,
        })
        .select()
        .single();

      if (error) throw error;
      console.log("Step 6 done, inserted id:", (inserted as GrowthLog).id);

      setLogs((prev) => [inserted as GrowthLog, ...prev]);
      setAddPhotoUri(null);
      setAddHeight("");
      setAddNotes("");
      setScreenState("timeline");
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : t("common.somethingWentWrong");
      console.error("Save entry error:", error);
      Alert.alert(t("common.error"), msg);
    } finally {
      setIsSaving(false);
    }
  }, [profile, plantId, addPhotoUri, addHeight, addNotes, t]);

  const handleCancelAdd = useCallback(() => {
    setAddPhotoUri(null);
    setAddHeight("");
    setAddNotes("");
    setScreenState("timeline");
  }, []);

  // ── Guard ──────────────────────────────────────────────────────────────────
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
  // ADD ENTRY VIEW
  // ──────────────────────────────────────────────────────────────────────────

  if (screenState === "add") {
    return (
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Stack.Screen options={{ headerShown: false }} />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.addContent,
            { paddingTop: insets.top + 16, paddingBottom: actionBarHeight + 16 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={handleCancelAdd}>
              <ArrowLeft size={20} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>{t("growth.addEntry")}</Text>
          </View>

          {/* Photo */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t("growth.photo")}</Text>
            {addPhotoUri ? (
              <View style={styles.photoWrap}>
                <Image source={{ uri: addPhotoUri }} style={styles.photoPreview} resizeMode="cover" />
                <TouchableOpacity style={styles.removePhotoBtn} onPress={() => setAddPhotoUri(null)}>
                  <Text style={styles.removePhotoText}>{t("growth.removePhoto")}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.photoButtonRow}>
                <TouchableOpacity style={styles.photoButton} onPress={() => handlePickPhoto("camera")}>
                  <Camera size={20} color={COLORS.primary} />
                  <Text style={styles.photoButtonText}>{t("growth.camera")}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.photoButton} onPress={() => handlePickPhoto("gallery")}>
                  <ImageIcon size={20} color={COLORS.primary} />
                  <Text style={styles.photoButtonText}>{t("growth.library")}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Height */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t("growth.heightCm")}</Text>
            <TextInput
              style={styles.textInput}
              value={addHeight}
              onChangeText={setAddHeight}
              placeholder={t("growth.heightPlaceholder")}
              keyboardType="decimal-pad"
              placeholderTextColor={COLORS.textSecondary}
              returnKeyType="done"
            />
          </View>

          {/* Notes */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t("growth.notes")}</Text>
            <TextInput
              style={[styles.textInput, styles.textInputMulti]}
              value={addNotes}
              onChangeText={setAddNotes}
              placeholder={t("growth.notesPlaceholder")}
              placeholderTextColor={COLORS.textSecondary}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>
        </ScrollView>

        {/* Bottom bar */}
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]} onLayout={(e) => setActionBarHeight(e.nativeEvent.layout.height)}>
          <TouchableOpacity style={styles.cancelButton} onPress={handleCancelAdd}>
            <Text style={styles.cancelButtonText}>{t("growth.cancel")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.saveButton, isSaving && { opacity: 0.7 }]}
            onPress={handleSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.saveButtonText}>{t("growth.saveEntry")}</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TIMELINE VIEW
  // ──────────────────────────────────────────────────────────────────────────

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16, paddingHorizontal: 16 }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <ArrowLeft size={20} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t("growth.title")}</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>{plant.name}</Text>
        </View>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => setScreenState("add")}
          accessibilityLabel={t("growth.addEntry")}
        >
          <Plus size={16} color="#fff" />
          <Text style={styles.addButtonText}>{t("common.add")}</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.primary} size="large" />
        </View>
      ) : logs.length === 0 ? (
        /* Empty state */
        <View style={styles.centered}>
          <TrendingUp size={56} color={COLORS.lightgreen} />
          <Text style={styles.emptyTitle}>{t("growth.startTracking")}</Text>
          <Text style={styles.emptySubtitle}>
            {t("growth.startTrackingDesc")}
          </Text>
          <TouchableOpacity
            style={styles.emptyAddButton}
            onPress={() => setScreenState("add")}
          >
            <Text style={styles.emptyAddButtonText}>{t("growth.addFirstEntry")}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        /* Timeline */
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.timelineContent,
            { paddingBottom: insets.bottom + 32 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {logs.map((log, i) => (
            <TimelineEntry
              key={log.id}
              log={log}
              prevLog={logs[i + 1]}
              isLast={i === logs.length - 1}
            />
          ))}
        </ScrollView>
      )}
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
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingBottom: 16,
    backgroundColor: COLORS.cream,
  },
  backButton: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 1,
  },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 20, fontWeight: "800", color: COLORS.textPrimary },
  headerSubtitle: { fontSize: 13, color: COLORS.textSecondary, marginTop: 1 },
  addButton: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: COLORS.primary, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  addButtonText: { fontSize: 13, fontWeight: "700", color: "#fff" },

  // ── Timeline ─────────────────────────────────────────────────────────────────
  timelineContent: { paddingHorizontal: 16, paddingTop: 8 },
  timelineEntry: { flexDirection: "row", gap: 12 },
  timelineLeft: { alignItems: "center", width: 20 },
  timelineDot: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: COLORS.primary, borderWidth: 2, borderColor: "#fff",
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 4,
    elevation: 2, marginTop: 16,
  },
  timelineLine: { width: 2, flex: 1, backgroundColor: COLORS.lightgreen, marginTop: 4 },
  timelineCard: {
    flex: 1, backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  timelineDate: { fontSize: 12, fontWeight: "600", color: COLORS.textSecondary, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.4 },
  timelinePhoto: { width: "100%", height: 180, borderRadius: 12, marginBottom: 10 },
  timelineHeight: { fontSize: 16, fontWeight: "700", color: COLORS.textPrimary, marginBottom: 4 },
  timelineNotes: { fontSize: 14, color: COLORS.textSecondary, lineHeight: 20, marginBottom: 4 },
  timelineDiff: { fontSize: 13, fontWeight: "600", marginTop: 4 },
  diffPositive: { color: COLORS.primary },
  diffNegative: { color: COLORS.danger },

  // ── Empty state ──────────────────────────────────────────────────────────────
  emptyTitle: { fontSize: 20, fontWeight: "700", color: COLORS.textPrimary, marginTop: 20, marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: COLORS.textSecondary, textAlign: "center", lineHeight: 21, marginBottom: 28 },
  emptyAddButton: {
    backgroundColor: COLORS.primary, borderRadius: 16,
    paddingHorizontal: 28, paddingVertical: 14,
  },
  emptyAddButtonText: { fontSize: 16, fontWeight: "700", color: "#fff" },

  // ── Add form ─────────────────────────────────────────────────────────────────
  addContent: { paddingHorizontal: 16 },
  section: { marginBottom: 20 },
  sectionLabel: {
    fontSize: 13, fontWeight: "700", color: COLORS.textPrimary,
    textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10,
  },
  photoButtonRow: { flexDirection: "row", gap: 10 },
  photoButton: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: "#fff", borderRadius: 14, paddingVertical: 14,
    borderWidth: 1.5, borderColor: COLORS.secondary,
  },
  photoButtonText: { fontSize: 14, fontWeight: "600", color: COLORS.primary },
  photoWrap: { borderRadius: 16, overflow: "hidden" },
  photoPreview: { width: "100%", height: 180, borderRadius: 16 },
  removePhotoBtn: {
    position: "absolute", top: 8, right: 8,
    backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  removePhotoText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  textInput: {
    backgroundColor: "#fff", borderRadius: 14, padding: 14,
    fontSize: 15, color: COLORS.textPrimary,
    borderWidth: 1.5, borderColor: "#E5E7EB",
  },
  textInputMulti: { height: 90, paddingTop: 12 },

  // ── Bottom bar ────────────────────────────────────────────────────────────────
  bottomBar: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "#fff", paddingTop: 12, paddingHorizontal: 16,
    flexDirection: "row", gap: 10,
    borderTopWidth: 1, borderTopColor: COLORS.cream,
    shadowColor: "#000", shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 8,
  },
  cancelButton: {
    flex: 1, alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: COLORS.primary, borderRadius: 16, paddingVertical: 14,
  },
  cancelButtonText: { fontSize: 15, fontWeight: "600", color: COLORS.primary },
  saveButton: {
    flex: 1, alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.primary, borderRadius: 16, paddingVertical: 16,
  },
  saveButtonText: { fontSize: 16, fontWeight: "700", color: "#fff" },
});

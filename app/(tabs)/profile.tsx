import { useState } from "react";
import {
  View,
  Text,
  Image,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert,
  StyleSheet,
  Linking,
  Platform,
  Modal,
  TextInput,
  KeyboardAvoidingView,
} from "react-native";
import { LogOut, MapPin, Info, Shield, FileText, Crown, Users, Camera, Ruler, Pencil } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Location from "expo-location";

import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { supabase } from "@/lib/supabase";
import { useUserStore } from "@/store/user";
import { COLORS } from "@/constants";
import { NotificationSettings } from "@/components/ui/NotificationSettings";
import { compressImage } from "@/lib/imageUtils";
import type { UnitSystem } from "@/types";

const APP_VERSION: string =
  (Constants.expoConfig?.version as string | undefined) ?? "1.0.0";

// ─── Simple setting row ────────────────────────────────────────────────────────

function SettingRow({
  icon,
  label,
  value,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.settingRow}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      accessibilityLabel={label}
      accessibilityRole={onPress ? "button" : "text"}
    >
      <View style={styles.settingRowLeft}>
        <View style={styles.settingIconWrap}>{icon}</View>
        <Text style={styles.settingLabel}>{label}</Text>
      </View>
      {value ? (
        <Text style={styles.settingValue}>{value}</Text>
      ) : (
        <Text style={styles.settingChevron}>›</Text>
      )}
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const { t } = useTranslation();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isSavingCity, setIsSavingCity] = useState(false);
  const [isDetectingLocation, setIsDetectingLocation] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [showCityModal, setShowCityModal] = useState(false);
  const [cityInput, setCityInput] = useState("");
  const [cityError, setCityError] = useState<string | null>(null);
  const [showNameModal, setShowNameModal] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);
  const { profile, setProfile } = useUserStore();
  const router = useRouter();
  const isPro = profile?.subscription === "pro";

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) Alert.alert(t("common.error"), error.message);
      // Auth state listener in _layout.tsx handles the redirect
    } catch {
      Alert.alert(t("common.error"), t("profile.somethingWentWrong"));
    } finally {
      setIsSigningOut(false);
    }
  }

  async function handleToggleUnits() {
    if (!profile?.id) return;
    const newUnits: UnitSystem = profile.units === 'imperial' ? 'metric' : 'imperial';
    // Optimistic update
    setProfile({ ...profile, units: newUnits });
    const { error } = await supabase
      .from("profiles")
      .update({ units: newUnits })
      .eq("id", profile.id);
    if (error) {
      // Revert on failure
      setProfile({ ...profile, units: profile.units });
      Alert.alert(t("common.error"), error.message);
    }
  }

  function handleEditName() {
    setNameInput(profile?.display_name ?? "");
    setShowNameModal(true);
  }

  async function handleSaveName() {
    const trimmed = nameInput.trim();
    if (!trimmed || !profile?.id) return;
    setIsSavingName(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: trimmed })
        .eq("id", profile.id);
      if (error) throw error;
      // Keep community username in sync
      await supabase
        .from("user_profiles")
        .upsert({ id: profile.id, username: trimmed }, { onConflict: "id" });
      setProfile({ ...profile, display_name: trimmed });
      setShowNameModal(false);
      Alert.alert("", t("profile.nameUpdated"));
    } catch {
      Alert.alert(t("common.error"), t("profile.nameUpdateFailed"));
    } finally {
      setIsSavingName(false);
    }
  }

  function handleEditCity() {
    setCityInput(profile?.city ?? "");
    setCityError(null);
    setShowCityModal(true);
  }

  async function handleSaveCity() {
    const trimmed = cityInput.trim();
    if (!trimmed || !profile?.id) return;

    setIsSavingCity(true);
    setCityError(null);

    try {
      const OWM_KEY = process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY ?? "";
      const geoRes = await fetch(
        `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(trimmed)}&limit=1&appid=${OWM_KEY}`
      );
      if (!geoRes.ok) throw new Error(`Geocoding error: ${geoRes.status}`);
      const geoData = (await geoRes.json()) as Array<{ lat: number; lon: number }>;

      if (!geoData.length) {
        setCityError(t("profile.cityNotFound"));
        setIsSavingCity(false);
        return;
      }

      const { lat: latitude, lon: longitude } = geoData[0];
      const { error } = await supabase
        .from("profiles")
        .update({ city: trimmed, lat: latitude, lng: longitude })
        .eq("id", profile.id);

      if (error) throw error;

      setProfile({ ...profile, city: trimmed, lat: latitude, lng: longitude });
      setShowCityModal(false);
    } catch (err) {
      setCityError(
        err instanceof Error ? err.message : t("profile.failedToSaveCity")
      );
    } finally {
      setIsSavingCity(false);
    }
  }

  async function handleUseMyLocation() {
    if (!profile?.id) return;
    setIsDetectingLocation(true);
    setCityError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setCityError(t("profile.locationPermissionDenied"));
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      const [place] = await Location.reverseGeocodeAsync({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      const cityName = place.city ?? place.region ?? place.subregion ?? "";
      if (!cityName) {
        setCityError(t("profile.cityNotFound"));
        return;
      }
      const { error } = await supabase
        .from("profiles")
        .update({ city: cityName, lat: loc.coords.latitude, lng: loc.coords.longitude })
        .eq("id", profile.id);
      if (error) throw error;
      setProfile({ ...profile, city: cityName, lat: loc.coords.latitude, lng: loc.coords.longitude });
      setShowCityModal(false);
    } catch (err) {
      setCityError(err instanceof Error ? err.message : t("profile.failedToSaveCity"));
    } finally {
      setIsDetectingLocation(false);
    }
  }

  function handleOpenUrl(url: string) {
    Linking.openURL(url).catch(() =>
      Alert.alert(t("common.error"), t("profile.couldNotOpenUrl"))
    );
  }

  function handleChangeAvatar() {
    Alert.alert(t("profile.changePhoto"), "", [
      { text: t("common.takePhoto"), onPress: () => pickAndUploadAvatar("camera") },
      { text: t("common.chooseFromGallery"), onPress: () => pickAndUploadAvatar("gallery") },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  }

  async function pickAndUploadAvatar(source: "camera" | "gallery") {
    if (!profile) return;

    let result: ImagePicker.ImagePickerResult;
    if (source === "camera") {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") return;
      result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") return;
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
    }

    if (result.canceled || !result.assets[0]) return;

    setIsUploadingAvatar(true);
    try {
      const filename = `avatar_${Date.now()}.jpg`;
      const destUri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.copyAsync({ from: result.assets[0].uri, to: destUri });
      const base64 = await compressImage(destUri);

      const byteCharacters = atob(base64);
      const byteArray = new Uint8Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteArray[i] = byteCharacters.charCodeAt(i);
      }

      const storagePath = `${profile.id}/avatar.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(storagePath, byteArray, { contentType: "image/jpeg", upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(storagePath);
      const avatarUrl = urlData.publicUrl;

      const { error: profileError } = await supabase
        .from("profiles")
        .update({ avatar_url: avatarUrl })
        .eq("id", profile.id);
      if (profileError) throw profileError;

      const { error: upError } = await supabase
        .from("user_profiles")
        .upsert({ id: profile.id, avatar_url: avatarUrl }, { onConflict: "id" });
      if (upError) throw upError;

      setProfile({ ...profile, avatar_url: avatarUrl });
      Alert.alert("", t("profile.photoUpdated"));
    } catch (err) {
      Alert.alert(
        t("common.error"),
        err instanceof Error ? err.message : t("profile.photoUpdateFailed")
      );
    } finally {
      setIsUploadingAvatar(false);
    }
  }

  // User initials for avatar placeholder
  const initials = profile?.display_name
    ? profile.display_name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* ── User info card ──────────────────────────────────────────────── */}
      <Text style={styles.pageTitle}>{t("profile.profile")}</Text>

      <View style={styles.userCard}>
        <TouchableOpacity
          onPress={handleChangeAvatar}
          disabled={isUploadingAvatar}
          activeOpacity={0.8}
          accessibilityLabel={t("profile.tapToChangePhoto")}
          accessibilityRole="button"
          style={styles.avatarWrapper}
        >
          {isUploadingAvatar ? (
            <View style={styles.avatar}>
              <ActivityIndicator color={COLORS.primary} />
            </View>
          ) : profile?.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          )}
          {!isUploadingAvatar && (
            <View style={styles.avatarCameraBadge}>
              <Camera size={10} color="#fff" />
            </View>
          )}
        </TouchableOpacity>
        <View style={styles.userInfo}>
          <TouchableOpacity
            style={styles.displayNameRow}
            onPress={handleEditName}
            activeOpacity={0.7}
            accessibilityLabel={t("profile.editName")}
            accessibilityRole="button"
          >
            <Text style={styles.displayName}>
              {profile?.display_name ?? "User"}
            </Text>
            <Pencil size={13} color={COLORS.textSecondary} />
          </TouchableOpacity>
          <Text style={styles.email}>
            {profile?.subscription === "pro" ? t("profile.proPlan") : t("profile.freePlan")}
          </Text>
        </View>
        {profile?.subscription === "pro" && (
          <View style={styles.proBadge}>
            <Text style={styles.proBadgeText}>PRO</Text>
          </View>
        )}
      </View>

      {/* ── Subscription card ─────────────────────────────────────────────── */}
      {isPro ? (
        <View style={styles.proCard}>
          <View style={styles.proCardLeft}>
            <Crown size={20} color="#FFD700" />
            <View>
              <Text style={styles.proCardTitle}>{t("profile.greenThumbPro")}</Text>
              <Text style={styles.proCardSub}>{t("profile.activeSubscription")}</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.manageButton}
            onPress={() => {
              const url = Platform.OS === "android"
                ? "https://play.google.com/store/account/subscriptions"
                : "https://apps.apple.com/account/subscriptions";
              Linking.openURL(url).catch(() => {});
            }}
            accessibilityLabel={t("profile.manage")}
          >
            <Text style={styles.manageButtonText}>{t("profile.manage")}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={styles.upgradeCard}
          onPress={() => router.push("/paywall")}
          activeOpacity={0.85}
          accessibilityLabel={t("profile.upgradeToPro")}
          accessibilityRole="button"
        >
          <Crown size={20} color={COLORS.primary} />
          <View style={styles.upgradeCardText}>
            <Text style={styles.upgradeCardTitle}>{t("profile.upgradeToPro")}</Text>
            <Text style={styles.upgradeCardSub}>
              {t("profile.unlimitedPlantsAI")}
            </Text>
          </View>
          <Text style={styles.upgradeArrow}>›</Text>
        </TouchableOpacity>
      )}

      {/* ── My Garden (Community) ─────────────────────────────────────────── */}
      <Text style={styles.sectionTitle}>{t("community.myGarden")}</Text>
      <View style={styles.settingsCard}>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => router.push({ pathname: "/community/profile/[id]", params: { id: profile?.id ?? "" } })}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <View style={styles.settingRowLeft}>
            <View style={styles.settingIconWrap}>
              <Users size={18} color={COLORS.primary} />
            </View>
            <Text style={styles.settingLabel}>{t("community.viewMyProfile")}</Text>
          </View>
          <Text style={styles.settingChevron}>›</Text>
        </TouchableOpacity>

        <View style={styles.rowDivider} />

        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => {
            if (!isPro) { router.push("/paywall"); return; }
            router.push("/community/new-post");
          }}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <View style={styles.settingRowLeft}>
            <View style={styles.settingIconWrap}>
              <Camera size={18} color={COLORS.primary} />
            </View>
            <Text style={styles.settingLabel}>{t("community.shareAPost")}</Text>
          </View>
          <Text style={styles.settingChevron}>›</Text>
        </TouchableOpacity>
      </View>

      {/* ── Notification settings ─────────────────────────────────────────── */}
      <NotificationSettings />

      {/* ── App settings ──────────────────────────────────────────────────── */}
      <Text style={styles.sectionTitle}>{t("profile.appSettings")}</Text>
      <View style={styles.settingsCard}>
        <SettingRow
          icon={
            isSavingCity ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <MapPin size={18} color={COLORS.primary} />
            )
          }
          label={t("profile.cityLocation")}
          value={profile?.city ?? t("profile.notSet")}
          onPress={handleEditCity}
        />

        <View style={styles.rowDivider} />

        <SettingRow
          icon={<Ruler size={18} color={COLORS.primary} />}
          label={t("profile.measurementUnits")}
          value={profile?.units === 'imperial' ? t("profile.imperial") : t("profile.metric")}
          onPress={handleToggleUnits}
        />

        <View style={styles.rowDivider} />

        <SettingRow
          icon={<Info size={18} color={COLORS.primary} />}
          label={t("profile.aboutGreenThumb")}
          value={`v${APP_VERSION}`}
        />

        <View style={styles.rowDivider} />

        <SettingRow
          icon={<Shield size={18} color={COLORS.primary} />}
          label={t("profile.privacyPolicy")}
          onPress={() =>
            handleOpenUrl("https://greenthumb.app/privacy")
          }
        />

        <View style={styles.rowDivider} />

        <SettingRow
          icon={<FileText size={18} color={COLORS.primary} />}
          label={t("profile.termsOfService")}
          onPress={() =>
            handleOpenUrl("https://greenthumb.app/terms")
          }
        />
      </View>

      {/* ── Sign out ─────────────────────────────────────────────────────── */}
      <Pressable
        style={styles.signOutButton}
        onPress={handleSignOut}
        disabled={isSigningOut}
        accessibilityLabel={t("profile.signOut")}
        accessibilityRole="button"
      >
        {isSigningOut ? (
          <ActivityIndicator color={COLORS.danger} />
        ) : (
          <>
            <LogOut size={20} color={COLORS.danger} />
            <Text style={styles.signOutText}>{t("profile.signOut")}</Text>
          </>
        )}
      </Pressable>

      {/* ── Name edit modal ──────────────────────────────────────────────── */}
      <Modal
        visible={showNameModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowNameModal(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setShowNameModal(false)}
          >
            <Pressable style={styles.modalCard} onPress={() => {}}>
              <Text style={styles.modalTitle}>{t("profile.updateName")}</Text>
              <TextInput
                style={[styles.modalInput, { marginTop: 16 }]}
                value={nameInput}
                onChangeText={setNameInput}
                placeholder={t("profile.namePlaceholder")}
                placeholderTextColor={COLORS.textSecondary}
                returnKeyType="done"
                autoFocus
                onSubmitEditing={handleSaveName}
                maxLength={50}
              />
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setShowNameModal(false)}
                  disabled={isSavingName}
                >
                  <Text style={styles.modalCancelText}>{t("common.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modalSaveBtn,
                    (!nameInput.trim() || isSavingName) && styles.modalSaveBtnDisabled,
                  ]}
                  onPress={handleSaveName}
                  disabled={!nameInput.trim() || isSavingName}
                >
                  {isSavingName ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.modalSaveText}>{t("common.save")}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── City edit modal ──────────────────────────────────────────────── */}
      <Modal
        visible={showCityModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCityModal(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setShowCityModal(false)}
          >
            <Pressable style={styles.modalCard} onPress={() => {}}>
              <Text style={styles.modalTitle}>{t("profile.updateCity")}</Text>

              <TouchableOpacity
                style={[
                  styles.locationBtn,
                  (isDetectingLocation || isSavingCity) && styles.locationBtnDisabled,
                ]}
                onPress={handleUseMyLocation}
                disabled={isDetectingLocation || isSavingCity}
              >
                {isDetectingLocation ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <MapPin size={16} color="#fff" />
                )}
                <Text style={styles.locationBtnText}>
                  {isDetectingLocation
                    ? t("profile.detectingLocation")
                    : t("profile.useMyLocation")}
                </Text>
              </TouchableOpacity>

              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>{t("profile.orEnterManually")}</Text>
                <View style={styles.dividerLine} />
              </View>

              <TextInput
                style={styles.modalInput}
                value={cityInput}
                onChangeText={setCityInput}
                placeholder={t("profile.cityPlaceholder")}
                placeholderTextColor={COLORS.textSecondary}
                returnKeyType="done"
                onSubmitEditing={handleSaveCity}
              />

              {cityError ? (
                <Text style={styles.modalError}>{cityError}</Text>
              ) : null}

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setShowCityModal(false)}
                  disabled={isDetectingLocation || isSavingCity}
                >
                  <Text style={styles.modalCancelText}>{t("common.cancel")}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.modalSaveBtn,
                    (!cityInput.trim() || isSavingCity || isDetectingLocation) && styles.modalSaveBtnDisabled,
                  ]}
                  onPress={handleSaveCity}
                  disabled={!cityInput.trim() || isSavingCity || isDetectingLocation}
                >
                  {isSavingCity ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.modalSaveText}>{t("common.save")}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.cream,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 64,
    paddingBottom: 100,
    gap: 16,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.primary,
    letterSpacing: -0.5,
    marginBottom: 4,
  },

  // ── User card ─────────────────────────────────────────────────────────────
  userCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
    marginBottom: 8,
  },
  avatarWrapper: {
    position: "relative",
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.lightgreen,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImage: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  avatarCameraBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  avatarText: {
    fontSize: 20,
    fontWeight: "700",
    color: COLORS.primary,
  },
  userInfo: {
    flex: 1,
  },
  displayNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  displayName: {
    fontSize: 17,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  email: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  proBadge: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  proBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 1,
  },

  // ── Subscription cards ────────────────────────────────────────────────────
  proCard: {
    backgroundColor: COLORS.primary,
    borderRadius: 20,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  proCardLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  proCardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
  },
  proCardSub: {
    fontSize: 12,
    color: "rgba(255,255,255,0.75)",
    marginTop: 1,
  },
  manageButton: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  manageButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
  },
  upgradeCard: {
    backgroundColor: COLORS.lightgreen,
    borderRadius: 20,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  upgradeCardText: {
    flex: 1,
  },
  upgradeCardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.primary,
  },
  upgradeCardSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 1,
  },
  upgradeArrow: {
    fontSize: 22,
    color: COLORS.primary,
    fontWeight: "300",
  },

  // ── Section title ─────────────────────────────────────────────────────────
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: -8,
    marginLeft: 4,
  },

  // ── Settings card ─────────────────────────────────────────────────────────
  settingsCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
  },
  settingRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  settingIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: COLORS.lightgreen,
    alignItems: "center",
    justifyContent: "center",
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: "500",
    color: COLORS.textPrimary,
  },
  settingValue: {
    fontSize: 14,
    color: COLORS.textSecondary,
    maxWidth: 120,
    textAlign: "right",
  },
  settingChevron: {
    fontSize: 20,
    color: COLORS.textSecondary,
    fontWeight: "300",
  },
  rowDivider: {
    height: 1,
    backgroundColor: "#F3F4F6",
  },

  // ── Sign out ─────────────────────────────────────────────────────────────
  signOutButton: {
    backgroundColor: "#fff",
    borderRadius: 20,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
    marginTop: 8,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.danger,
  },

  // ── City modal ──────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 24,
    width: "85%",
    maxWidth: 360,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: "#F9FAFB",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  modalError: {
    fontSize: 13,
    color: COLORS.danger,
    marginTop: 8,
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 20,
  },
  modalCancelBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  modalSaveBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 12,
  },
  modalSaveBtnDisabled: {
    opacity: 0.5,
  },
  modalSaveText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
  locationBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 4,
  },
  locationBtnDisabled: {
    opacity: 0.5,
  },
  locationBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 14,
    gap: 8,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.border,
  },
  dividerText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
});

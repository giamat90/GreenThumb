import { useState } from "react";
import {
  View,
  Text,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert,
  StyleSheet,
  Linking,
  Platform,
} from "react-native";
import { LogOut, MapPin, Info, Shield, FileText, Crown } from "lucide-react-native";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { supabase } from "@/lib/supabase";
import { useUserStore } from "@/store/user";
import { COLORS } from "@/constants";
import { NotificationSettings } from "@/components/ui/NotificationSettings";

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

  function handleEditCity() {
    Alert.prompt(
      t("profile.updateCity"),
      t("profile.enterCity"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.save"),
          onPress: async (city) => {
            if (!city?.trim() || !profile?.id) return;
            setIsSavingCity(true);
            try {
              const { error } = await supabase
                .from("profiles")
                .update({ city: city.trim() })
                .eq("id", profile.id);
              if (error) throw error;
              setProfile({ ...profile, city: city.trim() });
            } catch (err) {
              Alert.alert(
                t("common.error"),
                err instanceof Error ? err.message : t("profile.failedToSaveCity")
              );
            } finally {
              setIsSavingCity(false);
            }
          },
        },
      ],
      "plain-text",
      profile?.city ?? ""
    );
  }

  function handleOpenUrl(url: string) {
    Linking.openURL(url).catch(() =>
      Alert.alert(t("common.error"), t("profile.couldNotOpenUrl"))
    );
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
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.displayName}>
            {profile?.display_name ?? "User"}
          </Text>
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
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.lightgreen,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 20,
    fontWeight: "700",
    color: COLORS.primary,
  },
  userInfo: {
    flex: 1,
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
});

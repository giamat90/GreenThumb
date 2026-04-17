import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import {
  View,
  Text,
  Switch,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  Modal,
  Platform,
} from "react-native";
import type { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Bell, CalendarDays, Clock, Heart, RefreshCw } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { COLORS } from "@/constants";
import { useProGate } from "@/hooks/useProGate";
import { supabase } from "@/lib/supabase";
import { useUserStore } from "@/store/user";
import { UpgradeModal } from "@/components/ui/UpgradeModal";
import { usePlantsStore } from "@/store/plants";
import {
  scheduleAllReminders,
  cancelAllReminders,
  sendImmediateNotification,
} from "@/lib/notifications";
import {
  requestCalendarPermission,
  getOrCreateGreenThumbCalendar,
  syncPlantEvents,
  deleteGreenThumbEvents,
} from "@/lib/calendarSync";

const NOTIFICATIONS_ENABLED_KEY = "notifications_enabled";
const REMINDER_TIME_KEY = "reminder_time";
const REMINDER_MINUTES_KEY = "reminder_minutes";
const CALENDAR_SYNC_ENABLED_KEY = "calendarSyncEnabled";
const CALENDAR_LAST_SYNCED_KEY = "calendarLastSynced";

function formatTime(hour: number, minute: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const h = hour % 12 || 12;
  const m = minute.toString().padStart(2, "0");
  return `${h}:${m} ${period}`;
}

/** Builds a Date object set to today at the given hour/minute. */
function buildPickerDate(hour: number, minute: number): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

export function NotificationSettings() {
  const { t } = useTranslation();
  const router = useRouter();
  const { requirePro, upgradeModalVisible, lockedFeatureName, closeUpgradeModal } = useProGate();
  const [enabled, setEnabled] = useState(true);
  const [reminderHour, setReminderHour] = useState(9);
  const [reminderMinute, setReminderMinute] = useState(0);
  const [isRescheduling, setIsRescheduling] = useState(false);
  // Android: whether the native dialog is open; iOS: whether the inline picker shows
  const [showPicker, setShowPicker] = useState(false);
  const { plants } = usePlantsStore();

  // ── Calendar sync state ────────────────────────────────────────────────────
  const [calendarEnabled, setCalendarEnabled] = useState(false);
  const [calendarSyncing, setCalendarSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  // ── Community notifications state ──────────────────────────────────────────
  const { profile, setProfile } = useUserStore();
  const [communityEnabled, setCommunityEnabled] = useState(true);
  const [isSavingCommunity, setIsSavingCommunity] = useState(false);

  // Load persisted preferences on mount (and re-sync when profile loads)
  useEffect(() => {
    async function load() {
      const [enabledRaw, hourRaw, minuteRaw, calRaw, lastRaw] = await Promise.all([
        AsyncStorage.getItem(NOTIFICATIONS_ENABLED_KEY),
        AsyncStorage.getItem(REMINDER_TIME_KEY),
        AsyncStorage.getItem(REMINDER_MINUTES_KEY),
        AsyncStorage.getItem(CALENDAR_SYNC_ENABLED_KEY),
        AsyncStorage.getItem(CALENDAR_LAST_SYNCED_KEY),
      ]);
      setEnabled(enabledRaw !== "false");
      if (hourRaw) setReminderHour(parseInt(hourRaw, 10));
      if (minuteRaw) setReminderMinute(parseInt(minuteRaw, 10));
      setCalendarEnabled(calRaw === "true");
      setLastSynced(lastRaw);
      setCommunityEnabled(profile?.community_notifications !== false);
    }
    load();
  }, [profile]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleToggle(value: boolean) {
    setEnabled(value);
    await AsyncStorage.setItem(NOTIFICATIONS_ENABLED_KEY, value ? "true" : "false");

    if (!value) {
      setShowPicker(false);
      await cancelAllReminders();
    } else {
      setIsRescheduling(true);
      try {
        await scheduleAllReminders(plants);
      } catch (err) {
        console.warn("NotificationSettings: reschedule failed", err);
      } finally {
        setIsRescheduling(false);
      }
    }
  }

  async function applyNewTime(hour: number, minute: number) {
    setReminderHour(hour);
    setReminderMinute(minute);
    await Promise.all([
      AsyncStorage.setItem(REMINDER_TIME_KEY, String(hour)),
      AsyncStorage.setItem(REMINDER_MINUTES_KEY, String(minute)),
    ]);

    if (!enabled) return;

    setIsRescheduling(true);
    try {
      await scheduleAllReminders(plants);
    } catch (err) {
      console.warn("NotificationSettings: reschedule after time change failed", err);
    } finally {
      setIsRescheduling(false);
    }
  }

  function handlePickerChange(_event: DateTimePickerEvent, selected?: Date) {
    // On Android the dialog closes automatically after selection or dismissal.
    if (Platform.OS === "android") setShowPicker(false);
    if (selected) {
      applyNewTime(selected.getHours(), selected.getMinutes());
    }
  }

  async function runCalendarSync() {
    setCalendarSyncing(true);
    try {
      const count = await syncPlantEvents(plants);
      const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setLastSynced(now);
      await AsyncStorage.setItem(CALENDAR_LAST_SYNCED_KEY, now);
      Alert.alert(t("calendar.calendarSync"), t("calendar.calendarSyncSuccess", { count }));
    } catch {
      Alert.alert(t("common.error"), t("calendar.calendarSyncFailed"));
    } finally {
      setCalendarSyncing(false);
    }
  }

  async function handleCommunityToggle(value: boolean) {
    if (!profile?.id) return;
    setCommunityEnabled(value);
    setIsSavingCommunity(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ community_notifications: value })
        .eq("id", profile.id);
      if (error) throw error;
      setProfile({ ...profile, community_notifications: value });
    } catch (err) {
      // Revert on failure
      setCommunityEnabled(!value);
      console.warn("NotificationSettings: failed to save community_notifications", err);
    } finally {
      setIsSavingCommunity(false);
    }
  }

  async function handleCalendarToggle(value: boolean) {
    if (value && !requirePro(t("paywall.featureCalendar"))) return;

    if (value) {
      const granted = await requestCalendarPermission();
      if (!granted) {
        Alert.alert(
          t("calendar.calendarPermission"),
          t("calendar.calendarPermissionDenied"),
          [
            { text: t("common.cancel"), style: "cancel" },
            { text: t("common.openSettings"), onPress: () => Linking.openSettings() },
          ]
        );
        return; // do not enable
      }
      try {
        await getOrCreateGreenThumbCalendar();
      } catch {
        Alert.alert(t("common.error"), t("calendar.calendarSyncFailed"));
        return;
      }
      setCalendarEnabled(true);
      await AsyncStorage.setItem(CALENDAR_SYNC_ENABLED_KEY, "true");
      await runCalendarSync();
    } else {
      setCalendarEnabled(false);
      await AsyncStorage.setItem(CALENDAR_SYNC_ENABLED_KEY, "false");
      setLastSynced(null);
      await AsyncStorage.removeItem(CALENDAR_LAST_SYNCED_KEY);
      try {
        await deleteGreenThumbEvents();
        Alert.alert(t("calendar.calendarSync"), t("calendar.calendarDisabled"));
      } catch {
        // best-effort
      }
    }
  }

  async function handleTestNotification() {
    try {
      await sendImmediateNotification(
        "💧 Test Notification",
        "GreenThumb notifications are working!"
      );
      Alert.alert(t("profile.sent"), t("profile.checkNotificationShade"));
    } catch (err) {
      Alert.alert(t("common.error"), t("profile.couldNotSendTest"));
      console.warn("NotificationSettings: test notification failed", err);
    }
  }

  const pickerDate = buildPickerDate(reminderHour, reminderMinute);

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>{t("notifications.wateringReminders")}</Text>

      {/* ── Watering reminders toggle ──────────────────────────────────────── */}
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowLeft}>
            <View style={styles.iconWrap}>
              <Bell size={18} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{t("notifications.wateringReminders")}</Text>
              <Text style={styles.rowSubLabel}>
                {t("notifications.getNotified")}
              </Text>
            </View>
          </View>
          {isRescheduling ? (
            <ActivityIndicator size="small" color={COLORS.primary} />
          ) : (
            <Switch
              value={enabled}
              onValueChange={handleToggle}
              trackColor={{ false: "#E5E7EB", true: COLORS.secondary }}
              thumbColor="#fff"
              accessibilityLabel="Toggle watering reminders"
            />
          )}
        </View>

        {/* ── Reminder time picker ───────────────────────────────────────── */}
        {enabled && (
          <>
            <View style={styles.divider} />
            <TouchableOpacity
              style={styles.timeRow}
              onPress={() => setShowPicker(true)}
              accessibilityLabel={`Change reminder time, currently ${formatTime(reminderHour, reminderMinute)}`}
              accessibilityRole="button"
            >
              <View style={styles.rowLeft}>
                <View style={styles.iconWrap}>
                  <Clock size={18} color={COLORS.primary} />
                </View>
                <Text style={styles.rowLabel}>{t("notifications.reminderTime")}</Text>
              </View>
              <View style={styles.timeDisplay}>
                <Text style={styles.timeText}>
                  {formatTime(reminderHour, reminderMinute)}
                </Text>
              </View>
            </TouchableOpacity>

            {/* Android: render the picker only when active (it opens as a dialog).
                Lazy require avoids the "Platform is undefined" crash that occurs
                when the module is imported at the top level before RN is ready. */}
            {Platform.OS === "android" && showPicker && (() => {
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const DateTimePicker = require("@react-native-community/datetimepicker").default;
              return (
                <DateTimePicker
                  value={pickerDate}
                  mode="time"
                  is24Hour={false}
                  onChange={handlePickerChange}
                />
              );
            })()}

            {/* iOS: show an inline picker inside a modal */}
            {Platform.OS === "ios" && (
              <Modal
                visible={showPicker}
                transparent
                animationType="slide"
                onRequestClose={() => setShowPicker(false)}
              >
                <View style={styles.iosModalBackdrop}>
                  <View style={styles.iosPickerSheet}>
                    <View style={styles.iosPickerHeader}>
                      <Text style={styles.iosPickerTitle}>{t("notifications.reminderTime")}</Text>
                      <TouchableOpacity
                        onPress={() => setShowPicker(false)}
                        accessibilityLabel={t("common.done")}
                        accessibilityRole="button"
                      >
                        <Text style={styles.iosDoneButton}>{t("common.done")}</Text>
                      </TouchableOpacity>
                    </View>
                    {(() => {
                      // eslint-disable-next-line @typescript-eslint/no-var-requires
                      const DateTimePicker = require("@react-native-community/datetimepicker").default;
                      return (
                        <DateTimePicker
                          value={pickerDate}
                          mode="time"
                          display="spinner"
                          onChange={handlePickerChange}
                          style={styles.iosPicker}
                        />
                      );
                    })()}
                  </View>
                </View>
              </Modal>
            )}
          </>
        )}
      </View>

      {/* ── Community Notifications section ───────────────────────────────── */}
      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>{t("community.tab")}</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowLeft}>
            <View style={styles.iconWrap}>
              <Heart size={18} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{t("notifications.communityNotifications")}</Text>
              <Text style={styles.rowSubLabel}>
                {t("notifications.communityNotificationsDesc")}
              </Text>
            </View>
          </View>
          {isSavingCommunity ? (
            <ActivityIndicator size="small" color={COLORS.primary} />
          ) : (
            <Switch
              value={communityEnabled}
              onValueChange={handleCommunityToggle}
              trackColor={{ false: "#E5E7EB", true: COLORS.secondary }}
              thumbColor="#fff"
              accessibilityLabel="Toggle community notifications"
            />
          )}
        </View>
      </View>

      {/* ── Calendar Sync section ─────────────────────────────────────────── */}
      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>{t("calendar.calendarSync")}</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowLeft}>
            <View style={styles.iconWrap}>
              <CalendarDays size={18} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{t("calendar.calendarSync")}</Text>
              <Text style={styles.rowSubLabel}>{t("calendar.calendarSyncDesc")}</Text>
            </View>
          </View>
          {calendarSyncing ? (
            <ActivityIndicator size="small" color={COLORS.primary} />
          ) : (
            <Switch
              value={calendarEnabled}
              onValueChange={handleCalendarToggle}
              trackColor={{ false: "#E5E7EB", true: COLORS.secondary }}
              thumbColor="#fff"
              accessibilityLabel={t("calendar.calendarSync")}
            />
          )}
        </View>

        {calendarEnabled && (
          <>
            <View style={styles.divider} />
            <TouchableOpacity
              style={styles.timeRow}
              onPress={runCalendarSync}
              disabled={calendarSyncing}
              accessibilityRole="button"
              accessibilityLabel={t("calendar.syncNow")}
            >
              <View style={styles.rowLeft}>
                <View style={styles.iconWrap}>
                  <RefreshCw size={18} color={COLORS.primary} />
                </View>
                <View>
                  <Text style={styles.rowLabel}>{t("calendar.syncNow")}</Text>
                  {lastSynced && (
                    <Text style={styles.rowSubLabel}>
                      {t("calendar.lastSynced", { time: lastSynced })}
                    </Text>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* ── Test notification (dev only) ───────────────────────────────────── */}
      {__DEV__ && (
        <TouchableOpacity
          style={styles.testButton}
          onPress={handleTestNotification}
          accessibilityLabel="Send test notification"
          accessibilityRole="button"
        >
          <Text style={styles.testButtonText}>{t("notifications.sendTest")}</Text>
        </TouchableOpacity>
      )}

      <UpgradeModal
        visible={upgradeModalVisible}
        featureName={lockedFeatureName}
        onClose={closeUpgradeModal}
        onUpgrade={() => {
          closeUpgradeModal();
          router.push("/paywall");
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: COLORS.lightgreen,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textPrimary,
  },
  rowSubLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 1,
  },
  divider: {
    height: 1,
    backgroundColor: "#F3F4F6",
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
  },
  timeDisplay: {
    backgroundColor: COLORS.lightgreen,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  timeText: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.primary,
  },

  // ── iOS modal picker ──────────────────────────────────────────────────────
  iosModalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  iosPickerSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 32,
  },
  iosPickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  iosPickerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  iosDoneButton: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.primary,
  },
  iosPicker: {
    height: 200,
  },
  testButton: {
    marginTop: 12,
    backgroundColor: "#FEF3C7",
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  testButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#92400E",
  },
});

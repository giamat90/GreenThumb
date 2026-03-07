import { useEffect, useState } from "react";
import {
  View,
  Text,
  Switch,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  Modal,
  Platform,
} from "react-native";
import type { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Bell, Clock } from "lucide-react-native";

import { COLORS } from "@/constants";
import { usePlantsStore } from "@/store/plants";
import {
  scheduleAllReminders,
  cancelAllReminders,
  sendImmediateNotification,
} from "@/lib/notifications";

const NOTIFICATIONS_ENABLED_KEY = "notifications_enabled";
const REMINDER_TIME_KEY = "reminder_time";
const REMINDER_MINUTES_KEY = "reminder_minutes";

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
  const [enabled, setEnabled] = useState(true);
  const [reminderHour, setReminderHour] = useState(9);
  const [reminderMinute, setReminderMinute] = useState(0);
  const [isRescheduling, setIsRescheduling] = useState(false);
  // Android: whether the native dialog is open; iOS: whether the inline picker shows
  const [showPicker, setShowPicker] = useState(false);
  const { plants } = usePlantsStore();

  // Load persisted preferences on mount
  useEffect(() => {
    async function load() {
      const [enabledRaw, hourRaw, minuteRaw] = await Promise.all([
        AsyncStorage.getItem(NOTIFICATIONS_ENABLED_KEY),
        AsyncStorage.getItem(REMINDER_TIME_KEY),
        AsyncStorage.getItem(REMINDER_MINUTES_KEY),
      ]);
      setEnabled(enabledRaw !== "false");
      if (hourRaw) setReminderHour(parseInt(hourRaw, 10));
      if (minuteRaw) setReminderMinute(parseInt(minuteRaw, 10));
    }
    load();
  }, []);

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

  async function handleTestNotification() {
    try {
      await sendImmediateNotification(
        "💧 Test Notification",
        "GreenThumb notifications are working!"
      );
      Alert.alert("Sent!", "Check your notification shade.");
    } catch (err) {
      Alert.alert("Error", "Could not send test notification.");
      console.warn("NotificationSettings: test notification failed", err);
    }
  }

  const pickerDate = buildPickerDate(reminderHour, reminderMinute);

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Notifications</Text>

      {/* ── Watering reminders toggle ──────────────────────────────────────── */}
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowLeft}>
            <View style={styles.iconWrap}>
              <Bell size={18} color={COLORS.primary} />
            </View>
            <View>
              <Text style={styles.rowLabel}>Watering Reminders</Text>
              <Text style={styles.rowSubLabel}>
                Get notified when plants need water
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
                <Text style={styles.rowLabel}>Reminder Time</Text>
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
                      <Text style={styles.iosPickerTitle}>Reminder Time</Text>
                      <TouchableOpacity
                        onPress={() => setShowPicker(false)}
                        accessibilityLabel="Done"
                        accessibilityRole="button"
                      >
                        <Text style={styles.iosDoneButton}>Done</Text>
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

      {/* ── Test notification (dev only) ───────────────────────────────────── */}
      {__DEV__ && (
        <TouchableOpacity
          style={styles.testButton}
          onPress={handleTestNotification}
          accessibilityLabel="Send test notification"
          accessibilityRole="button"
        >
          <Text style={styles.testButtonText}>🔔 Send Test Notification</Text>
        </TouchableOpacity>
      )}
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

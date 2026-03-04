import { useEffect, useState } from "react";
import {
  View,
  Text,
  Switch,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
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

// Reminder time options shown in the selector
const REMINDER_TIMES: { label: string; hour: number }[] = [
  { label: "8:00 AM", hour: 8 },
  { label: "9:00 AM", hour: 9 },
  { label: "10:00 AM", hour: 10 },
  { label: "6:00 PM", hour: 18 },
];

export function NotificationSettings() {
  const [enabled, setEnabled] = useState(true);
  const [reminderHour, setReminderHour] = useState(9);
  const [isRescheduling, setIsRescheduling] = useState(false);
  const { plants } = usePlantsStore();

  // Load persisted preferences on mount
  useEffect(() => {
    async function load() {
      const [enabledRaw, hourRaw] = await Promise.all([
        AsyncStorage.getItem(NOTIFICATIONS_ENABLED_KEY),
        AsyncStorage.getItem(REMINDER_TIME_KEY),
      ]);
      setEnabled(enabledRaw !== "false");
      if (hourRaw) setReminderHour(parseInt(hourRaw, 10));
    }
    load();
  }, []);

  async function handleToggle(value: boolean) {
    setEnabled(value);
    await AsyncStorage.setItem(NOTIFICATIONS_ENABLED_KEY, value ? "true" : "false");

    if (!value) {
      await cancelAllReminders();
    } else {
      // Reschedule all reminders when re-enabling
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

  async function handleTimeSelect(hour: number) {
    setReminderHour(hour);
    await AsyncStorage.setItem(REMINDER_TIME_KEY, String(hour));

    if (!enabled) return;

    // Re-schedule everything at the new time
    setIsRescheduling(true);
    try {
      await scheduleAllReminders(plants);
    } catch (err) {
      console.warn("NotificationSettings: reschedule after time change failed", err);
    } finally {
      setIsRescheduling(false);
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

        {/* ── Reminder time selector ─────────────────────────────────────── */}
        {enabled && (
          <>
            <View style={styles.divider} />
            <View style={styles.timeSelectorRow}>
              <View style={styles.rowLeft}>
                <View style={styles.iconWrap}>
                  <Clock size={18} color={COLORS.primary} />
                </View>
                <Text style={styles.rowLabel}>Reminder Time</Text>
              </View>
            </View>
            <View style={styles.timeOptions}>
              {REMINDER_TIMES.map((opt) => {
                const selected = opt.hour === reminderHour;
                return (
                  <TouchableOpacity
                    key={opt.hour}
                    style={[
                      styles.timeChip,
                      selected && styles.timeChipSelected,
                    ]}
                    onPress={() => handleTimeSelect(opt.hour)}
                    accessibilityLabel={`Set reminder time to ${opt.label}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                  >
                    <Text
                      style={[
                        styles.timeChipText,
                        selected && styles.timeChipTextSelected,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
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
  timeSelectorRow: {
    paddingVertical: 14,
    paddingBottom: 8,
  },
  timeOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingBottom: 14,
  },
  timeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#F3F4F6",
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  timeChipSelected: {
    backgroundColor: COLORS.lightgreen,
    borderColor: COLORS.secondary,
  },
  timeChipText: {
    fontSize: 13,
    fontWeight: "500",
    color: COLORS.textSecondary,
  },
  timeChipTextSelected: {
    color: COLORS.primary,
    fontWeight: "700",
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

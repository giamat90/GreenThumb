import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Plant } from "@/types";

const NOTIFICATION_IDS_KEY = "notification_ids";
const FERTILIZER_NOTIFICATION_IDS_KEY = "fertilizer_notification_ids";
const REMINDER_TIME_KEY = "reminder_time";
const REMINDER_MINUTES_KEY = "reminder_minutes";
const NOTIFICATIONS_ENABLED_KEY = "notifications_enabled";

// ─── Types ───────────────────────────────────────────────────────────────────

type NotificationIdMap = Record<string, string>; // plantId → notificationId

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function loadNotificationIds(): Promise<NotificationIdMap> {
  try {
    const raw = await AsyncStorage.getItem(NOTIFICATION_IDS_KEY);
    return raw ? (JSON.parse(raw) as NotificationIdMap) : {};
  } catch {
    return {};
  }
}

async function saveNotificationIds(map: NotificationIdMap): Promise<void> {
  await AsyncStorage.setItem(NOTIFICATION_IDS_KEY, JSON.stringify(map));
}

/** Returns the user-preferred reminder hour and minute (default 9:00 AM). */
async function getReminderTime(): Promise<{ hour: number; minute: number }> {
  try {
    const [hourRaw, minuteRaw] = await Promise.all([
      AsyncStorage.getItem(REMINDER_TIME_KEY),
      AsyncStorage.getItem(REMINDER_MINUTES_KEY),
    ]);
    return {
      hour: hourRaw ? parseInt(hourRaw, 10) : 9,
      minute: minuteRaw ? parseInt(minuteRaw, 10) : 0,
    };
  } catch {
    return { hour: 9, minute: 0 };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Schedules a local notification for a single plant's next_watering date.
 * Fires at the user's preferred reminder hour (default 9 AM).
 *
 * Returns the Expo notification identifier string so it can be stored and
 * cancelled later when the plant is watered or deleted.
 */
export async function scheduleWateringReminder(plant: Plant): Promise<string | null> {
  if (!plant.next_watering) return null;

  const nextWateringDate = new Date(plant.next_watering);
  const now = new Date();

  // Only schedule if the watering date is in the future
  if (nextWateringDate <= now) return null;

  const { hour, minute } = await getReminderTime();

  // Build the trigger date: same date as next_watering but at the preferred time
  const triggerDate = new Date(nextWateringDate);
  triggerDate.setHours(hour, minute, 0, 0);

  // If setting the hour pushed the trigger into the past, skip it
  if (triggerDate <= now) return null;

  try {
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: `💧 Time to water ${plant.name}!`,
        body: `Your ${plant.common_name ?? plant.species ?? "plant"} is ready for a drink.`,
        data: { plantId: plant.id, type: "watering" },
        sound: "default",
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: triggerDate,
      },
    });
    return identifier;
  } catch (err) {
    console.warn(`notifications: failed to schedule for ${plant.name}`, err);
    return null;
  }
}

/** Cancels a scheduled notification by its Expo identifier. */
export async function cancelWateringReminder(notificationId: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch (err) {
    console.warn("notifications: failed to cancel notification", notificationId, err);
  }
}

/**
 * Cancels all existing scheduled reminders and re-schedules them from scratch
 * using the current plants array and user's preferred reminder time.
 *
 * Call this on:
 *  - App open (plants loaded)
 *  - Weather sync updates next_watering dates
 *  - User changes reminder time preference
 */
export async function scheduleAllReminders(plants: Plant[]): Promise<void> {
  // Check if the user has notifications enabled (default: true)
  const enabledRaw = await AsyncStorage.getItem(NOTIFICATIONS_ENABLED_KEY);
  const enabled = enabledRaw !== "false"; // default on
  if (!enabled) return;

  // Cancel all existing notifications before rebuilding
  await Notifications.cancelAllScheduledNotificationsAsync();

  const newIdMap: NotificationIdMap = {};

  for (const plant of plants) {
    if (!plant.next_watering) continue;

    const id = await scheduleWateringReminder(plant);
    if (id) {
      newIdMap[plant.id] = id;
    }
  }

  await saveNotificationIds(newIdMap);
}

/** Cancels all scheduled notifications and clears stored IDs. */
export async function cancelAllReminders(): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    await AsyncStorage.removeItem(NOTIFICATION_IDS_KEY);
  } catch (err) {
    console.warn("notifications: failed to cancel all reminders", err);
  }
}

/**
 * Schedules a local notification for a single plant's next_fertilizer_at date.
 * Fires at the user's preferred reminder hour (default 9 AM).
 */
export async function scheduleFertilizerReminder(plant: Plant): Promise<string | null> {
  if (!plant.next_fertilizer_at) return null;

  const nextDate = new Date(plant.next_fertilizer_at);
  const now = new Date();
  if (nextDate <= now) return null;

  const { hour, minute } = await getReminderTime();
  const triggerDate = new Date(nextDate);
  triggerDate.setHours(hour, minute, 0, 0);
  if (triggerDate <= now) return null;

  try {
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: `🌱 Time to fertilize ${plant.name}!`,
        body: `Give your ${plant.common_name ?? plant.species ?? "plant"} a nutrient boost.`,
        data: { plantId: plant.id, type: "fertilizer" },
        sound: "default",
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: triggerDate,
      },
    });
    return identifier;
  } catch (err) {
    console.warn(`notifications: failed to schedule fertilizer for ${plant.name}`, err);
    return null;
  }
}

/** Cancels a scheduled fertilizer notification by its Expo identifier. */
export async function cancelFertilizerReminder(notificationId: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch (err) {
    console.warn("notifications: failed to cancel fertilizer notification", notificationId, err);
  }
}

/**
 * Re-schedules the fertilizer notification for a single plant after it has been fertilized.
 */
export async function rescheduleFertilizerReminderForPlant(
  plant: Plant
): Promise<string | null> {
  const enabledRaw = await AsyncStorage.getItem(NOTIFICATIONS_ENABLED_KEY);
  const enabled = enabledRaw !== "false";
  if (!enabled) return null;

  const raw = await AsyncStorage.getItem(FERTILIZER_NOTIFICATION_IDS_KEY);
  const idMap: NotificationIdMap = raw ? (JSON.parse(raw) as NotificationIdMap) : {};
  const existingId = idMap[plant.id];
  if (existingId) await cancelFertilizerReminder(existingId);

  const newId = await scheduleFertilizerReminder(plant);
  if (newId) {
    idMap[plant.id] = newId;
  } else {
    delete idMap[plant.id];
  }
  await AsyncStorage.setItem(FERTILIZER_NOTIFICATION_IDS_KEY, JSON.stringify(idMap));
  return newId;
}

/**
 * Sends an immediate notification — useful for testing that notifications
 * are working on a device without waiting for a scheduled time.
 */
export async function sendImmediateNotification(
  title: string,
  body: string
): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: "default" },
      trigger: null, // null trigger = fire immediately
    });
  } catch (err) {
    console.warn("notifications: sendImmediateNotification failed", err);
  }
}

const FOLLOWUP_NOTIFICATION_IDS_KEY = "followup_notification_ids";

/**
 * Schedules a follow-up diagnosis notification for a plant.
 * Returns the Expo notification identifier.
 */
export async function scheduleFollowUpDiagnosisNotification(
  plantId: string,
  plantName: string,
  condition: string,
  followUpDate: Date
): Promise<string | null> {
  const now = new Date();
  if (followUpDate <= now) return null;

  try {
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: `Time to check on ${plantName} 🌿`,
        body: `Follow-up for: ${condition}. How is it recovering?`,
        data: { plantId, type: "followup_diagnosis", condition },
        sound: "default",
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: followUpDate,
      },
    });

    // Persist notification ID for this plant
    const raw = await AsyncStorage.getItem(FOLLOWUP_NOTIFICATION_IDS_KEY);
    const idMap: NotificationIdMap = raw ? (JSON.parse(raw) as NotificationIdMap) : {};
    idMap[plantId] = identifier;
    await AsyncStorage.setItem(FOLLOWUP_NOTIFICATION_IDS_KEY, JSON.stringify(idMap));

    return identifier;
  } catch (err) {
    console.warn(`notifications: failed to schedule follow-up for ${plantName}`, err);
    return null;
  }
}

/**
 * Cancels a pending follow-up diagnosis notification for a plant and removes
 * it from AsyncStorage.
 */
export async function cancelFollowUpDiagnosisNotification(plantId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(FOLLOWUP_NOTIFICATION_IDS_KEY);
    if (!raw) return;
    const idMap: NotificationIdMap = JSON.parse(raw) as NotificationIdMap;
    const identifier = idMap[plantId];
    if (!identifier) return;
    await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});
    delete idMap[plantId];
    await AsyncStorage.setItem(FOLLOWUP_NOTIFICATION_IDS_KEY, JSON.stringify(idMap));
  } catch (err) {
    console.warn(`notifications: failed to cancel follow-up for plantId ${plantId}`, err);
  }
}

/**
 * Schedules a notification on the 1st of next month reminding the user to
 * check their seasonal tips. Safe to call every month — cancels any prior
 * seasonal tips notification before scheduling a new one.
 */
export async function scheduleSeasonalTipsNotification(
  title: string,
  body: string
): Promise<void> {
  const SEASONAL_NOTIF_KEY = "seasonal_tips_notification_id";
  try {
    // Cancel previous seasonal tips notification if any
    const prev = await AsyncStorage.getItem(SEASONAL_NOTIF_KEY);
    if (prev) {
      await Notifications.cancelScheduledNotificationAsync(prev).catch(() => {});
    }

    // Trigger on 1st of next month at 9 AM
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1, 9, 0, 0, 0);
    if (nextMonth <= now) return;

    const id = await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: "default", data: { type: "seasonal_tips" } },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: nextMonth,
      },
    });
    await AsyncStorage.setItem(SEASONAL_NOTIF_KEY, id);
  } catch (err) {
    console.warn("notifications: scheduleSeasonalTipsNotification failed", err);
  }
}

/**
 * Re-schedules the notification for a single plant after it has been watered.
 * Cancels the old notification and creates a new one for the updated next_watering.
 *
 * Returns the new notification identifier (or null if not scheduled).
 */
export async function rescheduleReminderForPlant(
  plant: Plant
): Promise<string | null> {
  const enabledRaw = await AsyncStorage.getItem(NOTIFICATIONS_ENABLED_KEY);
  const enabled = enabledRaw !== "false";
  if (!enabled) return null;

  // Cancel existing notification for this plant
  const idMap = await loadNotificationIds();
  const existingId = idMap[plant.id];
  if (existingId) {
    await cancelWateringReminder(existingId);
  }

  // Schedule new reminder
  const newId = await scheduleWateringReminder(plant);

  // Persist updated map
  if (newId) {
    idMap[plant.id] = newId;
  } else {
    delete idMap[plant.id];
  }
  await saveNotificationIds(idMap);

  return newId;
}

import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Plant } from "@/types";

const NOTIFICATION_IDS_KEY = "notification_ids";
const REMINDER_TIME_KEY = "reminder_time";
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

/** Returns the user-preferred reminder hour (default 9 AM). */
async function getReminderHour(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(REMINDER_TIME_KEY);
    return raw ? parseInt(raw, 10) : 9;
  } catch {
    return 9;
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

  const hour = await getReminderHour();

  // Build the trigger date: same date as next_watering but at the preferred hour
  const triggerDate = new Date(nextWateringDate);
  triggerDate.setHours(hour, 0, 0, 0);

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

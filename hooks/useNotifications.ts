import { useState, useEffect } from "react";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { supabase } from "@/lib/supabase";
import { useUserStore } from "@/store/user";

export interface UseNotificationsResult {
  hasPermission: boolean;
  pushToken: string | null;
  requestPermission: () => Promise<boolean>;
}

/**
 * Manages push notification permissions and Expo push token registration.
 *
 * On first call it checks the current permission status. If already granted,
 * it immediately fetches the token and persists it to the user's profile so
 * that server-side reminders (future Supabase scheduled functions) can reach
 * this device. Actual local notification scheduling lives in /lib/notifications.ts.
 */
export function useNotifications(): UseNotificationsResult {
  const [hasPermission, setHasPermission] = useState(false);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const profile = useUserStore((s) => s.profile);

  // On mount: check existing permissions and fetch token if already granted
  useEffect(() => {
    checkAndInitialise();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function checkAndInitialise() {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      if (status === "granted") {
        setHasPermission(true);
        await fetchAndSaveToken();
      }
    } catch (err) {
      console.warn("useNotifications: failed to check permissions", err);
    }
  }

  async function fetchAndSaveToken(): Promise<string | null> {
    try {
      // Expo push tokens are only available on physical devices.
      // On simulators / Expo Go on web this returns undefined gracefully.
      const tokenData = await Notifications.getExpoPushTokenAsync();
      const token = tokenData.data;
      setPushToken(token);

      // Persist to Supabase so server-side functions can look up the token
      if (profile?.id && token) {
        await supabase
          .from("profiles")
          .update({ push_token: token })
          .eq("id", profile.id);
      }

      // Android requires a notification channel to be configured
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("watering", {
          name: "Watering Reminders",
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#52B788",
          sound: "default",
        });
      }

      return token;
    } catch (err) {
      // Fails on simulator or when EAS projectId not configured — not fatal
      console.warn("useNotifications: could not get push token", err);
      return null;
    }
  }

  async function requestPermission(): Promise<boolean> {
    try {
      const { status } = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      });

      const granted = status === "granted";
      setHasPermission(granted);

      if (granted) {
        await fetchAndSaveToken();
      }

      return granted;
    } catch (err) {
      console.warn("useNotifications: requestPermission failed", err);
      return false;
    }
  }

  return { hasPermission, pushToken, requestPermission };
}

import { useState, useEffect } from "react";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import Constants from "expo-constants";

import { supabase } from "@/lib/supabase";
import { useUserStore } from "@/store/user";

// Remote push tokens are not available in Expo Go since SDK 53.
// Local notifications (scheduling, cancelling) still work fine.
const isExpoGo = Constants.appOwnership === "expo";

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
    // Android notification channel works in Expo Go; push token registration does not
    if (Platform.OS === "android") {
      try {
        await Notifications.setNotificationChannelAsync("watering", {
          name: "Watering Reminders",
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#6BA83A",
          sound: "default",
        });
        await Notifications.setNotificationChannelAsync("community", {
          name: "Community",
          importance: Notifications.AndroidImportance.DEFAULT,
          vibrationPattern: [0, 150, 150, 150],
          lightColor: "#6BA83A",
          sound: "default",
        });
      } catch (err) {
        console.warn("useNotifications: could not set notification channel", err);
      }
    }

    // Push token fetch requires a development build — skip in Expo Go
    if (isExpoGo) return null;

    try {
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

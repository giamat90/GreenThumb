import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, View } from "react-native";
import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import "react-native-reanimated";
import "../global.css";

import Purchases from "react-native-purchases";

import { supabase } from "@/lib/supabase";
import {
  initializePurchases,
  checkSubscriptionStatus,
} from "@/lib/revenuecat";
import { useUserStore } from "@/store/user";
import { usePlantsStore } from "@/store/plants";
import { useNotifications } from "@/hooks/useNotifications";
import { scheduleAllReminders } from "@/lib/notifications";
import { COLORS } from "@/constants";
import type { Profile } from "@/types";
import type { Session } from "@supabase/supabase-js";

// Configure how notifications are presented when the app is in the foreground.
// Must be called at module level (outside the component) so it takes effect
// before any notification arrives.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export { ErrorBoundary } from "expo-router";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);

  const { setProfile, clearProfile, setSubscription } = useUserStore();
  const { plants } = usePlantsStore();
  const segments = useSegments();
  const router = useRouter();

  // Initialise notification permissions + token registration
  const { requestPermission } = useNotifications();
  const notificationResponseListener =
    useRef<Notifications.EventSubscription | null>(null);

  // Listen for auth state changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
      if (currentSession) {
        fetchProfile(currentSession.user.id);
      }
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      if (newSession) {
        fetchProfile(newSession.user.id);
        // Check onboarding status on sign in
        const done = await AsyncStorage.getItem("onboarding_complete");
        setOnboardingDone(done === "true");
      } else {
        clearProfile();
        setOnboardingDone(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Check onboarding status on initial load
  useEffect(() => {
    if (authReady && session) {
      AsyncStorage.getItem("onboarding_complete").then((val) => {
        setOnboardingDone(val === "true");
      });
    } else if (authReady && !session) {
      setOnboardingDone(null);
    }
  }, [authReady, session]);

  async function fetchProfile(userId: string) {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (error) throw error;
      setProfile(data as Profile);
    } catch {
      // Profile may not exist yet (trigger hasn't fired or is pending)
      // Set a minimal profile from auth metadata so the app still works
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (user) {
        setProfile({
          id: user.id,
          display_name:
            (user.user_metadata?.display_name as string) ??
            user.email?.split("@")[0] ??
            null,
          avatar_url: null,
          subscription: "free",
          timezone: null,
          city: null,
          lat: null,
          lng: null,
          created_at: new Date().toISOString(),
        });
      }
    }
  }

  // Redirect based on auth + onboarding state
  useEffect(() => {
    if (!authReady || !fontsLoaded) return;
    // Wait until onboarding status is resolved for signed-in users
    if (session && onboardingDone === null) return;

    const inAuthGroup = segments[0] === "(auth)";
    const onOnboarding = segments[1] === "onboarding";

    if (!session && !inAuthGroup) {
      // Not signed in — go to login
      router.replace("/(auth)/login");
    } else if (session && onboardingDone === false && !onOnboarding) {
      // Signed in, onboarding not done — go to onboarding
      router.replace("/(auth)/onboarding");
    } else if (session && onboardingDone !== false && inAuthGroup) {
      // Signed in, onboarding done (or skipped), still on auth screen — go to tabs
      router.replace("/(tabs)");
    }
  }, [session, authReady, fontsLoaded, segments, onboardingDone]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (fontError) throw fontError;
  }, [fontError]);

  useEffect(() => {
    if (fontsLoaded && authReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, authReady]);

  // Initialise RevenueCat once the user is authenticated.
  // We also attach a real-time listener so the subscription state updates
  // immediately after a purchase or renewal without requiring a full refetch.
  useEffect(() => {
    if (!authReady || !session) return;

    const userId = session.user.id;
    initializePurchases(userId);

    // Sync current status into the Zustand store
    checkSubscriptionStatus().then((status) => {
      setSubscription(status);
    });

    // Listen for RevenueCat customer info updates (purchase, renewal, expiry)
    const listener = Purchases.addCustomerInfoUpdateListener((customerInfo) => {
      const isProActive = "pro" in customerInfo.entitlements.active;
      setSubscription(isProActive ? "pro" : "free");
    });

    return () => {
      listener.remove();
    };
  }, [authReady, session]); // eslint-disable-line react-hooks/exhaustive-deps

  // Request notification permission once auth is confirmed ready.
  // The 500ms delay ensures the component tree is fully mounted before
  // any state updates triggered by permission callbacks can fire,
  // preventing the "Can't perform state update before mount" warning.
  useEffect(() => {
    if (!authReady || !session) return;
    const timer = setTimeout(() => {
      requestPermission();
    }, 500);
    return () => clearTimeout(timer);
  }, [authReady, session]); // eslint-disable-line react-hooks/exhaustive-deps

  // Schedule reminders whenever the plants list loads or changes
  useEffect(() => {
    if (plants.length > 0) {
      scheduleAllReminders(plants).catch((err) =>
        console.warn("_layout: scheduleAllReminders failed", err)
      );
    }
  }, [plants]);

  // Navigate to the plant detail screen when the user taps a notification
  useEffect(() => {
    notificationResponseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data as {
          plantId?: string;
          type?: string;
        };
        if (data?.type === "watering" && data.plantId) {
          router.push(`/plant/${data.plantId}`);
        }
      });

    return () => {
      notificationResponseListener.current?.remove();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear badge count whenever the app comes back to the foreground
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        Notifications.setBadgeCountAsync(0).catch(() => {
          // Non-fatal — badge clearing is best-effort
        });
      }
    });
    return () => subscription.remove();
  }, []);

  if (!fontsLoaded || !authReady) {
    return (
      <View className="flex-1 items-center justify-center bg-cream">
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  // Use an explicit Stack (not Slot) so that plant/[id] is registered as a
  // named root-level screen that sits ABOVE the tab navigator. With <Slot />,
  // Expo Router's automatic hierarchy can still tie plant/[id] to the tab
  // navigator's state, causing the "Cannot read property 'stale' of undefined"
  // crash when the Android back gesture fires during the tab transition.
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="plant/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="diagnosis/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="paywall" options={{ headerShown: false }} />
    </Stack>
  );
}

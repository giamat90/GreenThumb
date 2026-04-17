import '@/lib/i18n';
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, AppState, View } from "react-native";
import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import NetInfo from "@react-native-community/netinfo";
import { useTranslation } from "react-i18next";
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
import { useNetworkStore } from "@/store/networkStore";
import { useNotifications } from "@/hooks/useNotifications";
import { scheduleAllReminders } from "@/lib/notifications";
import { syncPlantEvents } from "@/lib/calendarSync";
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
  const { t } = useTranslation();
  const [fontsLoaded, fontError] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);

  const { setProfile, clearProfile, setSubscription } = useUserStore();
  const { plants } = usePlantsStore();
  const { isOnline, setIsOnline } = useNetworkStore();
  const offlineBannerAnim = useRef(new Animated.Value(-40)).current;
  // Track whether auth was previously established so we can detect unexpected sign-outs
  const hadSession = useRef(false);
  const segments = useSegments();
  const router = useRouter();

  // Initialise notification permissions + token registration
  const { requestPermission } = useNotifications();
  const notificationResponseListener =
    useRef<Notifications.EventSubscription | null>(null);

  // Listen for auth state changes + session expiry
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
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession) {
        hadSession.current = true;
        fetchProfile(newSession.user.id);
      } else {
        clearProfile();
        setOnboardingDone(null);
        // Session ended (user signed out or token expired).
        // The routing guard in the second useEffect will redirect to login.
        // Individual screens surface auth errors via ErrorBanner when they
        // receive 401 / JWT responses from the API.
        hadSession.current = false;
      }
    });

    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Monitor network connectivity globally
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = state.isConnected ?? true;
      setIsOnline(online);
      // Animate the offline banner in/out
      Animated.timing(offlineBannerAnim, {
        toValue: online ? -40 : 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    });
    return () => unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-read the onboarding flag whenever auth state or navigation changes.
  // Depending on `segments` is the key fix: without it, the flag written by
  // handleFinish() in onboarding.tsx is never picked up before the redirect
  // guard fires, causing an infinite onboarding loop in production builds.
  useEffect(() => {
    if (!authReady) return;
    if (!session) {
      setOnboardingDone(null);
      return;
    }
    AsyncStorage.getItem("onboarding_complete").then((val) => {
      setOnboardingDone(val === "true");
    });
  }, [authReady, session, segments]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // Listen for RevenueCat customer info updates (purchase, renewal, expiry).
    // Only in __DEV__ where RevenueCat is actually initialised — in release
    // the listener would fire with empty entitlements and override beta-email Pro status.
    let listener: { remove: () => void } | null = null;
    if (__DEV__) {
      listener = Purchases.addCustomerInfoUpdateListener((customerInfo) => {
        const isProActive = "pro" in customerInfo.entitlements.active;
        setSubscription(isProActive ? "pro" : "free");
      });
    }

    return () => {
      try { listener?.remove(); } catch {}
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
          condition?: string;
          postId?: string;
          actorId?: string;
        };
        if (data?.type === "watering" && data.plantId) {
          router.push(`/plant/${data.plantId}`);
        } else if (data?.type === "followup_diagnosis" && data.plantId) {
          router.push({
            pathname: "/diagnosis/[id]",
            params: { id: data.plantId, isFollowUp: "true", previousCondition: data.condition ?? "" },
          });
        } else if (
          (data?.type === "community_like" || data?.type === "community_comment") &&
          data.postId
        ) {
          router.push({ pathname: "/community/post/[id]", params: { id: data.postId } });
        } else if (data?.type === "community_follow" && data.actorId) {
          router.push({ pathname: "/community/profile/[id]", params: { id: data.actorId } });
        }
      });

    return () => {
      try { notificationResponseListener.current?.remove(); } catch {}
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear badge + auto-sync calendar whenever the app comes back to the foreground
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        Notifications.setBadgeCountAsync(0).catch(() => {});

        // Auto-sync calendar if the user has it enabled
        AsyncStorage.getItem("calendarSyncEnabled").then((val) => {
          if (val === "true" && plants.length > 0) {
            syncPlantEvents(plants).catch(() => {});
          }
        });
      }
    });
    return () => {
      try { subscription?.remove(); } catch {}
    };
  }, [plants]);

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
    <View style={{ flex: 1 }}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)/profile" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="plant/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="diagnosis/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="placement/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="repotting/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="growth/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="pruning/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="paywall" options={{ headerShown: false }} />
        <Stack.Screen name="seasonal-tips" options={{ headerShown: false }} />
        <Stack.Screen name="community/new-post" options={{ headerShown: false }} />

        <Stack.Screen name="community/post/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="community/profile/[id]" options={{ headerShown: false }} />
      </Stack>

      {/* Global offline banner — slides in from the top when connectivity is lost */}
      <Animated.View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          backgroundColor: "#EF4444",
          paddingVertical: 8,
          paddingHorizontal: 16,
          alignItems: "center",
          transform: [{ translateY: offlineBannerAnim }],
          zIndex: 9999,
        }}
        pointerEvents="none"
      >
        <Animated.Text style={{ color: "#fff", fontWeight: "600", fontSize: 13 }}>
          {t("errors.noInternet")} — {t("errors.checkConnection")}
        </Animated.Text>
      </Animated.View>
    </View>
  );
}

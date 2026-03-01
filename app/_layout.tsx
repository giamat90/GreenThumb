import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useFonts } from "expo-font";
import { Slot, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import AsyncStorage from "@react-native-async-storage/async-storage";
import "react-native-reanimated";
import "../global.css";

import { supabase } from "@/lib/supabase";
import { useUserStore } from "@/store/user";
import { COLORS } from "@/constants";
import type { Profile } from "@/types";
import type { Session } from "@supabase/supabase-js";

export { ErrorBoundary } from "expo-router";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);

  const { setProfile, clearProfile } = useUserStore();
  const segments = useSegments();
  const router = useRouter();

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

  if (!fontsLoaded || !authReady) {
    return (
      <View className="flex-1 items-center justify-center bg-cream">
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return <Slot />;
}

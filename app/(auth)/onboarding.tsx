import { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  Animated,
} from "react-native";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MapPin, Check } from "lucide-react-native";

import { supabase } from "@/lib/supabase";
import { useUserStore } from "@/store/user";
import { COLORS } from "@/constants";
import { detectDefaultUnits } from "@/lib/units";

const TOTAL_STEPS = 3;

export default function OnboardingScreen() {
  const [step, setStep] = useState(0);
  const [city, setCity] = useState("");
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [isSavingCity, setIsSavingCity] = useState(false);

  const profile = useUserStore((s) => s.profile);
  const setProfile = useUserStore((s) => s.setProfile);
  const router = useRouter();

  // Check animation for step 3
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (step === 2) {
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 4,
        tension: 60,
        useNativeDriver: true,
      }).start();
    }
  }, [step, scaleAnim]);

  async function handleAllowLocation() {
    setIsLocating(true);
    setLocationError(null);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        setLocationDenied(true);
        setIsLocating(false);
        return;
      }

      const location = await Location.getCurrentPositionAsync({});
      const [place] = await Location.reverseGeocodeAsync({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });

      const cityName = place?.city ?? place?.region ?? "Unknown";
      await saveLocation(
        cityName,
        location.coords.latitude,
        location.coords.longitude
      );

      setStep(2);
    } catch {
      setLocationError("Could not get your location. Please enter your city.");
      setLocationDenied(true);
    } finally {
      setIsLocating(false);
    }
  }

  async function handleCitySubmit() {
    if (!city.trim()) return;

    setIsSavingCity(true);
    setLocationError(null);

    try {
      // Use expo-location geocoding to get coords from city name
      const results = await Location.geocodeAsync(city.trim());

      if (results.length > 0) {
        await saveLocation(city.trim(), results[0].latitude, results[0].longitude);
        setStep(2);
      } else {
        setLocationError("Could not find that city. Please try a different name.");
      }
    } catch {
      setLocationError("Could not look up that city. Please try again.");
    } finally {
      setIsSavingCity(false);
    }
  }

  async function saveLocation(cityName: string, lat: number, lng: number) {
    if (!profile) return;

    const units = detectDefaultUnits();
    const { error } = await supabase
      .from("profiles")
      .update({ city: cityName, lat, lng, units })
      .eq("id", profile.id);

    if (!error) {
      setProfile({ ...profile, city: cityName, lat, lng, units });
    }
  }

  async function handleFinish() {
    await AsyncStorage.setItem("onboarding_complete", "true");
    router.replace("/(tabs)");
  }

  async function handleSkipLocation() {
    setStep(2);
  }

  return (
    <View className="flex-1 bg-cream items-center justify-center px-8">
      {/* Progress dots */}
      <View className="flex-row gap-2 mb-12">
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <View
            key={i}
            className={`h-2 rounded-full ${
              i === step ? "w-8 bg-primary" : "w-2 bg-gray-300"
            }`}
          />
        ))}
      </View>

      {/* Step 1: Welcome */}
      {step === 0 && (
        <View className="items-center">
          <Text className="text-5xl mb-6">🌿</Text>
          <Text className="text-2xl font-bold text-primary text-center mb-3">
            Welcome to GreenThumb
            {profile?.display_name ? `, ${profile.display_name}` : ""}!
          </Text>
          <Text className="text-base text-gray-500 text-center mb-10 px-4">
            Let's set up your plant care assistant. It only takes a minute.
          </Text>
          <Pressable
            className="bg-primary rounded-3xl py-4 px-16"
            onPress={() => setStep(1)}
            accessibilityLabel="Get started"
            accessibilityRole="button"
          >
            <Text className="text-white text-base font-semibold">
              Get Started
            </Text>
          </Pressable>
        </View>
      )}

      {/* Step 2: Location */}
      {step === 1 && (
        <View className="items-center w-full">
          <View className="bg-lightgreen rounded-full p-4 mb-4">
            <MapPin size={36} color={COLORS.primary} />
          </View>
          <Text className="text-xl font-bold text-primary text-center mb-2">
            Smarter watering starts with your weather
          </Text>
          <Text className="text-sm text-gray-500 text-center mb-8 px-4">
            We use your local weather to predict exactly when your plants need
            water.
          </Text>

          {!locationDenied ? (
            <>
              <Pressable
                className="bg-primary rounded-3xl py-4 px-12 w-full items-center mb-4"
                onPress={handleAllowLocation}
                disabled={isLocating}
                accessibilityLabel="Allow location access"
                accessibilityRole="button"
              >
                {isLocating ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-white text-base font-semibold">
                    Allow Location
                  </Text>
                )}
              </Pressable>

              {locationError && (
                <Text className="text-danger text-sm text-center mb-2">
                  {locationError}
                </Text>
              )}
            </>
          ) : (
            <View className="w-full mb-4">
              <TextInput
                className="bg-white rounded-2xl px-4 py-4 text-base text-gray-800 shadow-sm mb-3"
                placeholder="Enter your city (e.g. Rome)"
                placeholderTextColor={COLORS.textSecondary}
                value={city}
                onChangeText={setCity}
                autoCapitalize="words"
                accessibilityLabel="City name"
              />
              {locationError && (
                <Text className="text-danger text-xs mb-2 ml-1">
                  {locationError}
                </Text>
              )}
              <Pressable
                className="bg-primary rounded-3xl py-4 items-center"
                onPress={handleCitySubmit}
                disabled={isSavingCity || !city.trim()}
                accessibilityLabel="Save city"
                accessibilityRole="button"
              >
                {isSavingCity ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-white text-base font-semibold">
                    Save City
                  </Text>
                )}
              </Pressable>
            </View>
          )}

          <Pressable
            className="mt-2"
            onPress={handleSkipLocation}
            accessibilityLabel="Skip for now"
          >
            <Text className="text-sm text-gray-500">Skip for now</Text>
          </Pressable>
        </View>
      )}

      {/* Step 3: All set */}
      {step === 2 && (
        <View className="items-center">
          <Animated.View
            className="bg-success rounded-full p-5 mb-6"
            style={{ transform: [{ scale: scaleAnim }] }}
          >
            <Check size={40} color="#fff" />
          </Animated.View>
          <Text className="text-2xl font-bold text-primary text-center mb-2">
            You're all set! 🎉
          </Text>
          <Text className="text-base text-gray-500 text-center mb-10">
            Time to add your first plant.
          </Text>
          <Pressable
            className="bg-primary rounded-3xl py-4 px-12"
            onPress={handleFinish}
            accessibilityLabel="Start adding plants"
            accessibilityRole="button"
          >
            <Text className="text-white text-base font-semibold">
              Start Adding Your Plants
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

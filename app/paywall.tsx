import { View, Text, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { Crown } from "lucide-react-native";
import { COLORS } from "@/constants";

/**
 * Paywall screen — stub placeholder.
 * Will be replaced with the full RevenueCat paywall in a future prompt.
 */
export default function PaywallScreen() {
  const router = useRouter();

  return (
    <View className="flex-1 items-center justify-center bg-cream px-8">
      <View className="bg-lightgreen rounded-full p-6 mb-6">
        <Crown size={40} color={COLORS.primary} />
      </View>

      <Text className="text-3xl font-bold text-primary text-center mb-3">
        GreenThumb Pro
      </Text>

      <Text className="text-base text-gray-500 text-center leading-7 mb-8">
        Unlock unlimited plant identifications, AI disease diagnosis,
        weather-aware watering schedules, and more.
      </Text>

      <View className="w-full mb-3">
        <TouchableOpacity
          className="bg-primary rounded-2xl py-4 items-center"
          accessibilityLabel="Subscribe monthly for $4.99"
        >
          <Text className="text-white font-bold text-base">
            $4.99 / month
          </Text>
        </TouchableOpacity>
      </View>

      <View className="w-full mb-8">
        <TouchableOpacity
          className="border-2 border-primary rounded-2xl py-4 items-center"
          accessibilityLabel="Subscribe annually for $34.99 — best value"
        >
          <Text className="text-primary font-bold text-base">
            $34.99 / year  —  Best Value
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        onPress={() => router.back()}
        accessibilityLabel="Go back without subscribing"
      >
        <Text className="text-gray-400 text-sm">Maybe later</Text>
      </TouchableOpacity>
    </View>
  );
}

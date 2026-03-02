import { View, Text } from "react-native";
import { CalendarDays } from "lucide-react-native";
import { COLORS } from "@/constants";

/**
 * Calendar / Care schedule screen — stub placeholder.
 * Will show watering reminders and care events in a future prompt.
 */
export default function CalendarScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-cream px-6">
      <View className="bg-lightgreen rounded-full p-5 mb-4">
        <CalendarDays size={36} color={COLORS.primary} />
      </View>
      <Text className="text-2xl font-bold text-primary mb-2">
        Care Calendar
      </Text>
      <Text className="text-base text-gray-500 text-center leading-6">
        Your watering schedule and care reminders will appear here once you've
        added some plants.
      </Text>
    </View>
  );
}

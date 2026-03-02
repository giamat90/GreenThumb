import { View, Text } from "react-native";
import { Leaf } from "lucide-react-native";
import { COLORS } from "@/constants";

/**
 * My Plants screen — stub placeholder.
 * Will be replaced with the full plant dashboard in the next prompt.
 */
export default function MyPlantsScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-cream px-6">
      <View className="bg-lightgreen rounded-full p-5 mb-4">
        <Leaf size={36} color={COLORS.primary} />
      </View>
      <Text className="text-2xl font-bold text-primary mb-2">My Plants</Text>
      <Text className="text-base text-gray-500 text-center leading-6">
        Your plant collection will appear here. Add your first plant by tapping
        the camera button below!
      </Text>
    </View>
  );
}

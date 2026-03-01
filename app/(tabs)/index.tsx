import { View, Text, ScrollView } from "react-native";
import { Leaf } from "lucide-react-native";
import { COLORS } from "@/constants";

export default function HomeScreen() {
  return (
    <ScrollView className="flex-1 bg-cream">
      <View className="px-6 pt-16 pb-8">
        <View className="flex-row items-center gap-2 mb-2">
          <Leaf size={28} color={COLORS.primary} />
          <Text className="text-3xl font-bold text-primary">GreenThumb</Text>
        </View>
        <Text className="text-base text-gray-500 mb-8">
          Your AI plant care assistant
        </Text>

        <View className="bg-white rounded-3xl p-6 shadow-sm">
          <View className="items-center py-8">
            <View className="bg-lightgreen rounded-full p-4 mb-4">
              <Leaf size={32} color={COLORS.secondary} />
            </View>
            <Text className="text-lg font-semibold text-gray-800 mb-2">
              No plants yet
            </Text>
            <Text className="text-sm text-gray-500 text-center px-4">
              Add your first plant to get started with personalized care
              recommendations
            </Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

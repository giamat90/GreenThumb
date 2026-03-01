import { Link, Stack } from "expo-router";
import { View, Text } from "react-native";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Oops!" }} />
      <View className="flex-1 items-center justify-center p-5 bg-cream">
        <Text className="text-xl font-bold text-gray-800 mb-4">
          This screen doesn't exist.
        </Text>
        <Link href="/">
          <Text className="text-sm text-primary underline">
            Go to home screen!
          </Text>
        </Link>
      </View>
    </>
  );
}

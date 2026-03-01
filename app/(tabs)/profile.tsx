import { useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Alert,
} from "react-native";
import { LogOut, User } from "lucide-react-native";

import { supabase } from "@/lib/supabase";
import { useUserStore } from "@/store/user";
import { COLORS } from "@/constants";

export default function ProfileScreen() {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const profile = useUserStore((s) => s.profile);

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        Alert.alert("Error", error.message);
      }
      // Auth state listener in _layout.tsx handles the redirect
    } catch {
      Alert.alert("Error", "Something went wrong. Please try again.");
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <ScrollView className="flex-1 bg-cream">
      <View className="px-6 pt-16 pb-8">
        {/* Header */}
        <Text className="text-2xl font-bold text-gray-800 mb-6">Profile</Text>

        {/* User info card */}
        <View className="bg-white rounded-3xl p-6 shadow-sm mb-6">
          <View className="flex-row items-center gap-4">
            <View className="bg-lightgreen rounded-full p-3">
              <User size={28} color={COLORS.primary} />
            </View>
            <View className="flex-1">
              <Text className="text-lg font-semibold text-gray-800">
                {profile?.display_name ?? "User"}
              </Text>
              <Text className="text-sm text-gray-500">
                {profile?.subscription === "pro" ? "Pro Member" : "Free Plan"}
              </Text>
            </View>
          </View>

          {profile?.city && (
            <View className="mt-4 pt-4 border-t border-gray-100">
              <Text className="text-sm text-gray-500">
                📍 {profile.city}
              </Text>
            </View>
          )}
        </View>

        {/* Sign out */}
        <Pressable
          className="bg-white rounded-3xl p-4 shadow-sm flex-row items-center justify-center gap-2"
          onPress={handleSignOut}
          disabled={isSigningOut}
          accessibilityLabel="Sign out"
          accessibilityRole="button"
        >
          {isSigningOut ? (
            <ActivityIndicator color={COLORS.danger} />
          ) : (
            <>
              <LogOut size={20} color={COLORS.danger} />
              <Text className="text-danger text-base font-semibold">
                Sign Out
              </Text>
            </>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

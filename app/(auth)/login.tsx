import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from "react-native";
import { Link } from "expo-router";
import { Eye, EyeOff } from "lucide-react-native";

import { supabase } from "@/lib/supabase";
import { COLORS } from "@/constants";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        setError(authError.message);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-cream"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="px-8 py-12">
          {/* Header */}
          <View className="items-center mb-10">
            <Image
              source={require("@/assets/images/logo.png")}
              style={{ width: 120, height: 120 }}
              resizeMode="contain"
            />
            <Text className="text-3xl font-bold text-primary mb-2">
              GreenThumb
            </Text>
            <Text className="text-base text-gray-500 text-center">
              Keep your plants alive, effortlessly.
            </Text>
          </View>

          {/* Form */}
          <View className="gap-4 mb-4">
            <View>
              <TextInput
                className="bg-white rounded-2xl px-4 py-4 text-base text-gray-800 shadow-sm"
                placeholder="Email address"
                placeholderTextColor={COLORS.textSecondary}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                accessibilityLabel="Email address"
              />
            </View>

            <View>
              <View className="flex-row items-center bg-white rounded-2xl shadow-sm">
                <TextInput
                  className="flex-1 px-4 py-4 text-base text-gray-800"
                  placeholder="Password"
                  placeholderTextColor={COLORS.textSecondary}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoComplete="password"
                  accessibilityLabel="Password"
                />
                <Pressable
                  className="px-4 py-4"
                  onPress={() => setShowPassword(!showPassword)}
                  accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff size={20} color={COLORS.textSecondary} />
                  ) : (
                    <Eye size={20} color={COLORS.textSecondary} />
                  )}
                </Pressable>
              </View>
            </View>
          </View>

          {/* Error message */}
          {error && (
            <Text className="text-danger text-sm text-center mb-4">
              {error}
            </Text>
          )}

          {/* Sign In button */}
          <Pressable
            className="bg-primary rounded-3xl py-4 items-center mb-4"
            onPress={handleSignIn}
            disabled={isLoading}
            accessibilityLabel="Sign in"
            accessibilityRole="button"
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white text-base font-semibold">
                Sign In
              </Text>
            )}
          </Pressable>

          {/* Forgot password */}
          <Link href="/(auth)/forgot-password" asChild>
            <Pressable className="items-center mb-6" accessibilityLabel="Forgot password">
              <Text className="text-sm text-gray-500">Forgot password?</Text>
            </Pressable>
          </Link>

          {/* Divider */}
          <View className="flex-row items-center mb-6">
            <View className="flex-1 h-px bg-gray-200" />
            <Text className="mx-4 text-sm text-gray-400">or</Text>
            <View className="flex-1 h-px bg-gray-200" />
          </View>

          {/* Create account */}
          <Link href="/(auth)/signup" asChild>
            <Pressable className="items-center" accessibilityLabel="Create an account">
              <Text className="text-base text-primary font-semibold">
                Create an account
              </Text>
            </Pressable>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

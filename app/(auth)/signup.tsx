import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
} from "react-native";
import { Link, router } from "expo-router";
import { Eye, EyeOff, Leaf } from "lucide-react-native";

import { supabase } from "@/lib/supabase";
import { COLORS } from "@/constants";

interface FieldErrors {
  displayName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}

export default function SignupScreen() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function validate(): boolean {
    const errors: FieldErrors = {};

    if (!displayName.trim() || displayName.trim().length < 2) {
      errors.displayName = "Name must be at least 2 characters.";
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = "Please enter a valid email address.";
    }
    if (password.length < 8) {
      errors.password = "Password must be at least 8 characters.";
    }
    if (password !== confirmPassword) {
      errors.confirmPassword = "Passwords do not match.";
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSignUp() {
    if (!validate()) return;

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { display_name: displayName.trim() },
        },
      });

      if (authError) {
        setError(authError.message);
      } else if (data.session) {
        router.replace("/(tabs)/my-plants");
      } else {
        router.replace("/(auth)/login");
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
      behavior="padding"
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="px-8 py-12">
          {/* Header */}
          <View className="items-center mb-8">
            <View className="bg-lightgreen rounded-full p-4 mb-3">
              <Leaf size={32} color={COLORS.primary} />
            </View>
            <Text className="text-2xl font-bold text-primary mb-1">
              Create your account
            </Text>
            <Text className="text-sm text-gray-500">
              Start your plant care journey
            </Text>
          </View>

          {/* Form */}
          <View className="gap-3 mb-4">
            {/* Display Name */}
            <View>
              <TextInput
                className="bg-white rounded-2xl px-4 py-4 text-base text-gray-800 shadow-sm"
                placeholder="Display name"
                placeholderTextColor={COLORS.textSecondary}
                value={displayName}
                onChangeText={(text) => {
                  setDisplayName(text);
                  setFieldErrors((prev) => ({ ...prev, displayName: undefined }));
                }}
                autoCapitalize="words"
                autoComplete="name"
                accessibilityLabel="Display name"
              />
              {fieldErrors.displayName && (
                <Text className="text-danger text-xs mt-1 ml-1">
                  {fieldErrors.displayName}
                </Text>
              )}
            </View>

            {/* Email */}
            <View>
              <TextInput
                className="bg-white rounded-2xl px-4 py-4 text-base text-gray-800 shadow-sm"
                placeholder="Email address"
                placeholderTextColor={COLORS.textSecondary}
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  setFieldErrors((prev) => ({ ...prev, email: undefined }));
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                accessibilityLabel="Email address"
              />
              {fieldErrors.email && (
                <Text className="text-danger text-xs mt-1 ml-1">
                  {fieldErrors.email}
                </Text>
              )}
            </View>

            {/* Password */}
            <View>
              <View className="flex-row items-center bg-white rounded-2xl shadow-sm">
                <TextInput
                  className="flex-1 px-4 py-4 text-base text-gray-800"
                  placeholder="Password (min 8 characters)"
                  placeholderTextColor={COLORS.textSecondary}
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text);
                    setFieldErrors((prev) => ({ ...prev, password: undefined }));
                  }}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoComplete="new-password"
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
              {fieldErrors.password && (
                <Text className="text-danger text-xs mt-1 ml-1">
                  {fieldErrors.password}
                </Text>
              )}
            </View>

            {/* Confirm Password */}
            <View>
              <View className="flex-row items-center bg-white rounded-2xl shadow-sm">
                <TextInput
                  className="flex-1 px-4 py-4 text-base text-gray-800"
                  placeholder="Confirm password"
                  placeholderTextColor={COLORS.textSecondary}
                  value={confirmPassword}
                  onChangeText={(text) => {
                    setConfirmPassword(text);
                    setFieldErrors((prev) => ({ ...prev, confirmPassword: undefined }));
                  }}
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                  autoComplete="new-password"
                  accessibilityLabel="Confirm password"
                />
                <Pressable
                  className="px-4 py-4"
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                  accessibilityLabel={
                    showConfirmPassword ? "Hide confirm password" : "Show confirm password"
                  }
                >
                  {showConfirmPassword ? (
                    <EyeOff size={20} color={COLORS.textSecondary} />
                  ) : (
                    <Eye size={20} color={COLORS.textSecondary} />
                  )}
                </Pressable>
              </View>
              {fieldErrors.confirmPassword && (
                <Text className="text-danger text-xs mt-1 ml-1">
                  {fieldErrors.confirmPassword}
                </Text>
              )}
            </View>
          </View>

          {/* General error */}
          {error && (
            <Text className="text-danger text-sm text-center mb-4">
              {error}
            </Text>
          )}

          {/* Create Account button */}
          <Pressable
            className="bg-primary rounded-3xl py-4 items-center mb-6"
            onPress={handleSignUp}
            disabled={isLoading}
            accessibilityLabel="Create account"
            accessibilityRole="button"
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white text-base font-semibold">
                Create Account
              </Text>
            )}
          </Pressable>

          {/* Sign in link */}
          <View className="flex-row items-center justify-center">
            <Text className="text-sm text-gray-500">
              Already have an account?{" "}
            </Text>
            <Link href="/(auth)/login" asChild>
              <Pressable accessibilityLabel="Sign in">
                <Text className="text-sm text-primary font-semibold">
                  Sign in
                </Text>
              </Pressable>
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

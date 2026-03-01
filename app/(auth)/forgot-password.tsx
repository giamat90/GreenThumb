import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { ArrowLeft, Mail } from "lucide-react-native";

import { supabase } from "@/lib/supabase";
import { COLORS } from "@/constants";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const router = useRouter();

  async function handleReset() {
    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim()
      );

      if (resetError) {
        setError(resetError.message);
      } else {
        setSent(true);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  if (sent) {
    return (
      <View className="flex-1 bg-cream items-center justify-center px-8">
        <View className="bg-lightgreen rounded-full p-5 mb-6">
          <Mail size={40} color={COLORS.primary} />
        </View>
        <Text className="text-2xl font-bold text-primary mb-3 text-center">
          Reset link sent!
        </Text>
        <Text className="text-base text-gray-500 text-center mb-8">
          Check your email at {email.trim()} for a password reset link.
        </Text>
        <Pressable
          className="bg-primary rounded-3xl py-4 px-12"
          onPress={() => router.back()}
          accessibilityLabel="Back to sign in"
        >
          <Text className="text-white text-base font-semibold">
            Back to Sign In
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-cream"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View className="flex-1 justify-center px-8">
        {/* Back button */}
        <Pressable
          className="absolute top-16 left-6 p-2"
          onPress={() => router.back()}
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={24} color={COLORS.textPrimary} />
        </Pressable>

        <View className="items-center mb-8">
          <Text className="text-2xl font-bold text-primary mb-2">
            Reset password
          </Text>
          <Text className="text-sm text-gray-500 text-center">
            Enter your email and we'll send you a reset link.
          </Text>
        </View>

        <TextInput
          className="bg-white rounded-2xl px-4 py-4 text-base text-gray-800 shadow-sm mb-4"
          placeholder="Email address"
          placeholderTextColor={COLORS.textSecondary}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          accessibilityLabel="Email address"
        />

        {error && (
          <Text className="text-danger text-sm text-center mb-4">{error}</Text>
        )}

        <Pressable
          className="bg-primary rounded-3xl py-4 items-center"
          onPress={handleReset}
          disabled={isLoading}
          accessibilityLabel="Send reset link"
          accessibilityRole="button"
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-white text-base font-semibold">
              Send Reset Link
            </Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Lock } from "lucide-react-native";
import { useRouter } from "expo-router";
import { COLORS } from "@/constants";

interface UpgradePromptProps {
  featureName: string;
  description?: string;
}

/**
 * Inline upgrade banner used throughout the app to soft-gate Pro features.
 * Shows a lock icon, the feature name, and a tappable "Upgrade to Pro" button
 * that navigates to the paywall.
 */
export function UpgradePrompt({ featureName, description }: UpgradePromptProps) {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.left}>
        <View style={styles.iconWrap}>
          <Lock size={16} color={COLORS.primary} />
        </View>
        <View style={styles.textGroup}>
          <Text style={styles.featureName}>{featureName}</Text>
          {description ? (
            <Text style={styles.description}>{description}</Text>
          ) : null}
        </View>
      </View>
      <TouchableOpacity
        style={styles.button}
        onPress={() => router.push("/paywall")}
        accessibilityLabel={`Upgrade to Pro to unlock ${featureName}`}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>Upgrade</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.lightgreen,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  textGroup: {
    flex: 1,
  },
  featureName: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.primary,
  },
  description: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 1,
  },
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  buttonText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
  },
});

import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Sparkles } from "lucide-react-native";
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
          <Sparkles size={16} color="#fff" />
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
    backgroundColor: "#EAF5EE",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderWidth: 1,
    borderColor: "#C3E6CB",
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
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
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  buttonText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
  },
});

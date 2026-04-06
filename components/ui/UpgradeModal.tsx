// UpgradeModal: contextual bottom sheet (use this for Pro gates)
// UpgradePrompt: inline banner (legacy, being phased out)

import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Crown } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { COLORS } from "@/constants";

interface UpgradeModalProps {
  visible: boolean;
  onClose: () => void;
  featureName: string;
  onUpgrade: () => void;
}

export function UpgradeModal({
  visible,
  onClose,
  featureName,
  onUpgrade,
}: UpgradeModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(400)).current;
  const [internalVisible, setInternalVisible] = useState(false);

  useEffect(() => {
    if (visible) {
      setInternalVisible(true);
      translateY.setValue(400);
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    } else {
      Animated.timing(translateY, {
        toValue: 400,
        duration: 220,
        useNativeDriver: true,
      }).start(() => setInternalVisible(false));
    }
  }, [visible, translateY]);

  // Fixed upsell features shown below the specific feature, de-duped
  const fixedFeatures = [
    t("paywall.allAIAdvisors"),
    t("paywall.featureRecovery"),
    t("paywall.featureWeather"),
  ].filter((item) => item !== featureName);

  return (
    <Modal
      visible={internalVisible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
        />
        <Animated.View
          style={[
            styles.sheet,
            {
              transform: [{ translateY }],
              paddingBottom: insets.bottom + 24,
            },
          ]}
        >
          {/* Pro badge */}
          <View style={styles.badge}>
            <Crown size={18} color="#FFD700" />
            <Text style={styles.badgeText}>GreenThumb Pro</Text>
          </View>

          {/* Headline + subtext */}
          <Text style={styles.title}>{t("paywall.contextualTitle")}</Text>
          <Text style={styles.desc}>{t("paywall.contextualDesc")}</Text>

          {/* Feature checklist */}
          <View style={styles.featureList}>
            {[featureName, ...fixedFeatures].map((name, i) => (
              <View key={i} style={styles.featureRow}>
                <Text style={styles.checkmark}>✓</Text>
                <Text
                  style={[
                    styles.featureText,
                    i === 0 && styles.featureTextHighlight,
                  ]}
                >
                  {name}
                </Text>
              </View>
            ))}
          </View>

          {/* Primary CTA */}
          <TouchableOpacity
            style={styles.ctaButton}
            onPress={onUpgrade}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={t("paywall.trialCTA")}
          >
            <Text style={styles.ctaText}>{t("paywall.trialCTA")}</Text>
          </TouchableOpacity>

          {/* Fine print */}
          <Text style={styles.trialNote}>{t("paywall.trialNote")}</Text>

          {/* Secondary dismiss */}
          <TouchableOpacity
            onPress={onClose}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel={t("paywall.maybeLater")}
            hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
          >
            <Text style={styles.maybeLater}>{t("paywall.maybeLater")}</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 28,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 16,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "center",
    backgroundColor: COLORS.lightgreen,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 20,
  },
  badgeText: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.primary,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.textPrimary,
    textAlign: "center",
    marginBottom: 10,
    letterSpacing: -0.3,
  },
  desc: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 21,
    marginBottom: 24,
  },
  featureList: {
    gap: 12,
    marginBottom: 28,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  checkmark: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: "700",
    width: 20,
    textAlign: "center",
  },
  featureText: {
    fontSize: 14,
    color: COLORS.textPrimary,
    flex: 1,
  },
  featureTextHighlight: {
    fontWeight: "700",
    color: COLORS.primary,
  },
  ctaButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: 12,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  ctaText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 0.2,
  },
  trialNote: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: "center",
    marginBottom: 16,
  },
  maybeLater: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: "center",
    fontWeight: "500",
  },
});

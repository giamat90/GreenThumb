import React, { useEffect, useRef } from "react";
import { Animated, Linking, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { WifiOff, AlertCircle, CloudOff, X } from "lucide-react-native";
import { COLORS } from "@/constants";
import { type AppErrorType, getErrorAction, getErrorMessage } from "@/lib/errorHandling";

interface Props {
  error: AppErrorType | null;
  onRetry?: () => void;
  onDismiss?: () => void;
}

// Severity: no_internet / auth_expired = red; ai_unavailable / photo_upload = amber; others = red
const isAmber = (type: AppErrorType) =>
  type === "ai_unavailable" || type === "photo_upload";

const BannerIcon = ({ type, color }: { type: AppErrorType; color: string }) => {
  const size = 18;
  if (type === "no_internet") return <WifiOff size={size} color={color} />;
  if (type === "ai_unavailable") return <CloudOff size={size} color={color} />;
  return <AlertCircle size={size} color={color} />;
};

export default function ErrorBanner({ error, onRetry, onDismiss }: Props) {
  const { t } = useTranslation();
  const slideAnim = useRef(new Animated.Value(-80)).current;

  useEffect(() => {
    if (error) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 10,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: -80,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [error, slideAnim]);

  if (!error) return null;

  const amber = isAmber(error);
  const bgColor = amber ? "#FEF3C7" : "#FEE2E2";
  const borderColor = amber ? "#F59E0B" : "#EF4444";
  const textColor = amber ? "#92400E" : "#991B1B";
  const { title, desc, action } = getErrorMessage(error, t);
  const actionType = getErrorAction(error);
  const handleAction = actionType === "open_settings" ? () => Linking.openSettings() : onRetry;

  return (
    <Animated.View
      style={{
        transform: [{ translateY: slideAnim }],
        backgroundColor: bgColor,
        borderLeftWidth: 4,
        borderLeftColor: borderColor,
        marginHorizontal: 16,
        marginTop: 8,
        borderRadius: 12,
        padding: 12,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
        elevation: 2,
      }}
      accessibilityRole="alert"
    >
      {/* Icon */}
      <BannerIcon type={error} color={borderColor} />

      {/* Text */}
      <View style={{ flex: 1 }}>
        <Text
          style={{ fontWeight: "600", color: textColor, fontSize: 14, marginBottom: 2 }}
          accessibilityRole="text"
        >
          {title}
        </Text>
        <Text style={{ color: textColor, fontSize: 13, opacity: 0.85 }}>
          {desc}
        </Text>
        {(actionType === "open_settings" || onRetry) && (
          <TouchableOpacity
            onPress={handleAction}
            accessibilityLabel={action}
            style={{ marginTop: 6, alignSelf: "flex-start" }}
          >
            <Text
              style={{
                color: borderColor,
                fontWeight: "600",
                fontSize: 13,
                textDecorationLine: "underline",
              }}
            >
              {action}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Dismiss */}
      {onDismiss && (
        <TouchableOpacity
          onPress={onDismiss}
          accessibilityLabel={t("common.cancel")}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <X size={16} color={textColor} />
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

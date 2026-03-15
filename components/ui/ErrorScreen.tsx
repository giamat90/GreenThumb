import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { WifiOff, AlertCircle, CloudOff, ArrowLeft, RefreshCw } from "lucide-react-native";
import { COLORS } from "@/constants";
import { type AppErrorType, getErrorMessage } from "@/lib/errorHandling";

interface Props {
  error: AppErrorType;
  onRetry?: () => void;
  onGoBack?: () => void;
}

const ScreenIcon = ({ type }: { type: AppErrorType }) => {
  const size = 56;
  const color = type === "no_internet" ? COLORS.primary : COLORS.danger;
  if (type === "no_internet") return <WifiOff size={size} color={color} />;
  if (type === "ai_unavailable") return <CloudOff size={size} color={color} />;
  return <AlertCircle size={size} color={color} />;
};

export default function ErrorScreen({ error, onRetry, onGoBack }: Props) {
  const { t } = useTranslation();
  const { title, desc, action } = getErrorMessage(error, t);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: COLORS.cream,
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
      }}
      accessibilityRole="none"
    >
      {/* Illustration */}
      <View
        style={{
          width: 104,
          height: 104,
          borderRadius: 52,
          backgroundColor: "#F3F4F6",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 24,
        }}
      >
        <ScreenIcon type={error} />
      </View>

      {/* Title */}
      <Text
        style={{
          fontSize: 22,
          fontWeight: "700",
          color: COLORS.textPrimary,
          textAlign: "center",
          marginBottom: 10,
        }}
        accessibilityRole="header"
      >
        {title}
      </Text>

      {/* Description */}
      <Text
        style={{
          fontSize: 15,
          color: COLORS.textSecondary,
          textAlign: "center",
          lineHeight: 22,
          marginBottom: 32,
        }}
      >
        {desc}
      </Text>

      {/* Primary button */}
      {onRetry && (
        <TouchableOpacity
          onPress={onRetry}
          accessibilityLabel={action}
          style={{
            backgroundColor: COLORS.primary,
            paddingVertical: 14,
            paddingHorizontal: 32,
            borderRadius: 20,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
            minWidth: 180,
            justifyContent: "center",
          }}
        >
          <RefreshCw size={18} color="#fff" />
          <Text style={{ color: "#fff", fontWeight: "600", fontSize: 16 }}>{action}</Text>
        </TouchableOpacity>
      )}

      {/* Secondary button */}
      {onGoBack && (
        <TouchableOpacity
          onPress={onGoBack}
          accessibilityLabel={t("errors.goBack")}
          style={{
            paddingVertical: 12,
            paddingHorizontal: 24,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
          }}
        >
          <ArrowLeft size={16} color={COLORS.textSecondary} />
          <Text style={{ color: COLORS.textSecondary, fontSize: 15 }}>
            {t("errors.goBack")}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

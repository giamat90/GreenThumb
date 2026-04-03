import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { COLORS } from "@/constants";

export function EmptyPlants() {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>🌱</Text>
      <Text style={styles.title}>{t("emptyPlants.title")}</Text>
      <Text style={styles.subtitle}>{t("emptyPlants.subtitle")}</Text>
      <Text style={styles.arrow}>↓</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    paddingBottom: 80,
  },
  emoji: {
    fontSize: 64,
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 32,
  },
  arrow: {
    fontSize: 28,
    color: COLORS.secondary,
    opacity: 0.6,
  },
});

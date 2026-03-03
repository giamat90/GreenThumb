import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { COLORS } from "@/constants";

export function EmptyPlants() {
  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>🌱</Text>
      <Text style={styles.title}>No plants yet</Text>
      <Text style={styles.subtitle}>
        Tap the camera button below to identify and add your first plant
      </Text>
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

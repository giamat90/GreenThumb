import React from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { Droplets, Check } from "lucide-react-native";
import { COLORS } from "@/constants";
import type { PlantWithStatus } from "@/hooks/usePlants";

interface PlantCardProps {
  plant: PlantWithStatus;
  onPress: () => void;
  onWaterPress: () => void;
}

function HealthCircle({ score }: { score: number }) {
  const color =
    score > 70 ? COLORS.success : score > 40 ? COLORS.warning : COLORS.danger;
  return (
    <View style={[styles.healthCircle, { borderColor: color }]}>
      <Text style={[styles.healthScore, { color }]}>{score}</Text>
      <Text style={[styles.healthLabel, { color }]}>hp</Text>
    </View>
  );
}

function WateringLabel({
  plant,
}: {
  plant: PlantWithStatus;
}) {
  if (plant.wateredToday) {
    return (
      <View style={styles.wateringRow}>
        <Check size={12} color={COLORS.success} />
        <Text style={[styles.wateringText, { color: COLORS.success }]}>
          Just watered ✓
        </Text>
      </View>
    );
  }

  const { wateringStatus, daysUntilWatering } = plant;

  if (wateringStatus === "overdue") {
    return (
      <View style={styles.wateringRow}>
        <Droplets size={12} color={COLORS.danger} />
        <Text style={[styles.wateringText, { color: COLORS.danger }]}>
          Overdue! Water now 💧
        </Text>
      </View>
    );
  }

  if (wateringStatus === "today") {
    return (
      <View style={styles.wateringRow}>
        <Droplets size={12} color={COLORS.warning} />
        <Text style={[styles.wateringText, { color: COLORS.warning }]}>
          Water today 💧
        </Text>
      </View>
    );
  }

  if (wateringStatus === "soon" || wateringStatus === "ok") {
    return (
      <View style={styles.wateringRow}>
        <Droplets size={12} color={COLORS.textSecondary} />
        <Text style={[styles.wateringText, { color: COLORS.textSecondary }]}>
          Water in {daysUntilWatering} days
        </Text>
      </View>
    );
  }

  return null;
}

export function PlantCard({ plant, onPress, onWaterPress }: PlantCardProps) {
  const displayName = plant.name;
  const scientificName = plant.species ?? plant.common_name;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.85}
    >
      {/* Photo */}
      <View style={styles.photoContainer}>
        {plant.photo_url ? (
          <Image
            source={{ uri: plant.photo_url }}
            style={styles.photo}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.photoPlaceholder}>
            <Text style={styles.photoPlaceholderEmoji}>🌿</Text>
          </View>
        )}
      </View>

      {/* Content */}
      <View style={styles.content}>
        <Text style={styles.plantName} numberOfLines={1}>
          {displayName}
        </Text>
        {scientificName ? (
          <Text style={styles.scientificName} numberOfLines={1}>
            {scientificName}
          </Text>
        ) : null}
        <WateringLabel plant={plant} />
      </View>

      {/* Right side */}
      <View style={styles.rightSection}>
        <HealthCircle score={plant.health_score} />
        <TouchableOpacity
          style={styles.waterButton}
          onPress={onWaterPress}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Droplets size={18} color={COLORS.secondary} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 12,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
  },
  photoContainer: {
    marginRight: 12,
  },
  photo: {
    width: 80,
    height: 80,
    borderRadius: 16,
  },
  photoPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 16,
    backgroundColor: COLORS.lightgreen,
    alignItems: "center",
    justifyContent: "center",
  },
  photoPlaceholderEmoji: {
    fontSize: 32,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    gap: 3,
  },
  plantName: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.primary,
  },
  scientificName: {
    fontSize: 12,
    fontStyle: "italic",
    color: COLORS.textSecondary,
  },
  wateringRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  wateringText: {
    fontSize: 12,
    fontWeight: "500",
  },
  rightSection: {
    alignItems: "center",
    gap: 8,
    marginLeft: 8,
  },
  healthCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2.5,
    alignItems: "center",
    justifyContent: "center",
  },
  healthScore: {
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 16,
  },
  healthLabel: {
    fontSize: 8,
    fontWeight: "600",
    lineHeight: 10,
    opacity: 0.7,
  },
  waterButton: {
    padding: 4,
  },
});

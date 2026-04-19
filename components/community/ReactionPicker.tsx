import React, { useRef, useEffect } from "react";
import {
  Animated,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { useTranslation } from "react-i18next";
import { COLORS } from "@/constants";
import { REACTIONS, REACTION_ORDER, type ReactionType } from "@/lib/reactions";

interface Props {
  visible: boolean;
  anchorPageX: number;
  anchorPageY: number;
  anchorWidth: number;
  anchorHeight: number;
  currentReaction: ReactionType | null;
  onSelect: (type: ReactionType) => void;
  onDismiss: () => void;
}

const PICKER_HEIGHT = 72;
const PICKER_MARGIN = 8;

export function ReactionPicker({
  visible,
  anchorPageX,
  anchorPageY,
  anchorWidth,
  anchorHeight,
  currentReaction,
  onSelect,
  onDismiss,
}: Props) {
  const { t } = useTranslation();
  const { width: screenWidth } = useWindowDimensions();
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      scaleAnim.setValue(0.7);
      fadeAnim.setValue(0);
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 1, duration: 100, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, tension: 200, friction: 15, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, fadeAnim, scaleAnim]);

  // Picker appears above the button; if too close to top, show below
  const pickerWidth = 240;
  const spaceAbove = anchorPageY;
  const showAbove = spaceAbove > PICKER_HEIGHT + PICKER_MARGIN + 20;

  const top = showAbove
    ? anchorPageY - PICKER_HEIGHT - PICKER_MARGIN
    : anchorPageY + anchorHeight + PICKER_MARGIN;

  // Center horizontally over the anchor, clamped to screen
  let left = anchorPageX + anchorWidth / 2 - pickerWidth / 2;
  left = Math.max(8, Math.min(left, screenWidth - pickerWidth - 8));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={onDismiss} />

      <Animated.View
        style={[
          styles.picker,
          { top, left, width: pickerWidth, opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
        ]}
      >
        {REACTION_ORDER.map((type) => {
          const { emoji, labelKey } = REACTIONS[type];
          const isActive = currentReaction === type;
          return (
            <TouchableOpacity
              key={type}
              style={[styles.option, isActive && styles.optionActive]}
              onPress={() => onSelect(type)}
              activeOpacity={0.7}
            >
              <Text style={styles.emoji}>{emoji}</Text>
              <Text style={[styles.label, isActive && styles.labelActive]} numberOfLines={1}>
                {t(labelKey)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  picker: {
    position: "absolute",
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 12,
  },
  option: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 14,
    gap: 2,
  },
  optionActive: {
    backgroundColor: COLORS.lightgreen,
  },
  emoji: {
    fontSize: 22,
  },
  label: {
    fontSize: 9,
    fontWeight: "600",
    color: COLORS.textSecondary,
    textAlign: "center",
  },
  labelActive: {
    color: COLORS.primary,
  },
});

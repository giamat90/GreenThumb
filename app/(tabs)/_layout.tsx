import { Tabs, useRouter } from "expo-router";
import { Home, Leaf, Camera, CalendarDays, User } from "lucide-react-native";
import { TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS } from "@/constants";
import { useProGate } from "@/hooks/useProGate";

// ─── Custom center tab button for the Identify CTA ────────────────────────────

/**
 * Raised circular green button that sits above the tab bar.
 * Uses its own useRouter call instead of React Navigation's props-provided
 * onPress, so it is fully decoupled from the tab navigator's internal state.
 * This prevents the "Cannot read property 'stale' of undefined" crash that
 * occurs when the tab bar re-renders during an Android back-gesture animation
 * and React Navigation's onPress callback tries to read transitional state.
 */
function IdentifyTabButton() {
  const router = useRouter();
  const { checkGate, showPaywall } = useProGate();

  function handlePress() {
    if (!checkGate("unlimited_plants")) {
      showPaywall();
      return;
    }
    router.push("/(tabs)/identify");
  }

  return (
    <TouchableOpacity
      onPress={handlePress}
      accessibilityLabel="Identify a plant with your camera"
      accessibilityRole="button"
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        // Raise the button above the tab bar to create the "floating" effect
        marginTop: -22,
      }}
    >
      <View
        style={{
          width: 62,
          height: 62,
          borderRadius: 31,
          backgroundColor: COLORS.primary,
          alignItems: "center",
          justifyContent: "center",
          // Subtle shadow matching the primary green for depth
          shadowColor: COLORS.primary,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.4,
          shadowRadius: 8,
          elevation: 8,
        }}
      >
        <Camera size={26} color="white" />
      </View>
    </TouchableOpacity>
  );
}

// ─── Tab layout ───────────────────────────────────────────────────────────────

export default function TabLayout() {
  const { bottom } = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textSecondary,
        headerShown: false,
        tabBarStyle: {
          borderTopWidth: 1,
          borderTopColor: "#EFEFEF",
          elevation: 0,
          shadowOpacity: 0,
          // Account for Android system navigation bar (gesture or button nav)
          height: 60 + bottom,
          paddingBottom: bottom + 8,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} />,
        }}
      />

      <Tabs.Screen
        name="my-plants"
        options={{
          title: "My Plants",
          tabBarIcon: ({ color, size }) => <Leaf size={size} color={color} />,
        }}
      />

      {/* Identify — special center button, no icon/label from the default renderer */}
      <Tabs.Screen
        name="identify"
        options={{
          title: "Identify",
          tabBarButton: () => <IdentifyTabButton />,
        }}
      />

      <Tabs.Screen
        name="calendar"
        options={{
          title: "Calendar",
          tabBarIcon: ({ color, size }) => (
            <CalendarDays size={size} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => <User size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}

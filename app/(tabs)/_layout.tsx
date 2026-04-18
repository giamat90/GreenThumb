import { Tabs, useRouter } from "expo-router";
import { Home, Leaf, CalendarDays, Users, Plus } from "lucide-react-native";
import { TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { COLORS } from "@/constants";

// ─── Custom center tab button — New Post CTA ──────────────────────────────────

/**
 * Raised circular green button that sits above the tab bar.
 * Uses its own useRouter call instead of React Navigation's props-provided
 * onPress, so it is fully decoupled from the tab navigator's internal state.
 * This prevents the "Cannot read property 'stale' of undefined" crash that
 * occurs when the tab bar re-renders during an Android back-gesture animation
 * and React Navigation's onPress callback tries to read transitional state.
 */
function NewPostTabButton() {
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <TouchableOpacity
      onPress={() => router.push("/community/new-post")}
      accessibilityLabel={t("community.sharePost")}
      accessibilityRole="button"
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
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
          shadowColor: COLORS.primary,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.4,
          shadowRadius: 8,
          elevation: 8,
        }}
      >
        <Plus size={28} color="white" />
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
          backgroundColor: COLORS.white,
          borderTopWidth: 1,
          borderTopColor: COLORS.border,
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

      {/* Center button — new post; identify screen still reachable from Home */}
      <Tabs.Screen
        name="identify"
        options={{
          title: "",
          tabBarButton: () => <NewPostTabButton />,
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
        name="community"
        options={{
          title: "Community",
          tabBarIcon: ({ color, size }) => <Users size={size} color={color} />,
        }}
      />

      {/* Profile is accessed via the Home header button, not a tab */}
      <Tabs.Screen
        name="profile"
        options={{ href: null }}
      />
    </Tabs>
  );
}

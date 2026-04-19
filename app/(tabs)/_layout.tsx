import { Tabs, useRouter, usePathname } from "expo-router";
import { Home, Leaf, CalendarDays, Users, Plus, Camera } from "lucide-react-native";
import { TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { COLORS } from "@/constants";

// ─── Custom center tab button — context-aware CTA ────────────────────────────

/**
 * Raised circular green button that sits above the tab bar.
 * Uses its own useRouter/usePathname calls instead of React Navigation's
 * props-provided onPress, so it is fully decoupled from the tab navigator's
 * internal state. This prevents the "Cannot read property 'stale' of undefined"
 * crash that occurs when the tab bar re-renders during an Android back-gesture
 * animation and React Navigation's onPress callback tries to read transitional state.
 *
 * Icon/action adapts to the active tab:
 *   Community → Plus icon → new-post screen
 *   All other tabs → Camera icon → Plant ID identify screen
 */
function CenterTabButton() {
  const router = useRouter();
  const { t } = useTranslation();
  const pathname = usePathname();

  const isCommunity = pathname.includes("/community");
  const Icon = isCommunity ? Plus : Camera;
  const label = isCommunity ? t("community.sharePost") : "Scan a Plant";
  const destination = isCommunity ? "/community/new-post" : "/identify";

  return (
    <TouchableOpacity
      onPress={() => router.push(destination)}
      accessibilityLabel={label}
      accessibilityRole="button"
      style={{ flex: 1, alignItems: "center", justifyContent: "center", marginTop: -22 }}
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
        <Icon size={28} color="white" />
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

      {/* Center button — Camera (Plant ID) everywhere, Plus (new post) on Community */}
      <Tabs.Screen
        name="identify"
        options={{
          title: "",
          tabBarButton: () => <CenterTabButton />,
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

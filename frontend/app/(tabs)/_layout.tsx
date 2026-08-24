import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { v2 } from "@/src/designTokensV2";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/auth";

// V2.0 icon: active tab shows a pill background + forest color
function TabIcon({ name, focused, size = 20 }: { name: any; focused: boolean; size?: number }) {
  return (
    <View
      style={{
        width: 44,
        height: 30,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: focused ? v2.color.mint : "transparent",
      }}
    >
      <Feather name={name} size={size} color={focused ? v2.color.forest : v2.color.textSubtle} />
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, Platform.OS === "android" ? 10 : 14);
  const tabHeight = 66 + bottomPad;
  const { user } = useAuth();
  const isStaff = user?.role === "staff";
  const perms = user?.permissions || {};
  const canShopping = !isStaff || perms.shopping !== false;
  // stock is inside "zakupy" segment control – no separate tab

  const tabStyle = {
    headerShown: false,
    tabBarActiveTintColor: v2.color.forest,
    tabBarInactiveTintColor: v2.color.textSubtle,
    tabBarStyle: {
      backgroundColor: v2.color.card,
      borderTopColor: v2.color.border,
      borderTopWidth: 0.5,
      height: tabHeight,
      paddingTop: 8,
      paddingBottom: bottomPad,
      ...Platform.select({
        ios: { shadowColor: "#0F1F14", shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.06, shadowRadius: 12 },
        android: { elevation: 8 },
        default: {},
      }),
    },
    tabBarLabelStyle: {
      fontSize: 10, fontWeight: "800" as const, letterSpacing: 0.3,
      marginTop: 4, marginBottom: 0, textTransform: "uppercase" as const,
    },
    tabBarIconStyle: { marginTop: 0 },
    tabBarItemStyle: { paddingVertical: 2 },
  };

  // ------------------- STAFF LAYOUT (4 tabs) -------------------
  if (isStaff) {
    return (
      <Tabs screenOptions={tabStyle}>
        <Tabs.Screen
          name="grafik"
          options={{ title: "Moja praca", tabBarIcon: ({ focused }) => <TabIcon name="briefcase" focused={focused} /> }}
        />
        <Tabs.Screen
          name="obecnosc"
          options={{ title: "Obecność", tabBarIcon: ({ focused }) => <TabIcon name="clock" focused={focused} /> }}
        />
        <Tabs.Screen
          name="zadania"
          options={{ title: "Zadania", tabBarIcon: ({ focused }) => <TabIcon name="check-square" focused={focused} /> }}
        />
        <Tabs.Screen
          name="zakupy"
          options={{
            title: "Zakupy", tabBarIcon: ({ focused }) => <TabIcon name="shopping-cart" focused={focused} />,
            href: canShopping ? "/zakupy" : null,
          }}
        />
        {/* Hide admin-only tabs entirely from staff */}
        <Tabs.Screen name="kalendarz" options={{ href: null }} />
        <Tabs.Screen name="imprezy" options={{ href: null }} />
        <Tabs.Screen name="oferta" options={{ href: null }} />
        <Tabs.Screen name="koszty" options={{ href: null }} />
        <Tabs.Screen name="pracownicy" options={{ href: null }} />
        <Tabs.Screen name="rozliczenie" options={{ href: null }} />
        <Tabs.Screen name="statystyki" options={{ href: null }} />
        <Tabs.Screen name="majatek" options={{ href: null }} />
        <Tabs.Screen name="finanse" options={{ href: null }} />
        <Tabs.Screen name="wiecej"  options={{ href: null }} />
        <Tabs.Screen name="checklist-templates" options={{ href: null }} />
        <Tabs.Screen name="wspolnicy" options={{ href: null }} />
      </Tabs>
    );
  }

  // ------------------- ADMIN LAYOUT (5 main tabs) -------------------
  return (
    <Tabs screenOptions={tabStyle}>
      <Tabs.Screen name="kalendarz"  options={{ title: "Kalendarz", tabBarIcon: ({ focused }) => <TabIcon name="calendar"       focused={focused} /> }} />
      <Tabs.Screen name="oferta"     options={{ title: "Oferta",    tabBarIcon: ({ focused }) => <TabIcon name="gift"           focused={focused} /> }} />
      <Tabs.Screen name="finanse"    options={{ title: "Finanse",   tabBarIcon: ({ focused }) => <TabIcon name="dollar-sign"    focused={focused} /> }} />
      <Tabs.Screen name="pracownicy" options={{ title: "Zespół",    tabBarIcon: ({ focused }) => <TabIcon name="users"          focused={focused} /> }} />
      <Tabs.Screen name="wiecej"     options={{ title: "Więcej",    tabBarIcon: ({ focused }) => <TabIcon name="more-horizontal" focused={focused} /> }} />
      {/* Hidden — still routable via router.push(...) */}
      <Tabs.Screen name="imprezy"     options={{ href: null }} />
      <Tabs.Screen name="koszty"      options={{ href: null }} />
      <Tabs.Screen name="rozliczenie" options={{ href: null }} />
      <Tabs.Screen name="zakupy"      options={{ href: null }} />
      <Tabs.Screen name="statystyki"  options={{ href: null }} />
      <Tabs.Screen name="majatek"     options={{ href: null }} />
      <Tabs.Screen name="checklist-templates" options={{ href: null }} />
      <Tabs.Screen name="wspolnicy"   options={{ href: null }} />
      {/* Staff-only screens */}
      <Tabs.Screen name="grafik"   options={{ href: null }} />
      <Tabs.Screen name="obecnosc" options={{ href: null }} />
      <Tabs.Screen name="zadania"  options={{ href: null }} />
    </Tabs>
  );
}
// theme import kept for future — silence unused if any
void theme;

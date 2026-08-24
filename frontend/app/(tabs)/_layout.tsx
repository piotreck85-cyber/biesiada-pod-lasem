import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/auth";

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, Platform.OS === "android" ? 14 : 18);
  const tabHeight = 68 + bottomPad;
  const { user } = useAuth();
  const isStaff = user?.role === "staff";
  const perms = user?.permissions || {};
  const canShopping = !isStaff || perms.shopping !== false;
  // stock is inside "zakupy" segment control – no separate tab

  const tabStyle = {
    headerShown: false,
    tabBarActiveTintColor: theme.color.brand,
    tabBarInactiveTintColor: theme.color.onSurfaceSecondary,
    tabBarStyle: {
      backgroundColor: "rgba(255,255,255,0.92)",
      borderTopColor: theme.color.border,
      borderTopWidth: 0.5,
      height: tabHeight,
      paddingTop: 8,
      paddingBottom: bottomPad,
      ...Platform.select({
        ios: { shadowColor: "#000", shadowOffset: { width: 0, height: -1 }, shadowOpacity: 0.06, shadowRadius: 12 },
        android: { elevation: 6 },
        default: {},
      }),
    },
    tabBarLabelStyle: {
      fontSize: 10, fontWeight: "700" as const, letterSpacing: 0.4,
      marginTop: 2, marginBottom: 0, textTransform: "uppercase" as const,
    },
    tabBarIconStyle: { marginTop: 3 },
    tabBarItemStyle: { paddingVertical: 0 },
  };

  // ------------------- STAFF LAYOUT (4 tabs) -------------------
  if (isStaff) {
    return (
      <Tabs screenOptions={tabStyle}>
        <Tabs.Screen
          name="grafik"
          options={{ title: "Grafik", tabBarIcon: ({ color }) => <Feather name="calendar" color={color} size={20} /> }}
        />
        <Tabs.Screen
          name="obecnosc"
          options={{ title: "Obecność", tabBarIcon: ({ color }) => <Feather name="clock" color={color} size={20} /> }}
        />
        <Tabs.Screen
          name="zadania"
          options={{ title: "Zadania", tabBarIcon: ({ color }) => <Feather name="check-square" color={color} size={20} /> }}
        />
        <Tabs.Screen
          name="zakupy"
          options={{
            title: "Zakupy", tabBarIcon: ({ color }) => <Feather name="shopping-cart" color={color} size={20} />,
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
      <Tabs.Screen name="kalendarz"  options={{ title: "Kalendarz", tabBarIcon: ({ color }) => <Feather name="calendar"       color={color} size={20} /> }} />
      <Tabs.Screen name="oferta"     options={{ title: "Oferta",    tabBarIcon: ({ color }) => <Feather name="gift"           color={color} size={20} /> }} />
      <Tabs.Screen name="finanse"    options={{ title: "Finanse",   tabBarIcon: ({ color }) => <Feather name="dollar-sign"    color={color} size={20} /> }} />
      <Tabs.Screen name="pracownicy" options={{ title: "Zespół",    tabBarIcon: ({ color }) => <Feather name="users"          color={color} size={20} /> }} />
      <Tabs.Screen name="wiecej"     options={{ title: "Więcej",    tabBarIcon: ({ color }) => <Feather name="more-horizontal" color={color} size={20} /> }} />
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

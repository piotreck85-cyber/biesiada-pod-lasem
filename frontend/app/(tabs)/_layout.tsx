import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, Platform.OS === "android" ? 14 : 18);
  const tabHeight = 68 + bottomPad;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.color.brand,
        tabBarInactiveTintColor: theme.color.onSurfaceSecondary,
        tabBarStyle: {
          backgroundColor: "rgba(21,51,40,0.96)",
          borderTopColor: theme.color.border,
          borderTopWidth: 1,
          height: tabHeight,
          paddingTop: 8,
          paddingBottom: bottomPad,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
          letterSpacing: 0.2,
          marginTop: 2,
          marginBottom: 0,
        },
        tabBarIconStyle: { marginTop: 2 },
        tabBarItemStyle: { paddingVertical: 0 },
      }}
    >
      <Tabs.Screen
        name="kalendarz"
        options={{
          title: "Kalendarz",
          tabBarIcon: ({ color }) => <Feather name="calendar" color={color} size={20} />,
        }}
      />
      <Tabs.Screen
        name="imprezy"
        options={{
          title: "Imprezy",
          tabBarIcon: ({ color }) => <Feather name="star" color={color} size={20} />,
        }}
      />
      <Tabs.Screen
        name="oferta"
        options={{
          title: "Oferta",
          tabBarIcon: ({ color }) => <Feather name="gift" color={color} size={20} />,
        }}
      />
      <Tabs.Screen
        name="pracownicy"
        options={{
          title: "Pracownicy",
          tabBarIcon: ({ color }) => <Feather name="users" color={color} size={20} />,
        }}
      />
      <Tabs.Screen
        name="statystyki"
        options={{
          title: "Statystyki",
          tabBarIcon: ({ color }) => <Feather name="bar-chart-2" color={color} size={20} />,
        }}
      />
    </Tabs>
  );
}

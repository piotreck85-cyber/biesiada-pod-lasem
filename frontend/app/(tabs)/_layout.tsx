import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { Platform } from "react-native";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.color.brand,
        tabBarInactiveTintColor: theme.color.onSurfaceSecondary,
        tabBarStyle: {
          backgroundColor: theme.color.surfaceSecondary,
          borderTopColor: theme.color.border,
          borderTopWidth: 1,
          height: Platform.OS === "ios" ? 84 : 64,
          paddingTop: 8,
          paddingBottom: Platform.OS === "ios" ? 24 : 8,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600", letterSpacing: 0.3 },
      }}
    >
      <Tabs.Screen
        name="kalendarz"
        options={{
          title: "Kalendarz",
          tabBarIcon: ({ color, size }) => <Feather name="calendar" color={color} size={size - 2} />,
        }}
      />
      <Tabs.Screen
        name="imprezy"
        options={{
          title: "Imprezy",
          tabBarIcon: ({ color, size }) => <Feather name="star" color={color} size={size - 2} />,
        }}
      />
      <Tabs.Screen
        name="oferta"
        options={{
          title: "Oferta",
          tabBarIcon: ({ color, size }) => <Feather name="gift" color={color} size={size - 2} />,
        }}
      />
      <Tabs.Screen
        name="pracownicy"
        options={{
          title: "Pracownicy",
          tabBarIcon: ({ color, size }) => <Feather name="users" color={color} size={size - 2} />,
        }}
      />
      <Tabs.Screen
        name="statystyki"
        options={{
          title: "Statystyki",
          tabBarIcon: ({ color, size }) => <Feather name="bar-chart-2" color={color} size={size - 2} />,
        }}
      />
    </Tabs>
  );
}

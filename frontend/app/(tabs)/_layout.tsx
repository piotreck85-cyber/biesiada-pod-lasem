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
          backgroundColor: "rgba(255,255,255,0.92)",
          borderTopColor: theme.color.border,
          borderTopWidth: 0.5,
          height: tabHeight,
          paddingTop: 8,
          paddingBottom: bottomPad,
          ...Platform.select({
            ios: {
              shadowColor: "#000",
              shadowOffset: { width: 0, height: -1 },
              shadowOpacity: 0.06,
              shadowRadius: 12,
            },
            android: { elevation: 6 },
            default: {},
          }),
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: "700",
          letterSpacing: 0.4,
          marginTop: 2,
          marginBottom: 0,
          textTransform: "uppercase",
        },
        tabBarIconStyle: { marginTop: 3 },
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
          title: "Ostatnie",
          tabBarIcon: ({ color }) => <Feather name="clock" color={color} size={20} />,
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
        name="koszty"
        options={{
          title: "Koszty",
          tabBarIcon: ({ color }) => <Feather name="dollar-sign" color={color} size={20} />,
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
        name="rozliczenie"
        options={{
          title: "Kasa",
          tabBarIcon: ({ color }) => <Feather name="pie-chart" color={color} size={20} />,
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

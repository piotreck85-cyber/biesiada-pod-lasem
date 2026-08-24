import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { useAuth } from "@/src/auth";

type Tile = { key: string; label: string; sub: string; icon: any; route: string; color: string };

const TILES: Tile[] = [
  { key: "ai",       label: "AI Asystent ✨", sub: "wskazówki dnia · generator ofert · czat z AI",
    icon: "cpu", route: "/ai-asystent", color: "#285338" },
  { key: "zakupy",   label: "Zakupy i magazyn", sub: "lista zakupów · magazyn · przepisy · daty ważności",
    icon: "shopping-cart", route: "/zakupy", color: "#10B981" },
  { key: "majatek",  label: "Wyposażenie i majątek", sub: "narzędzia · dekoracje · wartość majątku",
    icon: "package", route: "/majatek", color: "#7C3AED" },
];

export default function WiecejScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { logout, user } = useAuth();
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Text style={s.brand}>Więcej</Text>
        <Text style={s.title}>Zasoby i ustawienia</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140 }}>
        <View style={{ marginTop: 6, gap: 10 }}>
          {TILES.map(t => (
            <Pressable key={t.key} onPress={() => router.push(t.route as any)} style={[s.tile, { borderColor: t.color + "44" }]}>
              <View style={[s.tileIconBox, { backgroundColor: t.color + "18" }]}>
                <Feather name={t.icon} size={22} color={t.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.tileLabel}>{t.label}</Text>
                <Text style={s.tileSub}>{t.sub}</Text>
              </View>
              <Feather name="chevron-right" size={20} color={theme.color.onSurfaceSecondary} />
            </Pressable>
          ))}
        </View>

        <View style={{ marginTop: 24 }}>
          <Text style={s.sectionTitle}>Ustawienia</Text>
          <Pressable onPress={() => router.push("/oferta")} style={s.row}>
            <Feather name="dollar-sign" size={16} color={theme.color.onSurfaceSecondary} />
            <Text style={s.rowLabel}>Cennik oferty</Text>
            <Feather name="chevron-right" size={16} color={theme.color.onSurfaceSecondary} />
          </Pressable>
          <Pressable onPress={() => router.push("/pracownicy")} style={s.row}>
            <Feather name="users" size={16} color={theme.color.onSurfaceSecondary} />
            <Text style={s.rowLabel}>Zarządzaj kontami pracowników</Text>
            <Feather name="chevron-right" size={16} color={theme.color.onSurfaceSecondary} />
          </Pressable>
          <Pressable onPress={() => router.push("/checklist-templates" as any)} style={s.row} testID="wiecej-templates">
            <Feather name="check-square" size={16} color={theme.color.onSurfaceSecondary} />
            <Text style={s.rowLabel}>Szablony zadań (checklisty)</Text>
            <Feather name="chevron-right" size={16} color={theme.color.onSurfaceSecondary} />
          </Pressable>
        </View>

        <View style={{ marginTop: 24, alignItems: "center" }}>
          <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 11 }}>{user?.email || ""}</Text>
          <Pressable onPress={logout} style={s.logoutBtn}>
            <Feather name="log-out" size={14} color={theme.color.error} />
            <Text style={s.logoutText}>Wyloguj się</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 8 },
  brand: { color: theme.color.onSurfaceSecondary, letterSpacing: 3, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  title: { color: theme.color.onSurface, fontSize: 24, fontWeight: "700" },
  tile: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, backgroundColor: theme.color.surface },
  tileIconBox: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  tileLabel: { color: theme.color.onSurface, fontSize: 16, fontWeight: "700" },
  tileSub: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  sectionTitle: { color: theme.color.onSurfaceSecondary, fontSize: 11, letterSpacing: 1, fontWeight: "700", marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface, marginBottom: 6 },
  rowLabel: { flex: 1, color: theme.color.onSurface, fontSize: 13, fontWeight: "600" },
  logoutBtn: { flexDirection: "row", alignItems: "center", gap: 6, padding: 10, marginTop: 6 },
  logoutText: { color: theme.color.error, fontSize: 12, fontWeight: "700" },
});

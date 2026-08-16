import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { theme, formatPLN } from "@/src/theme";
import { api } from "@/src/api";

type Tile = { key: string; label: string; icon: any; route: string; color: string };

const TILES: Tile[] = [
  { key: "koszty",      label: "Koszty",      icon: "trending-down", route: "/koszty",       color: "#DC2626" },
  { key: "przychody",   label: "Zyski / Przychody", icon: "trending-up", route: "/statystyki?tab=revenue", color: "#10B981" },
  { key: "kasa",        label: "Kasa",        icon: "pie-chart",    route: "/rozliczenie",  color: "#F59E0B" },
  { key: "statystyki",  label: "Statystyki",  icon: "bar-chart-2",  route: "/statystyki",   color: "#7C3AED" },
];

// Small explanatory sub-labels under each tile
const SUBTITLE: Record<string, string> = {
  koszty:      "koszty firmowe · koszty wydarzeń · kategorie",
  przychody:   "przychody · przychody wydarzeń · planowane",
  kasa:        "stan kasy · wypłaty wspólników · historia",
  statystyki:  "zysk · marża · miesiąc · rok · eksport XLSX",
};

export default function FinanseScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [summary, setSummary] = useState<any | null>(null);
  const [cash, setCash] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
      const [sum, cs]: any[] = await Promise.all([
        api.periodSummary?.(first, last).catch(() => null) ?? Promise.resolve(null),
        api.cashState?.().catch(() => null) ?? Promise.resolve(null),
      ]);
      setSummary(sum || null);
      setCash(cs?.cash_on_hand ?? cs?.balance ?? null);
    } catch {}
  }, []);
  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);

  if (loading) return <View style={s.rootLoading}><ActivityIndicator color={theme.color.brand} /></View>;

  const monthName = new Date().toLocaleDateString("pl-PL", { month: "long", year: "numeric" });
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Text style={s.brand}>Finanse</Text>
        <Text style={s.title}>Panel finansowy</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={theme.color.brand} />}>
        {/* Monthly summary */}
        <View style={s.hero}>
          <Text style={s.heroLabel}>TEN MIESIĄC · {monthName.toUpperCase()}</Text>
          <View style={s.heroRow}>
            <View style={s.heroCell}>
              <Text style={s.k}>Przychody</Text>
              <Text style={[s.v, { color: "#10B981" }]}>{formatPLN(summary?.revenue || 0)}</Text>
            </View>
            <View style={s.heroCell}>
              <Text style={s.k}>Koszty</Text>
              <Text style={[s.v, { color: "#DC2626" }]}>{formatPLN(summary?.expenses || summary?.total_cost || 0)}</Text>
            </View>
          </View>
          <View style={s.heroRow}>
            <View style={s.heroCell}>
              <Text style={s.k}>Zysk</Text>
              <Text style={[s.v, { color: theme.color.brand }]}>
                {formatPLN((summary?.revenue || 0) - (summary?.expenses || summary?.total_cost || 0))}
              </Text>
            </View>
            <View style={s.heroCell}>
              <Text style={s.k}>Stan kasy</Text>
              <Text style={[s.v, { color: "#F59E0B" }]}>{cash != null ? formatPLN(cash) : "—"}</Text>
            </View>
          </View>
        </View>

        {/* Tiles */}
        <View style={{ marginTop: 16, gap: 10 }}>
          {TILES.map(t => (
            <Pressable key={t.key} onPress={() => router.push(t.route as any)} style={[s.tile, { borderColor: t.color + "44" }]}>
              <View style={[s.tileIconBox, { backgroundColor: t.color + "18" }]}>
                <Feather name={t.icon} size={22} color={t.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.tileLabel}>{t.label}</Text>
                <Text style={s.tileSub}>{SUBTITLE[t.key]}</Text>
              </View>
              <Feather name="chevron-right" size={20} color={theme.color.onSurfaceSecondary} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  rootLoading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.surface },
  header: { paddingHorizontal: 20, paddingBottom: 8 },
  brand: { color: theme.color.onSurfaceSecondary, letterSpacing: 3, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  title: { color: theme.color.onSurface, fontSize: 24, fontWeight: "700" },
  hero: { marginTop: 6, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.color.brand + "44", backgroundColor: theme.color.brand + "0A" },
  heroLabel: { color: theme.color.onSurfaceSecondary, letterSpacing: 1, fontSize: 10, fontWeight: "700" },
  heroRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  heroCell: { flex: 1 },
  k: { color: theme.color.onSurfaceSecondary, fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  v: { fontSize: 18, fontWeight: "800", marginTop: 2 },
  tile: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, backgroundColor: theme.color.surface },
  tileIconBox: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  tileLabel: { color: theme.color.onSurface, fontSize: 16, fontWeight: "700" },
  tileSub: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
});

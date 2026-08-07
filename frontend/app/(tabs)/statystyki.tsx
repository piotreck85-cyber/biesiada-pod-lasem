import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, RefreshControl, Linking, Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme, formatPLN, MONTHS_PL } from "@/src/theme";
import { api } from "@/src/api";
import { tokenStore } from "@/src/api";

export default function Statystyki() {
  const insets = useSafeAreaInsets();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.stats(year, month + 1)); } catch {}
  }, [year, month]);

  useFocusEffect(useCallback(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]));

  const prev = () => { if (month === 0) { setMonth(11); setYear(year - 1); } else setMonth(month - 1); };
  const next = () => { if (month === 11) { setMonth(0); setYear(year + 1); } else setMonth(month + 1); };

  const doExport = async () => {
    const token = await tokenStore.get();
    const url = api.exportUrl(year, month + 1);
    if (Platform.OS === "web") {
      // Fetch with auth then trigger download
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const blob = await res.blob();
        const dl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = dl; a.download = `imprezy-${year}-${month + 1}.csv`;
        a.click(); URL.revokeObjectURL(dl);
      } catch {}
    } else {
      // On mobile: open URL - user gets viewer/share
      Linking.openURL(`${url}&token=${token}`);
    }
  };

  const revenue = data?.revenue || 0;
  const totalCost = data?.total_cost || 0;
  const profit = data?.profit || 0;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

  return (
    <View style={[s.root, { paddingTop: insets.top }]} testID="stats-screen">
      <View style={s.header}>
        <Text style={s.brand}>Statystyki</Text>
        <View style={s.monthNav}>
          <Pressable testID="stats-prev-month" onPress={prev} style={s.navBtn} hitSlop={10}>
            <Feather name="chevron-left" size={20} color={theme.color.onSurface} />
          </Pressable>
          <Text style={s.monthTitle}>{MONTHS_PL[month]} {year}</Text>
          <Pressable testID="stats-next-month" onPress={next} style={s.navBtn} hitSlop={10}>
            <Feather name="chevron-right" size={20} color={theme.color.onSurface} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 120, paddingHorizontal: 20, paddingTop: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={theme.color.brand} />}
      >
        {loading ? (
          <ActivityIndicator color={theme.color.brand} style={{ marginTop: 40 }} />
        ) : (
          <>
            <View style={s.heroCard}>
              <Text style={s.heroLabel}>Całkowity zysk</Text>
              <Text style={[s.heroValue, { color: profit >= 0 ? theme.color.brand : theme.color.error }]}>{formatPLN(profit)}</Text>
              <Text style={s.heroSub}>{data?.event_count || 0} imprez · marża {margin.toFixed(1)}%</Text>
            </View>

            <View style={s.gridRow}>
              <View style={[s.miniCard, { borderColor: "rgba(16,185,129,0.35)" }]}>
                <View style={s.miniHeader}>
                  <Feather name="trending-up" size={14} color={theme.color.success} />
                  <Text style={s.miniLabel}>Przychody</Text>
                </View>
                <Text style={s.miniValue}>{formatPLN(revenue)}</Text>
              </View>
              <View style={[s.miniCard, { borderColor: "rgba(239,68,68,0.35)" }]}>
                <View style={s.miniHeader}>
                  <Feather name="trending-down" size={14} color={theme.color.error} />
                  <Text style={s.miniLabel}>Koszty</Text>
                </View>
                <Text style={s.miniValue}>{formatPLN(totalCost)}</Text>
              </View>
            </View>

            <View style={s.breakdownCard}>
              <Text style={s.sectionTitle}>Podział kosztów</Text>
              <BreakdownRow label="Materiałowe" value={data?.material_cost || 0} />
              <BreakdownRow label="Praca (pracownicy)" value={data?.labor_cost || 0} />
              <View style={s.sep} />
              <BreakdownRow label="Razem" value={totalCost} bold />
            </View>

            <Pressable testID="export-csv-btn" onPress={doExport} style={s.exportBtn}>
              <Feather name="download" size={18} color={theme.color.brand} />
              <Text style={s.exportText}>Eksportuj do CSV</Text>
            </Pressable>

            <Text style={[s.sectionTitle, { marginTop: 24 }]}>Impreza po imprezie</Text>
            {(data?.events || []).length === 0 ? (
              <View style={s.emptyBox}>
                <Text style={s.emptyText}>Brak imprez w tym miesiącu</Text>
              </View>
            ) : (
              (data.events as any[]).map((e) => (
                <View key={e.id} style={s.evRow} testID={`stats-event-${e.id}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.evName}>{e.name}</Text>
                    <Text style={s.evDate}>{e.date}</Text>
                  </View>
                  <Text style={[s.evProfit, { color: e.profit >= 0 ? theme.color.brand : theme.color.error }]}>{formatPLN(e.profit)}</Text>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function BreakdownRow({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <View style={s.brRow}>
      <Text style={[s.brLabel, bold && { color: theme.color.onSurface, fontWeight: "700" }]}>{label}</Text>
      <Text style={[s.brValue, bold && { color: theme.color.onSurface, fontWeight: "700", fontSize: 16 }]}>{formatPLN(value)}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: 20, paddingBottom: 12, paddingTop: 8, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  brand: { color: theme.color.onSurfaceSecondary, letterSpacing: 3, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthTitle: { color: theme.color.onSurface, fontSize: 22, fontWeight: "700" },
  navBtn: { padding: 8, backgroundColor: theme.color.surfaceSecondary, borderRadius: 999 },
  heroCard: {
    backgroundColor: theme.color.surfaceSecondary, borderRadius: 20, padding: 22,
    borderWidth: 1, borderColor: theme.color.brandTertiary, marginBottom: 12,
  },
  heroLabel: { color: theme.color.onSurfaceSecondary, fontSize: 12, letterSpacing: 2, marginBottom: 6 },
  heroValue: { color: theme.color.brand, fontSize: 44, fontWeight: "800", letterSpacing: -1 },
  heroSub: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 6 },
  gridRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  miniCard: {
    flex: 1, backgroundColor: theme.color.surfaceSecondary, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: theme.color.border,
  },
  miniHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  miniLabel: { color: theme.color.onSurfaceSecondary, fontSize: 12, fontWeight: "600" },
  miniValue: { color: theme.color.onSurface, fontSize: 18, fontWeight: "700" },
  breakdownCard: {
    backgroundColor: theme.color.surfaceSecondary, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: theme.color.border, marginTop: 4,
  },
  sectionTitle: { color: theme.color.onSurface, fontSize: 15, fontWeight: "700", marginBottom: 12 },
  brRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  brLabel: { color: theme.color.onSurfaceSecondary, fontSize: 14 },
  brValue: { color: theme.color.onSurfaceTertiary, fontSize: 14 },
  sep: { height: 1, backgroundColor: theme.color.divider, marginVertical: 6 },
  exportBtn: {
    marginTop: 16, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.color.brand,
  },
  exportText: { color: theme.color.brand, fontWeight: "700", fontSize: 15 },
  evRow: {
    flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: theme.color.surfaceSecondary, borderRadius: 12, marginBottom: 6,
    borderWidth: 1, borderColor: theme.color.border,
  },
  evName: { color: theme.color.onSurface, fontSize: 14, fontWeight: "600" },
  evDate: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  evProfit: { fontSize: 15, fontWeight: "700" },
  emptyBox: { padding: 20, alignItems: "center" },
  emptyText: { color: theme.color.onSurfaceSecondary },
});

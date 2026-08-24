import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { v2 } from "@/src/designTokensV2";
import { api } from "@/src/api";
import { formatPLN } from "@/src/theme";

export default function FinanseMockup() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [kpi, setKpi] = useState<any>(null);
  const [period, setPeriod] = useState<"current_month" | "prev_month" | "current_year">("current_month");
  const load = useCallback(async () => {
    try { const r: any = await api.financeSummaryV2({ period }); setKpi(r); } catch {}
  }, [period]);
  useEffect(() => { load(); }, [load]);

  const wynik = kpi?.profit_real ?? null;
  const wynikColor = wynik === null ? v2.color.textMuted : wynik >= 0 ? v2.color.forest : v2.color.error;

  return (
    <View style={{ flex: 1, backgroundColor: v2.color.bg }}>
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={s.iconBtn}><Feather name="chevron-left" size={22} color="#fff" /></Pressable>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={s.brand}>FINANSE</Text>
          <Text style={s.title}>Wynik i przepływy</Text>
        </View>
      </View>

      {/* Period chips */}
      <View style={s.chipRow}>
        {[["current_month","Ten miesiąc"],["prev_month","Poprzedni"],["current_year","Rok"]].map(([k, l]: any) => (
          <Pressable key={k} onPress={() => setPeriod(k)} style={[s.chip, period === k && s.chipActive]}>
            <Text style={[s.chipText, period === k && s.chipTextActive]}>{l}</Text>
          </Pressable>
        ))}
        <Pressable style={s.chip}><Feather name="calendar" size={12} color={v2.color.text} /><Text style={[s.chipText, { marginLeft: 4 }]}>Zakres</Text></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 130, gap: 12 }}>
        {/* Wynik hero */}
        <View style={[s.wynikCard, { backgroundColor: wynikColor + "0A", borderColor: wynikColor + "44" }]}>
          <Text style={s.wynikLabel}>WYNIK OKRESU</Text>
          <Text style={[s.wynikValue, { color: wynikColor }]}>{kpi ? formatPLN(kpi.profit_real) : "…"}</Text>
          <Text style={s.wynikSub}>przychód realny − koszty realne</Text>
        </View>

        {/* 4 KPI */}
        <View style={s.grid}>
          {[
            { l: "Realny przychód",  v: kpi?.revenue_real, color: v2.color.success, sub: `${kpi?.payments_count ?? 0} wpłat`, icon: "trending-up" },
            { l: "Realne koszty",    v: kpi?.costs_real,   color: v2.color.error,   sub: `${kpi?.expenses_count ?? 0} dok.`,  icon: "trending-down" },
            { l: "Do pobrania",      v: kpi?.receivables,  color: v2.color.warning, sub: "od klientów",                       icon: "clock" },
            { l: "Planowana wartość",v: kpi?.price_planned, color: v2.color.info,   sub: `${kpi?.events_count ?? 0} imprez`,  icon: "calendar" },
          ].map((k, i) => (
            <View key={i} style={[s.kpi, { borderColor: k.color + "44", backgroundColor: k.color + "0A" }]}>
              <Feather name={k.icon as any} size={14} color={k.color} />
              <Text style={s.kpiLabel}>{k.l}</Text>
              <Text style={[s.kpiValue, { color: k.color }]}>{k.v !== undefined ? formatPLN(k.v || 0) : "…"}</Text>
              <Text style={s.kpiHint}>{k.sub}</Text>
            </View>
          ))}
        </View>

        {/* Tiles */}
        {[
          { l: "Koszty", d: "kategorie, historia", icon: "trending-down", route: "/koszty", color: v2.color.error },
          { l: "Przychody", d: "wpłaty klientów", icon: "trending-up", route: "/statystyki", color: v2.color.success },
          { l: "Kasa", d: "stan · przepływy", icon: "pie-chart", route: "/rozliczenie", color: v2.color.warning },
          { l: "Wypłaty wspólników", d: "osobne rozliczenia", icon: "users", route: "/wspolnicy", color: v2.color.info },
          { l: "Statystyki", d: "wykresy · eksport", icon: "bar-chart-2", route: "/statystyki", color: v2.color.moss },
        ].map((t, i) => (
          <Pressable key={i} onPress={() => router.push(t.route as any)} style={[s.tile, { borderColor: t.color + "44" }]}>
            <View style={[s.tileIcon, { backgroundColor: t.color + "18" }]}><Feather name={t.icon as any} size={20} color={t.color} /></View>
            <View style={{ flex: 1 }}><Text style={s.tileLabel}>{t.l}</Text><Text style={s.tileSub}>{t.d}</Text></View>
            <Feather name="chevron-right" size={20} color={v2.color.textSubtle} />
          </Pressable>
        ))}
      </ScrollView>

      <View style={[s.tabBar, { paddingBottom: insets.bottom + 6 }]}>
        {[["home","Start",false],["calendar","Kalendarz",false],["shopping-bag","Zakupy",false],["users","Zespół",false],["dollar-sign","Finanse",true]].map(([i,l,a]: any, k) => (
          <View key={k} style={s.tab}><Feather name={i} size={22} color={a ? v2.color.forest : v2.color.textSubtle} /><Text style={[s.tabLabel, { color: a ? v2.color.forest : v2.color.textSubtle }]}>{l}</Text></View>
        ))}
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 14, backgroundColor: v2.color.forestDeep },
  iconBtn: { width: 36, height: 36, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  brand: { color: v2.color.moss, letterSpacing: 3, fontSize: 10, fontWeight: "800" },
  title: { color: "#fff", fontSize: 18, fontWeight: "800" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, padding: 14, backgroundColor: v2.color.card, borderBottomWidth: 1, borderBottomColor: v2.color.border },
  chip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: v2.color.border, backgroundColor: v2.color.bg },
  chipActive: { borderColor: v2.color.forest, backgroundColor: v2.color.forest },
  chipText: { color: v2.color.text, fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: "#fff" },
  wynikCard: { padding: 20, borderRadius: v2.radius.xl, borderWidth: 1, alignItems: "center" },
  wynikLabel: { color: v2.color.textSubtle, fontSize: 10, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  wynikValue: { fontSize: 34, fontWeight: "800", marginTop: 6, letterSpacing: -1 },
  wynikSub: { color: v2.color.textMuted, fontSize: 11, marginTop: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kpi: { flexBasis: "48%", padding: 12, borderRadius: v2.radius.md, borderWidth: 1 },
  kpiLabel: { color: v2.color.textSubtle, fontSize: 10, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase", marginTop: 6 },
  kpiValue: { fontSize: 17, fontWeight: "800", marginTop: 3 },
  kpiHint: { color: v2.color.textSubtle, fontSize: 10, marginTop: 2 },
  tile: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: v2.radius.md, backgroundColor: v2.color.card, borderWidth: 1 },
  tileIcon: { width: 42, height: 42, borderRadius: v2.radius.sm, alignItems: "center", justifyContent: "center" },
  tileLabel: { color: v2.color.text, fontSize: 14, fontWeight: "800" },
  tileSub: { color: v2.color.textMuted, fontSize: 11, marginTop: 2 },
  tabBar: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: v2.color.card, borderTopWidth: 1, borderTopColor: v2.color.border, flexDirection: "row", justifyContent: "space-around", paddingTop: 8 },
  tab: { alignItems: "center", gap: 3 },
  tabLabel: { fontSize: 10, fontWeight: "700" },
});

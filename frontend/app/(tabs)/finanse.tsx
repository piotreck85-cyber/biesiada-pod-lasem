import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator,
  TextInput, Modal, KeyboardAvoidingView, Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { theme, formatPLN } from "@/src/theme";
import { api } from "@/src/api";

type Tile = { key: string; label: string; icon: any; route: string; color: string };

const TILES: Tile[] = [
  { key: "koszty",      label: "Koszty",       icon: "trending-down", route: "/koszty",       color: "#DC2626" },
  { key: "przychody",   label: "Przychody",    icon: "trending-up",   route: "/statystyki?tab=revenue", color: "#10B981" },
  { key: "misc",        label: "Pozostałe przychody", icon: "gift",   route: "/pozostale-przychody", color: "#14B8A6" },
  { key: "kasa",        label: "Kasa",         icon: "pie-chart",     route: "/rozliczenie",  color: "#F59E0B" },
  { key: "wspolnicy",   label: "Rozliczenia wspólników", icon: "users", route: "/wspolnicy",   color: "#7C3AED" },
  { key: "statystyki",  label: "Statystyki",   icon: "bar-chart-2",   route: "/statystyki",   color: "#0891B2" },
];

const SUBTITLE: Record<string, string> = {
  koszty:      "koszty firmowe · koszty wydarzeń · kategorie",
  przychody:   "wpłaty klientów · planowane · historia",
  misc:        "sprzedaż sprzętu · dmuchaniec · ognisko · refundy",
  kasa:        "stan kasy · rozliczenia · historia",
  wspolnicy:   "wypłaty wspólników · saldo per wspólnik",
  statystyki:  "wykresy · miesiąc · rok · eksport",
};

type Period = "current_month" | "prev_month" | "current_year" | "custom";

type Summary = {
  date_from: string; date_to: string;
  revenue_real: number; costs_real: number; profit_real: number;
  receivables: number; price_planned: number;
  events_count: number;
  events_by_status?: Record<string, number>;
  payments_count: number; expenses_count: number;
};

function toISO(d: Date) { return d.toISOString().slice(0, 10); }
function fmtDatePL(iso: string) {
  if (!iso) return "";
  try { return new Date(iso + "T00:00:00").toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" }); }
  catch { return iso; }
}

export default function FinanseScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [period, setPeriod] = useState<Period>("current_month");
  const [customFrom, setCustomFrom] = useState<string>(toISO(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [customTo, setCustomTo] = useState<string>(toISO(new Date()));
  const [customModal, setCustomModal] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const params: any = period === "custom"
        ? { date_from: customFrom, date_to: customTo }
        : { period };
      const r: any = await api.financeSummaryV2(params);
      setSummary(r);
    } catch (e) {
      // handled by UI
    } finally {
      setLoading(false);
    }
  }, [period, customFrom, customTo]);

  useEffect(() => { load(); }, [load]);

  const periodLabel = useMemo(() => {
    if (!summary) return "";
    if (period === "current_month") return "Bieżący miesiąc";
    if (period === "prev_month") return "Poprzedni miesiąc";
    if (period === "current_year") return "Bieżący rok";
    return `${fmtDatePL(summary.date_from)} – ${fmtDatePL(summary.date_to)}`;
  }, [period, summary]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Text style={s.brand}>Finanse</Text>
        <Text style={s.title}>Panel finansowy</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={theme.color.brand} />}
      >
        {/* Filtry okresu */}
        <View style={s.chipRow}>
          {([
            ["current_month", "Bieżący miesiąc"],
            ["prev_month",    "Poprzedni"],
            ["current_year",  "Rok"],
          ] as [Period, string][]).map(([k, l]) => (
            <Pressable key={k} onPress={() => setPeriod(k)}
              style={[s.chip, period === k && s.chipActive]}>
              <Text style={[s.chipText, period === k && s.chipTextActive]}>{l}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => { setPeriod("custom"); setCustomModal(true); }}
            style={[s.chip, period === "custom" && s.chipActive]}>
            <Feather name="calendar" size={12} color={period === "custom" ? theme.color.brand : theme.color.onSurface} />
            <Text style={[s.chipText, period === "custom" && s.chipTextActive, { marginLeft: 4 }]}>Zakres</Text>
          </Pressable>
        </View>
        <Text style={s.periodInfo}>{periodLabel}</Text>

        {/* KPI Cards (4 sekcje) */}
        <View style={s.kpiGrid}>
          {/* Realny przychód */}
          <View style={[s.kpiCard, { borderColor: "#10B98155", backgroundColor: "#10B9810A" }]}>
            <View style={s.kpiHead}>
              <Feather name="trending-up" size={14} color="#10B981" />
              <Text style={s.kpiLabel}>Realny przychód</Text>
            </View>
            <Text style={[s.kpiValue, { color: "#10B981" }]}>
              {loading ? "…" : formatPLN(summary?.revenue_real || 0)}
            </Text>
            <Text style={s.kpiHint}>{summary?.payments_count || 0} wpłat</Text>
          </View>
          {/* Realne koszty */}
          <View style={[s.kpiCard, { borderColor: "#DC262655", backgroundColor: "#DC26260A" }]}>
            <View style={s.kpiHead}>
              <Feather name="trending-down" size={14} color="#DC2626" />
              <Text style={s.kpiLabel}>Realne koszty</Text>
            </View>
            <Text style={[s.kpiValue, { color: "#DC2626" }]}>
              {loading ? "…" : formatPLN(summary?.costs_real || 0)}
            </Text>
            <Text style={s.kpiHint}>{summary?.expenses_count || 0} dokumentów</Text>
          </View>
          {/* Realny zysk */}
          <View style={[s.kpiCard, {
            borderColor: (summary?.profit_real || 0) >= 0 ? theme.color.brand + "55" : "#DC262655",
            backgroundColor: (summary?.profit_real || 0) >= 0 ? theme.color.brand + "0A" : "#DC26260A",
          }]}>
            <View style={s.kpiHead}>
              <Feather name="dollar-sign" size={14} color={(summary?.profit_real || 0) >= 0 ? theme.color.brand : "#DC2626"} />
              <Text style={s.kpiLabel}>Realny zysk</Text>
            </View>
            <Text style={[s.kpiValue, { color: (summary?.profit_real || 0) >= 0 ? theme.color.brand : "#DC2626" }]}>
              {loading ? "…" : formatPLN(summary?.profit_real || 0)}
            </Text>
            <Text style={s.kpiHint}>przychód − koszty</Text>
          </View>
          {/* Należności */}
          <View style={[s.kpiCard, { borderColor: "#F59E0B55", backgroundColor: "#F59E0B0A" }]}>
            <View style={s.kpiHead}>
              <Feather name="clock" size={14} color="#F59E0B" />
              <Text style={s.kpiLabel}>Do pobrania</Text>
            </View>
            <Text style={[s.kpiValue, { color: "#F59E0B" }]}>
              {loading ? "…" : formatPLN(summary?.receivables || 0)}
            </Text>
            <Text style={s.kpiHint}>od klientów</Text>
          </View>
        </View>

        {/* Info: planowana wartość imprez */}
        <View style={s.plannedBox}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Feather name="info" size={14} color={theme.color.info} />
            <Text style={s.plannedText}>
              Planowana wartość imprez: <Text style={{ fontWeight: "800" }}>{formatPLN(summary?.price_planned || 0)}</Text>
              {" "}({summary?.events_count || 0} {(summary?.events_count === 1) ? "impreza" : "imprez"})
            </Text>
          </View>
          <Text style={s.plannedHint}>
            💡 To NIE jest realny przychód — pokazuje sumę cen imprez w okresie. Realny przychód = suma faktycznie otrzymanych wpłat.
          </Text>
        </View>

        {/* Tiles do podekranów */}
        <View style={{ marginTop: 20, gap: 10 }}>
          {TILES.map(t => (
            <Pressable key={t.key} onPress={() => router.push(t.route as any)}
              style={[s.tile, { borderColor: t.color + "44" }]}>
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

      {/* Custom range modal */}
      <Modal visible={customModal} transparent animationType="slide" onRequestClose={() => setCustomModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
            <Pressable style={{ flex: 1 }} onPress={() => setCustomModal(false)} />
            <View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}>
              <View style={s.handle} />
              <Text style={s.sheetTitle}>Wybierz zakres dat</Text>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.rangeLabel}>Od</Text>
                  <TextInput value={customFrom} onChangeText={setCustomFrom}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={theme.color.onSurfaceSecondary}
                    style={s.rangeInput} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.rangeLabel}>Do</Text>
                  <TextInput value={customTo} onChangeText={setCustomTo}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={theme.color.onSurfaceSecondary}
                    style={s.rangeInput} />
                </View>
              </View>

              <Pressable onPress={() => { setCustomModal(false); setPeriod("custom"); }}
                style={s.applyBtn}>
                <Feather name="check" size={16} color="#fff" />
                <Text style={s.applyText}>Zastosuj</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 8 },
  brand: { color: theme.color.onSurfaceSecondary, letterSpacing: 3, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  title: { color: theme.color.onSurface, fontSize: 24, fontWeight: "700" },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  chip: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary,
  },
  chipActive: { borderColor: theme.color.brand, backgroundColor: theme.color.brand + "22" },
  chipText: { color: theme.color.onSurface, fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: theme.color.brand },
  periodInfo: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 6, marginBottom: 12 },

  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  kpiCard: {
    flexBasis: "48%", padding: 12, borderRadius: 12, borderWidth: 1,
  },
  kpiHead: { flexDirection: "row", alignItems: "center", gap: 4 },
  kpiLabel: { color: theme.color.onSurfaceSecondary, fontSize: 10, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  kpiValue: { fontSize: 18, fontWeight: "800", marginTop: 6 },
  kpiHint: { color: theme.color.onSurfaceSecondary, fontSize: 10, marginTop: 2 },

  plannedBox: {
    padding: 12, borderRadius: 10,
    backgroundColor: theme.color.info + "12", borderWidth: 1, borderColor: theme.color.info + "33",
  },
  plannedText: { color: theme.color.onSurface, fontSize: 12, flexShrink: 1 },
  plannedHint: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 4, lineHeight: 16 },

  tile: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, backgroundColor: theme.color.surface },
  tileIconBox: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  tileLabel: { color: theme.color.onSurface, fontSize: 16, fontWeight: "700" },
  tileSub: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },

  sheet: { backgroundColor: theme.color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.color.border, marginBottom: 12 },
  sheetTitle: { color: theme.color.onSurface, fontSize: 18, fontWeight: "800" },
  rangeLabel: { color: theme.color.onSurfaceSecondary, fontSize: 11, fontWeight: "700", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  rangeInput: { backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: theme.color.onSurface, fontSize: 15 },
  applyBtn: { marginTop: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 12, backgroundColor: theme.color.brand },
  applyText: { color: "#fff", fontWeight: "800", fontSize: 14 },
});

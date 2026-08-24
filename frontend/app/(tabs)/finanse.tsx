import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl,
  TextInput, Modal, KeyboardAvoidingView, Platform, StatusBar,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { v2 } from "@/src/designTokensV2";
import { formatPLN } from "@/src/theme";
import { api } from "@/src/api";

type Tile = { key: string; label: string; icon: any; route: string; color: string; bg: string };

const TILES: Tile[] = [
  { key: "koszty",      label: "Koszty",       icon: "trending-down", route: "/koszty",       color: v2.color.error,   bg: v2.color.errorBg },
  { key: "przychody",   label: "Przychody",    icon: "trending-up",   route: "/statystyki?tab=revenue", color: v2.color.success, bg: v2.color.successBg },
  { key: "misc",        label: "Pozostałe przychody", icon: "gift",   route: "/pozostale-przychody", color: "#0D9488",        bg: "#CCFBF1" },
  { key: "kasa",        label: "Kasa",         icon: "pie-chart",     route: "/rozliczenie",  color: v2.color.warning, bg: v2.color.warningBg },
  { key: "wspolnicy",   label: "Rozliczenia wspólników", icon: "users", route: "/wspolnicy",   color: "#7C3AED",        bg: "#EDE9FE" },
  { key: "statystyki",  label: "Statystyki",   icon: "bar-chart-2",   route: "/statystyki",   color: v2.color.info,    bg: v2.color.infoBg },
];

const SUBTITLE: Record<string, string> = {
  koszty:      "koszty firmowe · wydarzeń · kategorie",
  przychody:   "wpłaty klientów · planowane · historia",
  misc:        "sprzęt · dmuchaniec · ognisko · refundy",
  kasa:        "stan kasy · rozliczenia · historia",
  wspolnicy:   "wypłaty · saldo per wspólnik",
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
    } catch {
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

  const profit = summary?.profit_real || 0;
  const profitPositive = profit >= 0;

  return (
    <View style={{ flex: 1, backgroundColor: v2.color.bg }}>
      <StatusBar barStyle="light-content" />

      {/* HEADER (dark forest) */}
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.brand}>FINANSE</Text>
          <Text style={s.title}>Panel finansowy</Text>
          <Text style={s.subtitle}>{periodLabel}</Text>
        </View>
        <Pressable
          onPress={() => router.push("/statystyki" as any)}
          style={s.headerBtn}
          testID="fin-stats-shortcut"
        >
          <Feather name="bar-chart-2" size={18} color="#fff" />
        </Pressable>
      </View>

      {/* Period chips (on dark header) */}
      <View style={s.chipBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
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
            style={[s.chip, period === "custom" && s.chipActive, { flexDirection: "row", gap: 4 }]}>
            <Feather name="calendar" size={12} color={period === "custom" ? v2.color.forest : "#fff"} />
            <Text style={[s.chipText, period === "custom" && s.chipTextActive]}>Zakres</Text>
          </Pressable>
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={v2.color.forest} />}
      >
        {/* KPI Card (floating white) */}
        <View style={s.kpiCard}>
          {/* Główny wynik: zysk */}
          <View style={s.profitHead}>
            <View>
              <Text style={s.profitLabel}>Realny zysk</Text>
              <Text style={[s.profitValue, { color: profitPositive ? v2.color.success : v2.color.error }]}>
                {loading ? "…" : formatPLN(profit)}
              </Text>
            </View>
            <View style={[s.profitBadge, { backgroundColor: profitPositive ? v2.color.successBg : v2.color.errorBg }]}>
              <Feather
                name={profitPositive ? "trending-up" : "trending-down"}
                size={14}
                color={profitPositive ? v2.color.success : v2.color.error}
              />
              <Text style={[s.profitBadgeText, { color: profitPositive ? v2.color.success : v2.color.error }]}>
                {profitPositive ? "na plusie" : "na minusie"}
              </Text>
            </View>
          </View>

          <View style={s.divider} />

          {/* KPI grid 2x2 */}
          <View style={s.kpiGrid}>
            <View style={s.kpiItem}>
              <View style={s.kpiIconBox}>
                <Feather name="trending-up" size={13} color={v2.color.success} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.kpiLabel}>Przychód</Text>
                <Text style={s.kpiValue}>{loading ? "…" : formatPLN(summary?.revenue_real || 0)}</Text>
                <Text style={s.kpiHint}>{summary?.payments_count || 0} wpłat</Text>
              </View>
            </View>

            <View style={s.kpiItem}>
              <View style={[s.kpiIconBox, { backgroundColor: v2.color.errorBg }]}>
                <Feather name="trending-down" size={13} color={v2.color.error} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.kpiLabel}>Koszty</Text>
                <Text style={s.kpiValue}>{loading ? "…" : formatPLN(summary?.costs_real || 0)}</Text>
                <Text style={s.kpiHint}>{summary?.expenses_count || 0} dokumentów</Text>
              </View>
            </View>

            <View style={s.kpiItem}>
              <View style={[s.kpiIconBox, { backgroundColor: v2.color.warningBg }]}>
                <Feather name="clock" size={13} color={v2.color.warning} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.kpiLabel}>Do pobrania</Text>
                <Text style={s.kpiValue}>{loading ? "…" : formatPLN(summary?.receivables || 0)}</Text>
                <Text style={s.kpiHint}>od klientów</Text>
              </View>
            </View>

            <View style={s.kpiItem}>
              <View style={[s.kpiIconBox, { backgroundColor: v2.color.mint }]}>
                <Feather name="calendar" size={13} color={v2.color.forest} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.kpiLabel}>Imprezy</Text>
                <Text style={s.kpiValue}>{summary?.events_count || 0}</Text>
                <Text style={s.kpiHint}>w okresie</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Info: planowana wartość imprez */}
        <View style={s.plannedBox}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Feather name="info" size={14} color={v2.color.info} />
            <Text style={s.plannedText}>
              Planowana wartość imprez: <Text style={{ fontWeight: "800" }}>{formatPLN(summary?.price_planned || 0)}</Text>
            </Text>
          </View>
          <Text style={s.plannedHint}>
            💡 To NIE jest realny przychód — pokazuje sumę cen imprez w okresie. Realny przychód = suma faktycznie otrzymanych wpłat.
          </Text>
        </View>

        {/* Section header */}
        <View style={s.sectionHead}>
          <Text style={s.sectionLabel}>Moduły finansowe</Text>
        </View>

        {/* Tiles */}
        <View style={{ paddingHorizontal: 16, gap: 10 }}>
          {TILES.map(t => (
            <Pressable
              key={t.key}
              onPress={() => router.push(t.route as any)}
              style={({ pressed }) => [s.tile, pressed && { opacity: 0.7, transform: [{ scale: 0.995 }] }]}
              testID={`fin-tile-${t.key}`}
            >
              <View style={[s.tileIconBox, { backgroundColor: t.bg }]}>
                <Feather name={t.icon} size={20} color={t.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.tileLabel}>{t.label}</Text>
                <Text style={s.tileSub}>{SUBTITLE[t.key]}</Text>
              </View>
              <Feather name="chevron-right" size={20} color={v2.color.textSubtle} />
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {/* Custom range modal */}
      <Modal visible={customModal} transparent animationType="slide" onRequestClose={() => setCustomModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={s.modalBackdrop}>
            <Pressable style={{ flex: 1 }} onPress={() => setCustomModal(false)} />
            <View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}>
              <View style={s.handle} />
              <Text style={s.sheetTitle}>Wybierz zakres dat</Text>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.rangeLabel}>Od</Text>
                  <TextInput value={customFrom} onChangeText={setCustomFrom}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={v2.color.textSubtle}
                    style={s.rangeInput} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.rangeLabel}>Do</Text>
                  <TextInput value={customTo} onChangeText={setCustomTo}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={v2.color.textSubtle}
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
  header: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    paddingHorizontal: 20, paddingBottom: 14,
    backgroundColor: v2.color.forestDeep,
  },
  brand: { color: v2.color.moss, letterSpacing: 3, fontSize: 10, fontWeight: "800", marginBottom: 2 },
  title: { color: v2.color.onDark, fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },
  subtitle: { color: v2.color.sage, fontSize: 12, marginTop: 4, textTransform: "capitalize" },
  headerBtn: {
    width: 40, height: 40, borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
  },

  chipBar: {
    paddingBottom: 20,
    backgroundColor: v2.color.forestDeep,
  },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
    alignItems: "center", justifyContent: "center",
  },
  chipActive: { backgroundColor: v2.color.card, borderColor: v2.color.card },
  chipText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: v2.color.forest },

  // KPI card (floating)
  kpiCard: {
    marginTop: -12, marginHorizontal: 16,
    padding: 16, borderRadius: v2.radius.xl,
    backgroundColor: v2.color.card,
    ...v2.shadow.md,
  },
  profitHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  profitLabel: { color: v2.color.textSubtle, fontSize: 10, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase" },
  profitValue: { fontSize: 28, fontWeight: "800", marginTop: 4, letterSpacing: -0.8 },
  profitBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
  },
  profitBadgeText: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },

  divider: { height: 1, backgroundColor: v2.color.divider, marginVertical: 14 },

  kpiGrid: { flexDirection: "row", flexWrap: "wrap" },
  kpiItem: { flexBasis: "50%", flexDirection: "row", gap: 10, paddingVertical: 8, paddingRight: 8, alignItems: "flex-start" },
  kpiIconBox: {
    width: 30, height: 30, borderRadius: v2.radius.sm,
    backgroundColor: v2.color.successBg,
    alignItems: "center", justifyContent: "center",
  },
  kpiLabel: { color: v2.color.textSubtle, fontSize: 10, fontWeight: "800", letterSpacing: 0.3, textTransform: "uppercase" },
  kpiValue: { color: v2.color.text, fontSize: 16, fontWeight: "800", marginTop: 2, letterSpacing: -0.3 },
  kpiHint: { color: v2.color.textMuted, fontSize: 10, marginTop: 2 },

  plannedBox: {
    marginTop: 14, marginHorizontal: 16,
    padding: 12, borderRadius: v2.radius.md,
    backgroundColor: v2.color.infoBg,
    borderWidth: 1, borderColor: v2.color.info + "33",
  },
  plannedText: { color: v2.color.text, fontSize: 12, flexShrink: 1 },
  plannedHint: { color: v2.color.textMuted, fontSize: 11, marginTop: 6, lineHeight: 16 },

  sectionHead: { paddingHorizontal: 20, marginTop: 24, marginBottom: 10 },
  sectionLabel: { color: v2.color.text, fontSize: 15, fontWeight: "800" },

  tile: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderRadius: v2.radius.lg,
    backgroundColor: v2.color.card,
    borderWidth: 1, borderColor: v2.color.border,
    ...v2.shadow.sm,
  },
  tileIconBox: {
    width: 44, height: 44, borderRadius: v2.radius.md,
    alignItems: "center", justifyContent: "center",
  },
  tileLabel: { color: v2.color.text, fontSize: 15, fontWeight: "800" },
  tileSub: { color: v2.color.textMuted, fontSize: 11, marginTop: 2 },

  // Modal
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: v2.color.card,
    borderTopLeftRadius: v2.radius.xl, borderTopRightRadius: v2.radius.xl,
    padding: 20,
  },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: v2.color.borderStrong, marginBottom: 12 },
  sheetTitle: { color: v2.color.text, fontSize: 18, fontWeight: "800" },
  rangeLabel: { color: v2.color.textSubtle, fontSize: 11, fontWeight: "700", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  rangeInput: {
    backgroundColor: v2.color.cardMuted,
    borderWidth: 1, borderColor: v2.color.border,
    borderRadius: v2.radius.md,
    paddingHorizontal: 12, paddingVertical: 10,
    color: v2.color.text, fontSize: 15,
  },
  applyBtn: {
    marginTop: 18,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    padding: 14, borderRadius: v2.radius.md,
    backgroundColor: v2.color.forest,
  },
  applyText: { color: "#fff", fontWeight: "800", fontSize: 14 },
});

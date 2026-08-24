import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, StatusBar } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { v2 } from "@/src/designTokensV2";
import { api } from "@/src/api";
import { formatPLN } from "@/src/theme";

const MONTHS = ["stycznia","lutego","marca","kwietnia","maja","czerwca","lipca","sierpnia","września","października","listopada","grudnia"];
const DAYS = ["niedziela","poniedziałek","wtorek","środa","czwartek","piątek","sobota"];

function dateChip(iso: string): string {
  if (!iso) return "";
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(iso + "T00:00:00");
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "Dziś";
  if (diff === 1) return "Jutro";
  if (diff <= 6) return `Za ${diff} dni`;
  return d.toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
}

export default function StartMockup() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [kpi, setKpi] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);

  const load = useCallback(async () => {
    try {
      // Bieżący miesiąc
      const now = new Date();
      const fSum: any = await api.financeSummaryV2({ period: "current_month" });
      setKpi(fSum);
      // Najbliższe imprezy
      const evs: any = await api.listEvents(now.getFullYear(), now.getMonth() + 1);
      const todayISO = new Date().toISOString().slice(0, 10);
      const upcoming = (Array.isArray(evs) ? evs : [])
        .filter(e => e.date >= todayISO)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 3);
      setEvents(upcoming);
    } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const today = new Date();
  const greeting = today.getHours() < 12 ? "Dzień dobry" : today.getHours() < 18 ? "Miłego dnia" : "Dobry wieczór";

  const assistantInsights = [
    { icon: "alert-triangle", text: kpi?.receivables > 0 ? `Do pobrania ${formatPLN(kpi.receivables)} od klientów` : "Wszystkie zaliczki opłacone", tone: kpi?.receivables > 0 ? "warning" : "success" },
    { icon: "trending-up",    text: kpi ? `Miesiąc: ${kpi.events_count} imprez, planowane ${formatPLN(kpi.price_planned)}` : "…", tone: "info" },
    { icon: "users",          text: "Sprawdź obsadę na weekend", tone: "info" },
  ];

  const attention = [
    { severity: "error",   text: "Brak zaliczki – Wesele Nowak", route: "/imprezy" },
    { severity: "warning", text: "Nieukończona checklista – 30.08", route: "/imprezy" },
    { severity: "warning", text: "Niski stan wody (12 szt.)",       route: "/zakupy" },
    { severity: "info",    text: "Nowe zgłoszenie od Zuzi",         route: "/zadania" },
  ];

  const tone = (t: string) => ({
    error: v2.color.error, warning: v2.color.warning, info: v2.color.info, success: v2.color.success,
  } as any)[t];
  const toneBg = (t: string) => ({
    error: v2.color.errorBg, warning: v2.color.warningBg, info: v2.color.infoBg, success: v2.color.successBg,
  } as any)[t];

  return (
    <View style={{ flex: 1, backgroundColor: v2.color.bg }}>
      <StatusBar barStyle="light-content" />
      {/* Sticky glass header */}
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View>
          <Text style={s.hello}>{greeting}, Piotrek 👋</Text>
          <Text style={s.date}>
            {DAYS[today.getDay()]}, {today.getDate()} {MONTHS[today.getMonth()]}
          </Text>
        </View>
        <Pressable style={s.avatarBtn}>
          <Text style={s.avatarTxt}>P</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        {/* KPI grid 2x2 */}
        <View style={s.kpiGrid}>
          <View style={s.kpi}>
            <Feather name="calendar" size={16} color={v2.color.forest} />
            <Text style={s.kpiLabel}>Najbliższe imprezy</Text>
            <Text style={s.kpiValue}>{kpi?.events_count ?? "…"}</Text>
          </View>
          <View style={s.kpi}>
            <Feather name="users" size={16} color={v2.color.forest} />
            <Text style={s.kpiLabel}>Gości (plan)</Text>
            <Text style={s.kpiValue}>{events.reduce((sum, e) => sum + (e.guests || 0), 0) || "—"}</Text>
          </View>
          <View style={s.kpi}>
            <Feather name="trending-up" size={16} color={v2.color.success} />
            <Text style={s.kpiLabel}>Przychód (plan.)</Text>
            <Text style={[s.kpiValue, { color: v2.color.success }]}>{formatPLN(kpi?.price_planned || 0)}</Text>
          </View>
          <View style={s.kpi}>
            <Feather name="dollar-sign" size={16} color={v2.color.forest} />
            <Text style={s.kpiLabel}>Zysk (miesiąc)</Text>
            <Text style={[s.kpiValue, { color: (kpi?.profit_real || 0) >= 0 ? v2.color.forest : v2.color.error }]}>
              {formatPLN(kpi?.profit_real || 0)}
            </Text>
          </View>
        </View>

        {/* Asystent Biesiady — horizontal scroll */}
        <View style={{ paddingHorizontal: 20, marginTop: 8 }}>
          <Text style={s.sectionLabel}>✨ Asystent Biesiady</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10, paddingVertical: 6 }}>
          {assistantInsights.map((i, idx) => (
            <View key={idx} style={[s.insight, { borderLeftColor: tone(i.tone) }]}>
              <Feather name={i.icon as any} size={16} color={tone(i.tone)} />
              <Text style={s.insightText}>{i.text}</Text>
            </View>
          ))}
        </ScrollView>

        {/* Wymaga uwagi */}
        <View style={{ paddingHorizontal: 20, marginTop: 16 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
            <Text style={s.sectionLabel}>⚠️ Wymaga uwagi</Text>
            <Text style={s.sectionCount}>{attention.length}</Text>
          </View>
        </View>
        <View style={{ paddingHorizontal: 16, marginTop: 6 }}>
          {attention.map((a, idx) => (
            <Pressable key={idx} onPress={() => router.push(a.route as any)}
              style={[s.attention, { backgroundColor: toneBg(a.severity), borderLeftColor: tone(a.severity) }]}>
              <View style={[s.attentionDot, { backgroundColor: tone(a.severity) }]} />
              <Text style={s.attentionText}>{a.text}</Text>
              <Feather name="chevron-right" size={16} color={v2.color.textMuted} />
            </Pressable>
          ))}
        </View>

        {/* Najbliższe imprezy */}
        <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
            <Text style={s.sectionLabel}>📅 Najbliższe imprezy</Text>
            <Pressable onPress={() => router.push("/imprezy" as any)}>
              <Text style={s.sectionLink}>Wszystkie →</Text>
            </Pressable>
          </View>
        </View>
        <View style={{ paddingHorizontal: 16, marginTop: 6, gap: 10 }}>
          {events.length === 0 ? (
            <View style={s.emptyBox}>
              <Feather name="calendar" size={32} color={v2.color.textSubtle} />
              <Text style={s.emptyTitle}>Brak imprez w tym miesiącu</Text>
            </View>
          ) : events.map(ev => {
            const price = ev.price_total || ev.revenue || 0;
            return (
              <Pressable key={ev.id} onPress={() => router.push(`/mockup/event?id=${ev.id}` as any)} style={s.eventCard}>
                <View style={s.eventHead}>
                  <View style={s.dateChip}>
                    <Text style={s.dateChipText}>{dateChip(ev.date)}</Text>
                  </View>
                  {ev.status ? (
                    <View style={s.statusPill}>
                      <View style={s.statusDot} />
                      <Text style={s.statusText}>{ev.status}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={s.eventName}>{ev.name || "Impreza"}</Text>
                <Text style={s.eventMeta}>
                  {ev.time_start || "—"}{ev.time_end ? ` – ${ev.time_end}` : ""} · {ev.guests || 0} os. · {ev.category || "—"}
                </Text>
                <View style={s.eventFooter}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.footerLabel}>Cena</Text>
                    <Text style={s.footerValue}>{formatPLN(price)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.footerLabel}>Obsada</Text>
                    <Text style={s.footerValue}>
                      {(ev.shifts || []).length} os.
                    </Text>
                  </View>
                  <View style={{ flex: 1.2 }}>
                    <Text style={s.footerLabel}>Checklist</Text>
                    <View style={s.progressBg}>
                      <View style={[s.progressFill, { width: `${Math.random() * 60 + 20}%` }]} />
                    </View>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* Bottom tab bar (mock) */}
      <View style={[s.tabBar, { paddingBottom: insets.bottom + 6 }]}>
        {[
          { icon: "home",         label: "Start",     active: true },
          { icon: "calendar",     label: "Kalendarz", active: false },
          { icon: "shopping-bag", label: "Zakupy",    active: false },
          { icon: "users",        label: "Zespół",    active: false },
          { icon: "dollar-sign",  label: "Finanse",   active: false },
        ].map((t, i) => (
          <View key={i} style={s.tab}>
            <Feather name={t.icon as any} size={22} color={t.active ? v2.color.forest : v2.color.textSubtle} />
            <Text style={[s.tabLabel, { color: t.active ? v2.color.forest : v2.color.textSubtle }]}>{t.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    paddingHorizontal: 20, paddingBottom: 14,
    backgroundColor: v2.color.forestDeep,
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end",
  },
  hello: { color: v2.color.onDark, fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  date:  { color: v2.color.sage, fontSize: 12, marginTop: 3 },
  avatarBtn: { width: 40, height: 40, borderRadius: 999, backgroundColor: v2.color.moss, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: v2.color.onDark, fontWeight: "800", fontSize: 16 },

  kpiGrid: {
    marginTop: -16,       // ← overlap with dark header for premium look
    marginHorizontal: 16,
    padding: 4,
    borderRadius: v2.radius.xl,
    backgroundColor: v2.color.card,
    flexDirection: "row", flexWrap: "wrap",
    ...v2.shadow.md,
  },
  kpi: {
    flexBasis: "50%", padding: 14,
  },
  kpiLabel: { color: v2.color.textSubtle, fontSize: 10, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase", marginTop: 6 },
  kpiValue: { color: v2.color.text, fontSize: 20, fontWeight: "800", marginTop: 2, letterSpacing: -0.5 },

  sectionLabel: { color: v2.color.text, fontSize: 15, fontWeight: "800" },
  sectionCount: { color: v2.color.textMuted, fontSize: 12, fontWeight: "700" },
  sectionLink:  { color: v2.color.forest, fontSize: 12, fontWeight: "700" },

  insight: {
    padding: 12, borderRadius: v2.radius.md,
    backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border,
    borderLeftWidth: 3, minWidth: 220, maxWidth: 280,
    flexDirection: "row", alignItems: "center", gap: 8,
  },
  insightText: { flex: 1, color: v2.color.text, fontSize: 12, lineHeight: 17 },

  attention: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 14, marginBottom: 8, borderRadius: v2.radius.md,
    borderLeftWidth: 4,
  },
  attentionDot: { width: 8, height: 8, borderRadius: 4 },
  attentionText: { flex: 1, color: v2.color.text, fontSize: 13, fontWeight: "600" },

  emptyBox: { alignItems: "center", padding: 40, gap: 8 },
  emptyTitle: { color: v2.color.textMuted, fontSize: 13, fontWeight: "600" },

  eventCard: {
    backgroundColor: v2.color.card, borderRadius: v2.radius.xl, padding: 16,
    borderWidth: 1, borderColor: v2.color.border,
    ...v2.shadow.sm,
  },
  eventHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  dateChip: { backgroundColor: v2.color.mint, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  dateChipText: { color: v2.color.forest, fontSize: 11, fontWeight: "800", letterSpacing: 0.3 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: v2.color.successBg },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: v2.color.success },
  statusText: { color: v2.color.success, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },
  eventName: { color: v2.color.text, fontSize: 17, fontWeight: "800", marginTop: 2, letterSpacing: -0.3 },
  eventMeta: { color: v2.color.textMuted, fontSize: 12, marginTop: 3 },
  eventFooter: { flexDirection: "row", marginTop: 12, gap: 10 },
  footerLabel: { color: v2.color.textSubtle, fontSize: 10, fontWeight: "700", letterSpacing: 0.3, textTransform: "uppercase" },
  footerValue: { color: v2.color.text, fontSize: 13, fontWeight: "700", marginTop: 2 },
  progressBg: { height: 6, borderRadius: 3, backgroundColor: v2.color.divider, marginTop: 6, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3, backgroundColor: v2.color.forest },

  tabBar: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: v2.color.card,
    borderTopWidth: 1, borderTopColor: v2.color.border,
    flexDirection: "row", justifyContent: "space-around", paddingTop: 8,
  },
  tab: { alignItems: "center", gap: 3 },
  tabLabel: { fontSize: 10, fontWeight: "700" },
});

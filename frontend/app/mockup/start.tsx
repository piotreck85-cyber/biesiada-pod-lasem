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

function nextWeekendRange(): { sat: string; sun: string } {
  const today = new Date(); today.setHours(0,0,0,0);
  const dow = today.getDay();  // 0=nd, 6=sob
  const daysToSat = (6 - dow + 7) % 7;
  const sat = new Date(today); sat.setDate(today.getDate() + daysToSat);
  const sun = new Date(sat); sun.setDate(sat.getDate() + 1);
  return { sat: sat.toISOString().slice(0,10), sun: sun.toISOString().slice(0,10) };
}

// Rule-based real alerts from data. If none → empty state.
function buildAttention(events: any[]): { severity: string; text: string; route: string }[] {
  const out: { severity: string; text: string; route: string }[] = [];
  const today = new Date().toISOString().slice(0,10);
  for (const e of events) {
    if (e.date < today) continue;
    const price = e.price_total || e.revenue || 0;
    const dep = e.deposit_amount || 0;
    if (price > 0 && dep <= 0) {
      out.push({ severity: "error", text: `Brak zaliczki – ${e.name || "impreza"}`, route: `/mockup/event?id=${e.id}` });
    }
    if ((e.shifts || []).length === 0) {
      out.push({ severity: "warning", text: `Brak obsady – ${e.name || "impreza"} (${dateChip(e.date)})`, route: `/mockup/event?id=${e.id}` });
    }
  }
  return out.slice(0, 5);
}

export default function StartMockup() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [kpi, setKpi] = useState<any>(null);
  const [upcoming, setUpcoming] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const now = new Date();
      const todayISO = now.toISOString().slice(0,10);
      // Pobierz bieżący i następny miesiąc, żeby weekend zawsze objąć
      const [sum, evsA, evsB]: any = await Promise.all([
        api.financeSummaryV2({ period: "current_month" }),
        api.listEvents(now.getFullYear(), now.getMonth() + 1),
        api.listEvents(
          now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear(),
          now.getMonth() === 11 ? 1 : now.getMonth() + 2
        ),
      ]);
      const all = [...(Array.isArray(evsA) ? evsA : []), ...(Array.isArray(evsB) ? evsB : [])];
      const upc = all
        .filter(e => e.date >= todayISO)
        .sort((a, b) => a.date.localeCompare(b.date));
      setKpi(sum);
      setUpcoming(upc);
    } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const today = new Date();
  const greeting = today.getHours() < 12 ? "Dzień dobry" : today.getHours() < 18 ? "Miłego dnia" : "Dobry wieczór";

  // Weekend calc from REAL events
  const { sat, sun } = nextWeekendRange();
  const satEvents = upcoming.filter(e => e.date === sat);
  const sunEvents = upcoming.filter(e => e.date === sun);
  const weekendCard = (label: string, dateISO: string, evs: any[]) => {
    const guests = evs.reduce((s, e) => s + (e.guests || 0), 0);
    const staffNeeded = evs.reduce((s, e) => s + (e.staff_needed || (e.shifts?.length ? 0 : 1)), 0);
    const problems = evs.filter(e => {
      const price = e.price_total || e.revenue || 0;
      return price > 0 && (e.deposit_amount || 0) <= 0;
    }).length;
    // Readiness = pct of events with staff + deposit + not cancelled
    let ready = 0;
    for (const e of evs) {
      const price = e.price_total || e.revenue || 0;
      const okDep = price === 0 || (e.deposit_amount || 0) > 0;
      const okStaff = (e.shifts || []).length > 0;
      const okStat = (e.status || "").toLowerCase() !== "anulowana";
      const score = [okDep, okStaff, okStat].filter(Boolean).length;
      ready += score * 33;
    }
    const readiness = evs.length ? Math.min(100, Math.round(ready / evs.length)) : 0;
    return { label, dateISO, count: evs.length, guests, staffNeeded, problems, readiness };
  };
  const weekend = [
    weekendCard("Sobota", sat, satEvents),
    weekendCard("Niedziela", sun, sunEvents),
  ];

  const attention = buildAttention(upcoming);
  const nextThree = upcoming.slice(0, 3);

  const assistant: { icon: string; text: string; tone: string }[] = [];
  if (kpi?.receivables > 0)  assistant.push({ icon: "alert-triangle", text: `Do pobrania ${formatPLN(kpi.receivables)} od klientów`, tone: "warning" });
  if (kpi?.events_count > 0) assistant.push({ icon: "trending-up",   text: `${kpi.events_count} imprez w miesiącu · plan. ${formatPLN(kpi.price_planned)}`, tone: "info" });
  if (weekend[0].count > 0 || weekend[1].count > 0) {
    const wkTotal = weekend[0].count + weekend[1].count;
    assistant.push({ icon: "calendar", text: `Weekend: ${wkTotal} ${wkTotal === 1 ? "impreza" : "imprezy"} · ${weekend[0].guests + weekend[1].guests} gości`, tone: "info" });
  }

  const tone = (t: string) => ({ error: v2.color.error, warning: v2.color.warning, info: v2.color.info, success: v2.color.success } as any)[t];
  const toneBg = (t: string) => ({ error: v2.color.errorBg, warning: v2.color.warningBg, info: v2.color.infoBg, success: v2.color.successBg } as any)[t];

  return (
    <View style={{ flex: 1, backgroundColor: v2.color.bg }}>
      <StatusBar barStyle="light-content" />
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View>
          <Text style={s.hello}>{greeting}, Piotrek 👋</Text>
          <Text style={s.date}>{DAYS[today.getDay()]}, {today.getDate()} {MONTHS[today.getMonth()]}</Text>
        </View>
        <Pressable style={s.avatarBtn}><Text style={s.avatarTxt}>P</Text></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        {/* KPI 2x2 — spójne z upcoming events */}
        <View style={s.kpiGrid}>
          <View style={s.kpi}>
            <Feather name="calendar" size={16} color={v2.color.forest} />
            <Text style={s.kpiLabel}>Najbliższe imprezy</Text>
            <Text style={s.kpiValue}>{loading ? "…" : upcoming.length || "Brak"}</Text>
          </View>
          <View style={s.kpi}>
            <Feather name="users" size={16} color={v2.color.forest} />
            <Text style={s.kpiLabel}>Gości (plan)</Text>
            <Text style={s.kpiValue}>{loading ? "…" : (upcoming.reduce((sum, e) => sum + (e.guests || 0), 0) || "Brak")}</Text>
          </View>
          <View style={s.kpi}>
            <Feather name="trending-up" size={16} color={v2.color.success} />
            <Text style={s.kpiLabel}>Przychód (plan.)</Text>
            <Text style={[s.kpiValue, { color: v2.color.success }]}>{loading ? "…" : (kpi?.price_planned ? formatPLN(kpi.price_planned) : "Brak")}</Text>
          </View>
          <View style={s.kpi}>
            <Feather name="dollar-sign" size={16} color={v2.color.forest} />
            <Text style={s.kpiLabel}>Wynik miesiąca</Text>
            <Text style={[s.kpiValue, { color: (kpi?.profit_real || 0) >= 0 ? v2.color.forest : v2.color.error }]}>
              {loading ? "…" : (kpi ? formatPLN(kpi.profit_real) : "Brak")}
            </Text>
          </View>
        </View>

        {/* Ten weekend */}
        <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
          <Text style={s.sectionLabel}>🗓️ Ten weekend</Text>
        </View>
        <View style={{ paddingHorizontal: 16, marginTop: 6, gap: 10 }}>
          {weekend.map(w => (
            <Pressable key={w.dateISO} onPress={() => router.push("/mockup/event" as any)} style={s.weekendCard}>
              <View style={s.weekendHead}>
                <Text style={s.weekendDay}>{w.label}</Text>
                <Text style={s.weekendDate}>{new Date(w.dateISO + "T00:00:00").toLocaleDateString("pl-PL", { day: "numeric", month: "long" })}</Text>
              </View>
              {w.count === 0 ? (
                <Text style={s.weekendEmpty}>Brak imprez</Text>
              ) : (
                <>
                  <View style={s.weekendStats}>
                    <View style={s.weekendStat}>
                      <Text style={s.wsLabel}>Imprezy</Text>
                      <Text style={s.wsValue}>{w.count}</Text>
                    </View>
                    <View style={s.weekendStat}>
                      <Text style={s.wsLabel}>Gości</Text>
                      <Text style={s.wsValue}>{w.guests || "—"}</Text>
                    </View>
                    <View style={s.weekendStat}>
                      <Text style={s.wsLabel}>Problemy</Text>
                      <Text style={[s.wsValue, { color: w.problems > 0 ? v2.color.error : v2.color.text }]}>{w.problems || "0"}</Text>
                    </View>
                  </View>
                  <View style={{ marginTop: 12 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                      <Text style={s.wsLabel}>Poziom przygotowania</Text>
                      <Text style={[s.wsLabel, { color: v2.color.text, fontWeight: "800" }]}>{w.readiness}%</Text>
                    </View>
                    <View style={s.progressBg}>
                      <View style={[s.progressFill, { width: `${w.readiness}%`, backgroundColor: w.readiness >= 80 ? v2.color.success : w.readiness >= 50 ? v2.color.warning : v2.color.error }]} />
                    </View>
                  </View>
                </>
              )}
            </Pressable>
          ))}
        </View>

        {/* Asystent Biesiady */}
        {assistant.length > 0 && (
          <>
            <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
              <Text style={s.sectionLabel}>✨ Asystent Biesiady</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10, paddingVertical: 6 }}>
              {assistant.map((i, idx) => (
                <View key={idx} style={[s.insight, { borderLeftColor: tone(i.tone) }]}>
                  <Feather name={i.icon as any} size={16} color={tone(i.tone)} />
                  <Text style={s.insightText}>{i.text}</Text>
                </View>
              ))}
            </ScrollView>
          </>
        )}

        {/* Wymaga uwagi — TYLKO prawdziwe alerty, każdy klikalny */}
        <View style={{ paddingHorizontal: 20, marginTop: 16 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
            <Text style={s.sectionLabel}>⚠️ Wymaga uwagi</Text>
            {attention.length > 0 && <Text style={s.sectionCount}>{attention.length}</Text>}
          </View>
        </View>
        <View style={{ paddingHorizontal: 16, marginTop: 6 }}>
          {attention.length === 0 ? (
            <View style={s.okBox}>
              <Feather name="check-circle" size={20} color={v2.color.success} />
              <Text style={s.okText}>Wszystko pod kontrolą 🟢</Text>
            </View>
          ) : attention.map((a, idx) => (
            <Pressable key={idx} onPress={() => router.push(a.route as any)}
              style={[s.attention, { backgroundColor: toneBg(a.severity), borderLeftColor: tone(a.severity) }]}>
              <View style={[s.attentionDot, { backgroundColor: tone(a.severity) }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.attentionText}>{a.text}</Text>
                <Text style={s.attentionCta}>Rozwiąż →</Text>
              </View>
              <Feather name="chevron-right" size={18} color={v2.color.textMuted} />
            </Pressable>
          ))}
        </View>

        {/* Najbliższe imprezy — TYLKO prawdziwe */}
        <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
            <Text style={s.sectionLabel}>📅 Najbliższe imprezy</Text>
            {upcoming.length > 0 && (
              <Pressable onPress={() => router.push("/imprezy" as any)}>
                <Text style={s.sectionLink}>Wszystkie →</Text>
              </Pressable>
            )}
          </View>
        </View>
        <View style={{ paddingHorizontal: 16, marginTop: 6, gap: 10 }}>
          {loading ? null : nextThree.length === 0 ? (
            <View style={s.emptyBox}>
              <Feather name="calendar" size={32} color={v2.color.textSubtle} />
              <Text style={s.emptyTitle}>Brak nadchodzących imprez</Text>
            </View>
          ) : nextThree.map(ev => {
            const price = ev.price_total || ev.revenue || 0;
            const dep = ev.deposit_amount || 0;
            const noDeposit = price > 0 && dep <= 0;
            return (
              <Pressable key={ev.id} onPress={() => router.push(`/mockup/event?id=${ev.id}` as any)} style={s.eventCard}>
                <View style={s.eventHead}>
                  <View style={s.dateChip}><Text style={s.dateChipText}>{dateChip(ev.date)}</Text></View>
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
                    <Text style={s.footerValue}>{price > 0 ? formatPLN(price) : "Brak"}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.footerLabel}>Zaliczka</Text>
                    <Text style={[s.footerValue, { color: noDeposit ? v2.color.error : v2.color.success }]}>
                      {noDeposit ? "❌ brak" : formatPLN(dep)}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.footerLabel}>Obsada</Text>
                    <Text style={[s.footerValue, { color: (ev.shifts || []).length === 0 ? v2.color.error : v2.color.text }]}>
                      {(ev.shifts || []).length || "brak"}
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={[s.tabBar, { paddingBottom: insets.bottom + 6 }]}>
        {[
          { icon: "home", label: "Start", active: true },
          { icon: "calendar", label: "Kalendarz", active: false },
          { icon: "shopping-bag", label: "Zakupy", active: false },
          { icon: "users", label: "Zespół", active: false },
          { icon: "dollar-sign", label: "Finanse", active: false },
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
  header: { paddingHorizontal: 20, paddingBottom: 14, backgroundColor: v2.color.forestDeep, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  hello: { color: v2.color.onDark, fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  date: { color: v2.color.sage, fontSize: 12, marginTop: 3 },
  avatarBtn: { width: 40, height: 40, borderRadius: 999, backgroundColor: v2.color.moss, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: v2.color.onDark, fontWeight: "800", fontSize: 16 },

  kpiGrid: { marginTop: -16, marginHorizontal: 16, padding: 4, borderRadius: v2.radius.xl, backgroundColor: v2.color.card, flexDirection: "row", flexWrap: "wrap", ...v2.shadow.md },
  kpi: { flexBasis: "50%", padding: 14 },
  kpiLabel: { color: v2.color.textSubtle, fontSize: 10, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase", marginTop: 6 },
  kpiValue: { color: v2.color.text, fontSize: 20, fontWeight: "800", marginTop: 2, letterSpacing: -0.5 },

  sectionLabel: { color: v2.color.text, fontSize: 15, fontWeight: "800" },
  sectionCount: { color: v2.color.textMuted, fontSize: 12, fontWeight: "700" },
  sectionLink: { color: v2.color.forest, fontSize: 12, fontWeight: "700" },

  weekendCard: { padding: 16, borderRadius: v2.radius.xl, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, ...v2.shadow.sm },
  weekendHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 },
  weekendDay: { color: v2.color.text, fontSize: 17, fontWeight: "800" },
  weekendDate: { color: v2.color.textMuted, fontSize: 12, fontWeight: "600" },
  weekendEmpty: { color: v2.color.textSubtle, fontSize: 13, marginTop: 4 },
  weekendStats: { flexDirection: "row", gap: 12, marginTop: 4 },
  weekendStat: { flex: 1 },
  wsLabel: { color: v2.color.textSubtle, fontSize: 10, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  wsValue: { color: v2.color.text, fontSize: 18, fontWeight: "800", marginTop: 3 },

  insight: { padding: 12, borderRadius: v2.radius.md, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, borderLeftWidth: 3, minWidth: 220, maxWidth: 280, flexDirection: "row", alignItems: "center", gap: 8 },
  insightText: { flex: 1, color: v2.color.text, fontSize: 12, lineHeight: 17 },

  attention: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, marginBottom: 8, borderRadius: v2.radius.md, borderLeftWidth: 4 },
  attentionDot: { width: 8, height: 8, borderRadius: 4 },
  attentionText: { color: v2.color.text, fontSize: 13, fontWeight: "700" },
  attentionCta: { color: v2.color.forest, fontSize: 11, fontWeight: "800", marginTop: 2 },
  okBox: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: v2.radius.md, backgroundColor: v2.color.successBg },
  okText: { color: v2.color.success, fontSize: 13, fontWeight: "800" },

  emptyBox: { alignItems: "center", padding: 32, gap: 8, borderRadius: v2.radius.md, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, borderStyle: "dashed" },
  emptyTitle: { color: v2.color.textMuted, fontSize: 13, fontWeight: "600" },

  eventCard: { backgroundColor: v2.color.card, borderRadius: v2.radius.xl, padding: 16, borderWidth: 1, borderColor: v2.color.border, ...v2.shadow.sm },
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

  progressBg: { height: 6, borderRadius: 3, backgroundColor: v2.color.divider, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3, backgroundColor: v2.color.forest },

  tabBar: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: v2.color.card, borderTopWidth: 1, borderTopColor: v2.color.border, flexDirection: "row", justifyContent: "space-around", paddingTop: 8 },
  tab: { alignItems: "center", gap: 3 },
  tabLabel: { fontSize: 10, fontWeight: "700" },
});

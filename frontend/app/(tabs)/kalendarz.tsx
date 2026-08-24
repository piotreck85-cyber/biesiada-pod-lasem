import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, Modal, ActivityIndicator, StatusBar,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { v2 } from "@/src/designTokensV2";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { formatPLN, MONTHS_PL, DAYS_PL } from "@/src/theme";

const MONTHS_LOWER = ["stycznia","lutego","marca","kwietnia","maja","czerwca","lipca","sierpnia","września","października","listopada","grudnia"];
const DOW = ["pn","wt","śr","cz","pt","sb","nd"];

function fmt(y: number, m: number, d: number) { return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate(); }
function firstWeekday(y: number, m: number) { const day = new Date(y, m, 1).getDay(); return (day + 6) % 7; }

function dateChip(iso: string): string {
  if (!iso) return "";
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(iso + "T00:00:00");
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "Dziś";
  if (diff === 1) return "Jutro";
  if (diff >= -1 && diff < 0) return "Wczoraj";
  if (diff > 0 && diff <= 6) return `Za ${diff} dni`;
  return d.toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
}

function nextWeekendRange(): { sat: string; sun: string } {
  const today = new Date(); today.setHours(0,0,0,0);
  const daysToSat = (6 - today.getDay() + 7) % 7;
  const sat = new Date(today); sat.setDate(today.getDate() + daysToSat);
  const sun = new Date(sat); sun.setDate(sat.getDate() + 1);
  return { sat: sat.toISOString().slice(0,10), sun: sun.toISOString().slice(0,10) };
}

// Simple rule-based alerts as fallback (no AI needed)
function buildLocalAlerts(events: any[]): { severity: "error" | "warning"; text: string; eventId?: string }[] {
  const out: any[] = [];
  const todayIso = new Date().toISOString().slice(0,10);
  for (const e of events) {
    if ((e.date || "") < todayIso) continue;
    if (((e.status || "").toLowerCase()) === "anulowana") continue;
    const price = Number(e.price_total || e.revenue) || 0;
    const dep = Number(e.deposit_amount) || 0;
    if (price > 0 && dep <= 0) {
      out.push({ severity: "error", text: `Brak zaliczki — ${e.name || "impreza"} (${dateChip(e.date)})`, eventId: e.id });
    }
    if ((e.shifts || []).length === 0 && (e.date || "") >= todayIso) {
      out.push({ severity: "warning", text: `Brak obsady — ${e.name || "impreza"} (${dateChip(e.date)})`, eventId: e.id });
    }
  }
  return out.slice(0, 5);
}

type Tip = { severity: "error" | "warning" | "info" | "success"; text: string; action?: string };
type ViewMode = "pulpit" | "miesiac";

export default function Kalendarz() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const today = new Date();

  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selected, setSelected] = useState<string>(fmt(today.getFullYear(), today.getMonth(), today.getDate()));
  const [events, setEvents] = useState<any[]>([]);
  const [nextEvents, setNextEvents] = useState<any[]>([]);   // combined this + next month for upcoming section
  const [kpi, setKpi] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<ViewMode>("pulpit");
  const [aiTips, setAiTips] = useState<Tip[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [alertsModalOpen, setAlertsModalOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const monthLast = new Date(year, month + 1, 0).getDate();
      const df = `${year}-${String(month + 1).padStart(2, "0")}-01`;
      const dt = `${year}-${String(month + 1).padStart(2, "0")}-${String(monthLast).padStart(2, "0")}`;
      const nextY = month === 11 ? year + 1 : year;
      const nextM = month === 11 ? 1 : month + 2;

      const [evs, evsNext, sum, al] = await Promise.all([
        api.listEvents(year, month + 1),
        api.listEvents(nextY, nextM).catch(() => []),
        api.financeSummaryV2({ date_from: df, date_to: dt }).catch(() => null),
        api.listAlerts().catch(() => []),
      ]);
      setEvents(evs as any[]);
      setNextEvents([...(evs as any[]), ...(evsNext as any[])]);
      setKpi(sum);
      setAlerts(al as any[]);
    } catch {}
  }, [year, month]);

  const loadAiTips = useCallback(async () => {
    setAiLoading(true);
    try {
      const r: any = await api.aiAssistantTips(14);
      setAiTips(Array.isArray(r?.tips) ? r.tips.slice(0, 3) : []);
    } catch { setAiTips([]); } finally { setAiLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => {
    setLoading(true); load().finally(() => setLoading(false));
  }, [load]));
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadAiTips(); }, [loadAiTips]); // once on mount

  const eventsByDate = useMemo(() => {
    const map: Record<string, any[]> = {};
    events.forEach(e => { if (!map[e.date]) map[e.date] = []; map[e.date].push(e); });
    return map;
  }, [events]);

  const dayEvents = useMemo(() => events.filter(e => e.date === selected), [events, selected]);

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(year - 1); } else setMonth(month - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(year + 1); } else setMonth(month + 1); };

  const total = daysInMonth(year, month);
  const startPad = firstWeekday(year, month);
  const cells: (number | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  // Weekend calc
  const { sat, sun } = nextWeekendRange();
  const upcoming = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0,10);
    return nextEvents
      .filter(e => (e.date || "") >= todayIso && ((e.status || "").toLowerCase() !== "anulowana"))
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  }, [nextEvents]);
  const satEvs = upcoming.filter(e => e.date === sat);
  const sunEvs = upcoming.filter(e => e.date === sun);

  const localAttention = useMemo(() => buildLocalAlerts(upcoming), [upcoming]);

  const greeting = today.getHours() < 12 ? "Dzień dobry" : today.getHours() < 18 ? "Miłego dnia" : "Dobry wieczór";
  const firstName = (user?.name || user?.email || "").split(" ")[0].split("@")[0];

  const tone = (t: string) => ({ error: v2.color.error, warning: v2.color.warning, info: v2.color.info, success: v2.color.success } as any)[t] || v2.color.info;
  const toneBg = (t: string) => ({ error: v2.color.errorBg, warning: v2.color.warningBg, info: v2.color.infoBg, success: v2.color.successBg } as any)[t] || v2.color.infoBg;

  const weekendCard = (label: string, dateIso: string, evs: any[]) => {
    const guests = evs.reduce((sum, e) => sum + (Number(e.guests) || 0), 0);
    const problems = evs.filter(e => {
      const price = Number(e.price_total || e.revenue) || 0;
      return price > 0 && (Number(e.deposit_amount) || 0) <= 0;
    }).length;
    let ready = 0;
    for (const e of evs) {
      const price = Number(e.price_total || e.revenue) || 0;
      const okDep = price === 0 || (Number(e.deposit_amount) || 0) > 0;
      const okStaff = (e.shifts || []).length > 0;
      const okStat = ((e.status || "").toLowerCase()) !== "anulowana";
      const score = [okDep, okStaff, okStat].filter(Boolean).length;
      ready += score * 33;
    }
    const readiness = evs.length ? Math.min(100, Math.round(ready / evs.length)) : 0;
    return { label, dateIso, count: evs.length, guests, problems, readiness };
  };
  const weekend = [weekendCard("Sobota", sat, satEvs), weekendCard("Niedziela", sun, sunEvs)];

  return (
    <View style={{ flex: 1, backgroundColor: v2.color.bg }}>
      <StatusBar barStyle="light-content" />

      {/* HEADER (dark forest) */}
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View style={{ flex: 1 }}>
          {view === "pulpit" ? (
            <>
              <Text style={s.hello}>{greeting}{firstName ? `, ${firstName}` : ""} 👋</Text>
              <Text style={s.helloDate}>{DAYS_PL[today.getDay()]}, {today.getDate()} {MONTHS_LOWER[today.getMonth()]}</Text>
            </>
          ) : (
            <>
              <Text style={s.brand}>KALENDARZ</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                <Pressable onPress={prevMonth} style={s.navBtn} testID="cal-prev-month">
                  <Feather name="chevron-left" size={16} color="#fff" />
                </Pressable>
                <Text style={s.monthTitle} testID="cal-month-label">{MONTHS_PL[month]} {year}</Text>
                <Pressable onPress={nextMonth} style={s.navBtn} testID="cal-next-month">
                  <Feather name="chevron-right" size={16} color="#fff" />
                </Pressable>
              </View>
            </>
          )}
        </View>
        <Pressable
          testID="alerts-bell"
          onPress={() => setAlertsModalOpen(true)}
          style={s.bellBtn}
          hitSlop={12}
        >
          <Feather name="bell" size={18} color="#fff" />
          {alerts.length > 0 && (
            <View style={s.bellBadge}>
              <Text style={s.bellBadgeText}>{alerts.length > 9 ? "9+" : alerts.length}</Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* Toggle: Pulpit / Miesiąc */}
      <View style={s.segRow}>
        {(["pulpit", "miesiac"] as const).map(k => (
          <Pressable key={k} onPress={() => setView(k)} style={[s.seg, view === k && s.segActive]} testID={`view-${k}`}>
            <Feather name={k === "pulpit" ? "home" : "grid"} size={14} color={view === k ? v2.color.forest : "#fff"} />
            <Text style={[s.segText, view === k && s.segTextActive]}>{k === "pulpit" ? "Pulpit" : "Miesiąc"}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => {
          setRefreshing(true); await Promise.all([load(), loadAiTips()]); setRefreshing(false);
        }} tintColor={v2.color.forest} />}
      >
        {view === "pulpit" && (
          <>
            {/* KPI 2x2 */}
            <View style={s.kpiGrid}>
              <Pressable style={s.kpi} onPress={() => router.push("/(tabs)/imprezy" as any)}>
                <Feather name="calendar" size={16} color={v2.color.forest} />
                <Text style={s.kpiLabel}>Najbliższe imprezy</Text>
                <Text style={s.kpiValue}>{loading ? "…" : (upcoming.length || "Brak")}</Text>
              </Pressable>
              <Pressable style={s.kpi} onPress={() => router.push("/(tabs)/imprezy" as any)}>
                <Feather name="users" size={16} color={v2.color.forest} />
                <Text style={s.kpiLabel}>Gości (plan)</Text>
                <Text style={s.kpiValue}>{loading ? "…" : (upcoming.reduce((sum, e) => sum + (Number(e.guests) || 0), 0) || "Brak")}</Text>
              </Pressable>
              <Pressable style={s.kpi} onPress={() => router.push("/(tabs)/finanse" as any)}>
                <Feather name="trending-up" size={16} color={v2.color.success} />
                <Text style={s.kpiLabel}>Przychód (plan.)</Text>
                <Text style={[s.kpiValue, { color: v2.color.success }]}>
                  {loading ? "…" : (kpi?.price_planned ? formatPLN(kpi.price_planned) : "Brak")}
                </Text>
              </Pressable>
              <Pressable style={s.kpi} onPress={() => router.push("/(tabs)/finanse" as any)}>
                <Feather name="dollar-sign" size={16} color={v2.color.forest} />
                <Text style={s.kpiLabel}>Wynik miesiąca</Text>
                <Text style={[s.kpiValue, { color: (kpi?.profit_real || 0) >= 0 ? v2.color.forest : v2.color.error }]}>
                  {loading ? "…" : (kpi ? formatPLN(kpi.profit_real) : "Brak")}
                </Text>
              </Pressable>
            </View>

            {/* AI TIPS TOP-3 */}
            <View style={s.section}>
              <View style={s.sectionHead}>
                <Text style={s.sectionLabel}>✨ Asystent AI</Text>
                <Pressable onPress={() => router.push("/ai-asystent" as any)}>
                  <Text style={s.sectionLink}>Rozwiń →</Text>
                </Pressable>
              </View>
              {aiLoading && aiTips.length === 0 ? (
                <View style={s.aiLoading}>
                  <ActivityIndicator size="small" color={v2.color.forest} />
                  <Text style={s.aiLoadingText}>AI analizuje Twoje dane…</Text>
                </View>
              ) : aiTips.length === 0 ? (
                <View style={s.okBox}>
                  <Feather name="check-circle" size={16} color={v2.color.success} />
                  <Text style={s.okText}>Wszystko pod kontrolą 🟢</Text>
                </View>
              ) : aiTips.map((t, i) => (
                <Pressable key={i} onPress={() => router.push("/ai-asystent" as any)}
                  style={[s.aiTip, { backgroundColor: toneBg(t.severity), borderLeftColor: tone(t.severity) }]}>
                  <View style={[s.aiTipDot, { backgroundColor: tone(t.severity) }]}>
                    <Feather name={t.severity === "error" ? "alert-triangle" : t.severity === "warning" ? "clock" : "info"} size={11} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.aiTipText}>{t.text}</Text>
                    {!!t.action && <Text style={[s.aiTipAction, { color: tone(t.severity) }]}>→ {t.action}</Text>}
                  </View>
                </Pressable>
              ))}
            </View>

            {/* WEEKEND */}
            <View style={s.section}>
              <Text style={s.sectionLabel}>🗓️ Ten weekend</Text>
              <View style={{ gap: 10, marginTop: 8 }}>
                {weekend.map(w => (
                  <Pressable key={w.dateIso} style={s.weekendCard}
                    onPress={() => { setSelected(w.dateIso); setView("miesiac"); }}>
                    <View style={s.weekendHead}>
                      <View>
                        <Text style={s.weekendDay}>{w.label}</Text>
                        <Text style={s.weekendDate}>{new Date(w.dateIso + "T00:00:00").toLocaleDateString("pl-PL", { day: "numeric", month: "long" })}</Text>
                      </View>
                      {w.count > 0 && (
                        <View style={[s.readyPill, { backgroundColor: w.readiness >= 80 ? v2.color.successBg : w.readiness >= 50 ? v2.color.warningBg : v2.color.errorBg }]}>
                          <Text style={[s.readyText, { color: w.readiness >= 80 ? v2.color.success : w.readiness >= 50 ? v2.color.warning : v2.color.error }]}>{w.readiness}% gotowe</Text>
                        </View>
                      )}
                    </View>
                    {w.count === 0 ? (
                      <View style={s.emptyDay}>
                        <Feather name="coffee" size={18} color={v2.color.textSubtle} />
                        <Text style={s.emptyText}>Brak imprez tego dnia</Text>
                      </View>
                    ) : (
                      <>
                        <View style={s.weekendStats}>
                          <View style={s.wsItem}><Text style={s.wsLabel}>Imprezy</Text><Text style={s.wsValue}>{w.count}</Text></View>
                          <View style={s.wsItem}><Text style={s.wsLabel}>Gości</Text><Text style={s.wsValue}>{w.guests || "—"}</Text></View>
                          <View style={s.wsItem}><Text style={s.wsLabel}>Problemy</Text><Text style={[s.wsValue, { color: w.problems > 0 ? v2.color.error : v2.color.text }]}>{w.problems}</Text></View>
                        </View>
                        <View style={{ marginTop: 10 }}>
                          <View style={s.progressBg}>
                            <View style={[s.progressFill, { width: `${w.readiness}%`, backgroundColor: w.readiness >= 80 ? v2.color.success : w.readiness >= 50 ? v2.color.warning : v2.color.error }]} />
                          </View>
                        </View>
                      </>
                    )}
                  </Pressable>
                ))}
              </View>
            </View>

            {/* WYMAGA UWAGI (rule-based) */}
            <View style={s.section}>
              <View style={s.sectionHead}>
                <Text style={s.sectionLabel}>⚠️ Wymaga uwagi</Text>
                {localAttention.length > 0 && <Text style={s.sectionCount}>{localAttention.length}</Text>}
              </View>
              {localAttention.length === 0 ? (
                <View style={s.okBox}>
                  <Feather name="check-circle" size={16} color={v2.color.success} />
                  <Text style={s.okText}>Wszystko OK</Text>
                </View>
              ) : (
                <View style={{ gap: 8, marginTop: 8 }}>
                  {localAttention.map((a, i) => (
                    <Pressable key={i} onPress={() => a.eventId && router.push(`/event/${a.eventId}` as any)}
                      style={[s.attention, { backgroundColor: toneBg(a.severity), borderLeftColor: tone(a.severity) }]}>
                      <View style={[s.aiTipDot, { backgroundColor: tone(a.severity) }]} />
                      <Text style={s.attentionText}>{a.text}</Text>
                      <Feather name="chevron-right" size={16} color={v2.color.textMuted} />
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            {/* NAJBLIŻSZE IMPREZY */}
            <View style={s.section}>
              <View style={s.sectionHead}>
                <Text style={s.sectionLabel}>📅 Najbliższe imprezy</Text>
                {upcoming.length > 3 && (
                  <Pressable onPress={() => router.push("/(tabs)/imprezy" as any)}>
                    <Text style={s.sectionLink}>Wszystkie →</Text>
                  </Pressable>
                )}
              </View>
              {loading ? null : upcoming.length === 0 ? (
                <View style={s.emptyBox}>
                  <Feather name="calendar" size={28} color={v2.color.textSubtle} />
                  <Text style={s.emptyTitle}>Brak nadchodzących imprez</Text>
                </View>
              ) : (
                <View style={{ gap: 10, marginTop: 8 }}>
                  {upcoming.slice(0, 3).map(ev => {
                    const price = Number(ev.price_total || ev.revenue) || 0;
                    const dep = Number(ev.deposit_amount) || 0;
                    const noDeposit = price > 0 && dep <= 0;
                    return (
                      <Pressable key={ev.id} onPress={() => router.push(`/event/${ev.id}` as any)} style={s.eventCard}>
                        <View style={s.eventHead}>
                          <View style={s.dateChip}><Text style={s.dateChipText}>{dateChip(ev.date)}</Text></View>
                          {!!ev.status && (
                            <View style={s.statusPill}>
                              <View style={s.statusDot} />
                              <Text style={s.statusText}>{ev.status}</Text>
                            </View>
                          )}
                        </View>
                        <Text style={s.eventName}>{ev.name || "Impreza"}</Text>
                        <Text style={s.eventMeta}>
                          {ev.time_start || "—"}{ev.time_end ? ` – ${ev.time_end}` : ""} · {ev.guests || 0} os. · {ev.category || "—"}
                        </Text>
                        <View style={s.eventFooter}>
                          <View style={{ flex: 1 }}><Text style={s.footerLabel}>Cena</Text><Text style={s.footerValue}>{price > 0 ? formatPLN(price) : "Brak"}</Text></View>
                          <View style={{ flex: 1 }}><Text style={s.footerLabel}>Zaliczka</Text><Text style={[s.footerValue, { color: noDeposit ? v2.color.error : v2.color.success }]}>{noDeposit ? "❌ brak" : formatPLN(dep)}</Text></View>
                          <View style={{ flex: 1 }}><Text style={s.footerLabel}>Obsada</Text><Text style={[s.footerValue, { color: (ev.shifts || []).length === 0 ? v2.color.error : v2.color.text }]}>{(ev.shifts || []).length || "brak"}</Text></View>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          </>
        )}

        {view === "miesiac" && (
          <>
            {/* Legend */}
            <View style={s.legend}>
              <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: v2.color.success }]} /><Text style={s.legendText}>Zapłacone</Text></View>
              <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: v2.color.warning }]} /><Text style={s.legendText}>Zaliczka</Text></View>
              <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: v2.color.error }]} /><Text style={s.legendText}>Brak zaliczki</Text></View>
            </View>

            {/* Weekday header */}
            <View style={s.dowRow}>{DOW.map(d => <Text key={d} style={s.dowText}>{d}</Text>)}</View>

            {/* Grid */}
            <View style={s.grid}>
              {cells.map((day, idx) => {
                if (day === null) return <View key={idx} style={s.cell} />;
                const iso = fmt(year, month, day);
                const isToday = iso === today.toISOString().slice(0, 10);
                const isSelected = iso === selected;
                const evs = eventsByDate[iso] || [];
                // dot color: worst wins (error > warning > success)
                let bestColor = v2.color.forest;
                for (const e of evs) {
                  const price = Number(e.price_total || e.revenue) || 0;
                  const dep = Number(e.deposit_amount) || 0;
                  if (price > 0 && dep <= 0) { bestColor = v2.color.error; break; }
                  if (price > 0 && dep < price) bestColor = v2.color.warning;
                  else if (bestColor === v2.color.forest) bestColor = v2.color.success;
                }
                return (
                  <Pressable key={idx} onPress={() => setSelected(iso)} testID={`cal-day-${day}`}
                    style={[s.cell, isSelected && s.cellSelected, isToday && !isSelected && s.cellToday]}>
                    <Text style={[s.day, isSelected && { color: "#fff" }, isToday && !isSelected && { color: v2.color.forest, fontWeight: "800" }]}>{day}</Text>
                    {evs.length > 0 && (
                      <View style={s.dotsRow}>
                        {evs.slice(0, 3).map((_, i) => <View key={i} style={[s.eventDot, { backgroundColor: isSelected ? "#fff" : bestColor }]} />)}
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>

            {/* Agenda */}
            <View style={{ padding: 16 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                <Text style={s.agendaTitle}>{new Date(selected + "T00:00:00").toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" })}</Text>
                <Pressable onPress={() => router.push({ pathname: "/event/[id]", params: { id: "new", date: selected } } as any)}>
                  <Text style={s.sectionLink}>+ Dodaj</Text>
                </Pressable>
              </View>
              {dayEvents.length === 0 ? (
                <View style={s.emptyBox}>
                  <Feather name="calendar" size={26} color={v2.color.textSubtle} />
                  <Text style={s.emptyText}>Brak imprez tego dnia</Text>
                  <Pressable style={s.emptyBtn} onPress={() => router.push({ pathname: "/event/[id]", params: { id: "new", date: selected } } as any)}>
                    <Feather name="plus" size={13} color={v2.color.forest} />
                    <Text style={s.emptyBtnText}>Dodaj imprezę</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={{ gap: 8 }}>
                  {dayEvents.map(ev => {
                    const price = Number(ev.price_total || ev.revenue) || 0;
                    const dep = Number(ev.deposit_amount) || 0;
                    const noDeposit = price > 0 && dep <= 0;
                    return (
                      <Pressable key={ev.id} onPress={() => router.push(`/event/${ev.id}` as any)} style={s.dayEventRow}>
                        <View style={s.timeCol}>
                          <Text style={s.timeText}>{ev.time_start || "—"}</Text>
                          {!!ev.time_end && <Text style={s.timeText2}>{ev.time_end}</Text>}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={s.dayEventName}>{ev.name || "Impreza"}</Text>
                          <Text style={s.dayEventMeta}>{ev.guests || 0} os. · {ev.category || "—"}</Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={s.dayEventPrice}>{price > 0 ? formatPLN(price) : "—"}</Text>
                          {noDeposit && <Text style={s.dayEventBrak}>brak zaliczki</Text>}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>

      {/* Alerts Modal */}
      <Modal visible={alertsModalOpen} transparent animationType="slide" onRequestClose={() => setAlertsModalOpen(false)}>
        <View style={s.modalBackdrop}>
          <View style={[s.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={s.modalHead}>
              <Text style={s.modalTitle}>Powiadomienia</Text>
              <Pressable onPress={() => setAlertsModalOpen(false)}>
                <Feather name="x" size={20} color={v2.color.text} />
              </Pressable>
            </View>
            {alerts.length === 0 ? (
              <View style={{ padding: 40, alignItems: "center" }}>
                <Feather name="check-circle" size={30} color={v2.color.success} />
                <Text style={[s.okText, { marginTop: 8 }]}>Brak nowych powiadomień</Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 400 }}>
                {alerts.map((a: any) => (
                  <View key={a.id} style={s.alertRow}>
                    <Feather name="alert-circle" size={16} color={v2.color.warning} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.alertText}>{a.message || a.text || "Powiadomienie"}</Text>
                    </View>
                    <Pressable onPress={async () => { try { await api.dismissAlert(a.id); setAlerts(alerts.filter(x => x.id !== a.id)); } catch {} }}>
                      <Feather name="x" size={16} color={v2.color.textMuted} />
                    </Pressable>
                  </View>
                ))}
                {alerts.length > 1 && (
                  <Pressable style={s.dismissAll} onPress={async () => { try { await api.dismissAllAlerts(); setAlerts([]); } catch {} }}>
                    <Text style={s.dismissAllText}>Odrzuć wszystkie</Text>
                  </Pressable>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 20, paddingBottom: 14, backgroundColor: v2.color.forestDeep, gap: 8 },
  hello: { color: v2.color.onDark, fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  helloDate: { color: v2.color.sage, fontSize: 12, marginTop: 3 },
  brand: { color: v2.color.moss, letterSpacing: 3, fontSize: 10, fontWeight: "800" },
  monthTitle: { color: "#fff", fontSize: 18, fontWeight: "800", textTransform: "capitalize", minWidth: 140 },
  navBtn: { width: 30, height: 30, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  bellBtn: { width: 40, height: 40, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  bellBadge: { position: "absolute", top: -2, right: -2, backgroundColor: v2.color.error, borderRadius: 999, minWidth: 18, height: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  bellBadgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },

  segRow: { flexDirection: "row", padding: 10, gap: 8, backgroundColor: v2.color.forestDeep },
  seg: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", paddingVertical: 9, borderRadius: v2.radius.md, backgroundColor: "rgba(255,255,255,0.12)" },
  segActive: { backgroundColor: v2.color.card },
  segText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  segTextActive: { color: v2.color.forest },

  kpiGrid: { marginTop: -12, marginHorizontal: 16, padding: 4, borderRadius: v2.radius.xl, backgroundColor: v2.color.card, flexDirection: "row", flexWrap: "wrap", ...v2.shadow.md },
  kpi: { flexBasis: "50%", padding: 14 },
  kpiLabel: { color: v2.color.textSubtle, fontSize: 10, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase", marginTop: 6 },
  kpiValue: { color: v2.color.text, fontSize: 19, fontWeight: "800", marginTop: 2, letterSpacing: -0.5 },

  section: { paddingHorizontal: 16, marginTop: 20 },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 },
  sectionLabel: { color: v2.color.text, fontSize: 15, fontWeight: "800" },
  sectionCount: { color: v2.color.textMuted, fontSize: 12, fontWeight: "700" },
  sectionLink: { color: v2.color.forest, fontSize: 12, fontWeight: "800" },

  aiLoading: { flexDirection: "row", alignItems: "center", gap: 8, padding: 14, borderRadius: v2.radius.md, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, marginTop: 8 },
  aiLoadingText: { color: v2.color.textMuted, fontSize: 12 },
  aiTip: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, marginTop: 8, borderRadius: v2.radius.md, borderLeftWidth: 4 },
  aiTipDot: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 1 },
  aiTipText: { color: v2.color.text, fontSize: 13, fontWeight: "700", lineHeight: 18 },
  aiTipAction: { fontSize: 11, fontWeight: "800", marginTop: 3 },

  okBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 14, borderRadius: v2.radius.md, backgroundColor: v2.color.successBg, marginTop: 8 },
  okText: { color: v2.color.success, fontSize: 13, fontWeight: "800" },

  weekendCard: { padding: 14, borderRadius: v2.radius.xl, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, ...v2.shadow.sm },
  weekendHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  weekendDay: { color: v2.color.text, fontSize: 16, fontWeight: "800" },
  weekendDate: { color: v2.color.textMuted, fontSize: 12, fontWeight: "600", marginTop: 2 },
  readyPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  readyText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },
  emptyDay: { padding: 12, alignItems: "center", gap: 4, borderRadius: v2.radius.md, backgroundColor: v2.color.cardMuted, borderWidth: 1, borderColor: v2.color.border, borderStyle: "dashed" },
  weekendStats: { flexDirection: "row", gap: 12, marginTop: 4 },
  wsItem: { flex: 1 },
  wsLabel: { color: v2.color.textSubtle, fontSize: 9, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  wsValue: { color: v2.color.text, fontSize: 16, fontWeight: "800", marginTop: 2 },

  attention: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: v2.radius.md, borderLeftWidth: 4 },
  attentionText: { flex: 1, color: v2.color.text, fontSize: 13, fontWeight: "700" },

  emptyBox: { padding: 24, alignItems: "center", gap: 8, borderRadius: v2.radius.md, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, borderStyle: "dashed", marginTop: 8 },
  emptyTitle: { color: v2.color.textMuted, fontSize: 13, fontWeight: "700" },
  emptyText: { color: v2.color.textSubtle, fontSize: 12 },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: v2.radius.md, backgroundColor: v2.color.mint, marginTop: 6 },
  emptyBtnText: { color: v2.color.forest, fontWeight: "800", fontSize: 12 },

  eventCard: { backgroundColor: v2.color.card, borderRadius: v2.radius.xl, padding: 14, borderWidth: 1, borderColor: v2.color.border, ...v2.shadow.sm },
  eventHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  dateChip: { backgroundColor: v2.color.mint, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  dateChipText: { color: v2.color.forest, fontSize: 11, fontWeight: "800", letterSpacing: 0.3 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: v2.color.successBg },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: v2.color.success },
  statusText: { color: v2.color.success, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },
  eventName: { color: v2.color.text, fontSize: 16, fontWeight: "800", marginTop: 2, letterSpacing: -0.3 },
  eventMeta: { color: v2.color.textMuted, fontSize: 12, marginTop: 3 },
  eventFooter: { flexDirection: "row", marginTop: 10, gap: 8 },
  footerLabel: { color: v2.color.textSubtle, fontSize: 9, fontWeight: "700", letterSpacing: 0.3, textTransform: "uppercase" },
  footerValue: { color: v2.color.text, fontSize: 12, fontWeight: "700", marginTop: 2 },

  legend: { flexDirection: "row", gap: 12, padding: 12, justifyContent: "center" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: v2.color.textMuted, fontSize: 11, fontWeight: "600" },
  dowRow: { flexDirection: "row", paddingHorizontal: 8 },
  dowText: { flex: 1, textAlign: "center", color: v2.color.textSubtle, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 8, paddingTop: 4 },
  cell: { width: `${100/7}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center", padding: 2 },
  cellToday: { backgroundColor: v2.color.mint, borderRadius: v2.radius.md },
  cellSelected: { backgroundColor: v2.color.forest, borderRadius: v2.radius.md },
  day: { color: v2.color.text, fontSize: 14, fontWeight: "600" },
  dotsRow: { flexDirection: "row", gap: 2, marginTop: 3 },
  eventDot: { width: 4, height: 4, borderRadius: 2 },
  agendaTitle: { color: v2.color.text, fontSize: 16, fontWeight: "800", textTransform: "capitalize" },

  dayEventRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: v2.radius.md, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border },
  timeCol: { alignItems: "center", width: 46 },
  timeText: { color: v2.color.forest, fontSize: 13, fontWeight: "800" },
  timeText2: { color: v2.color.textMuted, fontSize: 11 },
  dayEventName: { color: v2.color.text, fontSize: 14, fontWeight: "800" },
  dayEventMeta: { color: v2.color.textMuted, fontSize: 11, marginTop: 2 },
  dayEventPrice: { color: v2.color.text, fontSize: 13, fontWeight: "800" },
  dayEventBrak: { color: v2.color.error, fontSize: 10, fontWeight: "800", marginTop: 2 },

  progressBg: { height: 6, borderRadius: 3, backgroundColor: v2.color.divider, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3 },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: v2.color.card, borderTopLeftRadius: v2.radius.xl, borderTopRightRadius: v2.radius.xl, padding: 16 },
  modalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  modalTitle: { color: v2.color.text, fontSize: 18, fontWeight: "800" },
  alertRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, marginBottom: 6, borderRadius: v2.radius.md, backgroundColor: v2.color.warningBg },
  alertText: { color: v2.color.text, fontSize: 13 },
  dismissAll: { padding: 12, alignItems: "center", borderRadius: v2.radius.md, backgroundColor: v2.color.cardMuted, marginTop: 8 },
  dismissAllText: { color: v2.color.forest, fontWeight: "800", fontSize: 13 },
});

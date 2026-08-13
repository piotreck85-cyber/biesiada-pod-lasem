import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl, Modal,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme, MONTHS_PL, DAYS_PL, formatPLN, initials } from "@/src/theme";
import { api } from "@/src/api";
import { categoryLabel } from "@/src/categories";
import { findAdultSet } from "@/src/offers";
import { useAuth } from "@/src/auth";
import { printSchedule, printMonthCalendar } from "@/src/printSchedule";

function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate(); }
// return weekday index Mon=0..Sun=6 for a given date (m: 0-11)
function firstWeekday(y: number, m: number) {
  const d = new Date(y, m, 1).getDay(); // 0 = Sun
  return (d + 6) % 7;
}
function fmt(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function formatTimeRange(start?: string, end?: string, legacy?: string): string {
  const compact = (t?: string) => {
    if (!t) return "";
    const [h, m] = t.split(":");
    return m && m !== "00" ? `${parseInt(h, 10)}:${m}` : `${parseInt(h, 10)}`;
  };
  if (start && end) return `${compact(start)}–${compact(end)}`;
  if (start) return compact(start);
  return legacy || "—";
}

// Color per event category — matches offer types (firmowe/okolicznościowe/urodziny/warsztaty)
function categoryColor(category?: string): string {
  const c = (category || "").toLowerCase();
  if (c.startsWith("dorosli/firmowe")) return "#60A5FA";           // niebieski – firmowe
  if (c.startsWith("dorosli/okolicznosciowe")) return "#D4AF37";   // złoto – okolicznościowe
  if (c.startsWith("dorosli")) return "#D4AF37";                   // fallback dla dorosłych
  if (c.startsWith("dzieci/urodzinki")) return "#F472B6";          // róż – urodziny
  if (c.startsWith("warsztaty")) return "#34D399";                 // zielony – warsztaty (nowe)
  if (c.startsWith("dzieci/wycieczki")) return "#34D399";          // zielony – wycieczki szkolne (traktujemy jako warsztaty)
  return "#9CA3AF";                                                // szary – bez kategorii
}

export default function Kalendarz() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selected, setSelected] = useState<string>(fmt(today.getFullYear(), today.getMonth(), today.getDate()));
  const [events, setEvents] = useState<any[]>([]);
  const [staffAll, setStaffAll] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mode, setMode] = useState<"events" | "schedule">("events");

  const load = useCallback(async () => {
    try {
      const [evs, staff] = await Promise.all([api.listEvents(year, month + 1), api.listStaff()]);
      setEvents(evs as any[]);
      setStaffAll(staff as any[]);
    } catch {}
  }, [year, month]);

  useFocusEffect(useCallback(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]));
  useEffect(() => { load(); }, [load]);

  const eventDates = useMemo(() => {
    const map: Record<string, { count: number; entries: { name: string; color: string }[] }> = {};
    events.forEach(e => {
      if (!map[e.date]) map[e.date] = { count: 0, entries: [] };
      map[e.date].count += 1;
      map[e.date].entries.push({ name: e.name, color: categoryColor(e.category) });
    });
    return map;
  }, [events]);

  const dayEvents = useMemo(() => events.filter(e => e.date === selected), [events, selected]);

  const staffMap = useMemo(() => {
    const m: Record<string, any> = {};
    staffAll.forEach(s => m[s.id] = s);
    return m;
  }, [staffAll]);

  // Aggregated shifts for the selected day across all events, per staff
  const dayShifts = useMemo(() => {
    const map: Record<string, { staff: any; hours: number; amount: number; eventNames: string[] }> = {};
    dayEvents.forEach(ev => {
      (ev.shifts || []).forEach((sh: any) => {
        const s = staffMap[sh.staff_id];
        if (!s) return;
        const row = map[sh.staff_id] || { staff: s, hours: 0, amount: 0, eventNames: [] };
        row.hours += Number(sh.hours) || 0;
        row.amount += (Number(sh.hours) || 0) * (Number(s.hourly_rate) || 0);
        row.eventNames.push(ev.name);
        map[sh.staff_id] = row;
      });
    });
    return Object.values(map).sort((a, b) => b.hours - a.hours);
  }, [dayEvents, staffMap]);

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(year - 1); }
    else setMonth(month - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(year + 1); }
    else setMonth(month + 1);
  };

  const total = daysInMonth(year, month);
  const startPad = firstWeekday(year, month);
  const cells: (number | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <View style={[s.root, { paddingTop: insets.top }]} testID="calendar-screen">
      <View style={s.header}>
        <Text style={s.brand}>Kalendarz</Text>
        <View style={s.monthNav}>
          <Pressable testID="cal-prev-month" onPress={prevMonth} style={s.navBtn} hitSlop={12}>
            <Feather name="chevron-left" size={20} color={theme.color.onSurface} />
          </Pressable>
          <Text style={s.monthTitle} testID="cal-month-label">{MONTHS_PL[month]} {year}</Text>
          <Pressable testID="cal-next-month" onPress={nextMonth} style={s.navBtn} hitSlop={12}>
            <Feather name="chevron-right" size={20} color={theme.color.onSurface} />
          </Pressable>
        </View>
        <View style={s.modeToggle}>
          <Pressable
            testID="mode-events"
            onPress={() => setMode("events")}
            style={[s.modeBtn, mode === "events" && s.modeBtnActive]}
          >
            <Feather name="star" size={13} color={mode === "events" ? theme.color.onBrand : theme.color.onSurfaceSecondary} />
            <Text style={[s.modeText, mode === "events" && s.modeTextActive]}>Imprezy</Text>
          </Pressable>
          <Pressable
            testID="mode-schedule"
            onPress={() => setMode("schedule")}
            style={[s.modeBtn, mode === "schedule" && s.modeBtnActive]}
          >
            <Feather name="users" size={13} color={mode === "schedule" ? theme.color.onBrand : theme.color.onSurfaceSecondary} />
            <Text style={[s.modeText, mode === "schedule" && s.modeTextActive]}>Grafik</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={theme.color.brand} />}
      >
        <View style={s.calendarWrap}>
          <View style={s.weekRow}>
            {DAYS_PL.map(d => <Text key={d} style={s.weekLabel}>{d}</Text>)}
          </View>
          <View style={s.gridWrap}>
            {cells.map((d, i) => {
              if (d === null) return <View key={i} style={s.cell} />;
              const dateStr = fmt(year, month, d);
              const isSel = dateStr === selected;
              const isToday = dateStr === fmt(today.getFullYear(), today.getMonth(), today.getDate());
              const info = eventDates[dateStr];
              const count = info?.count || 0;
              const entries = info?.entries || [];
              return (
                <Pressable
                  key={i}
                  onPress={() => setSelected(dateStr)}
                  style={[s.cell, isSel && s.cellSelected]}
                  testID={`day-${dateStr}`}
                >
                  <Text style={[s.cellText, isSel && s.cellTextSelected, isToday && !isSel && { color: theme.color.brand, fontWeight: "700" }]}>{d}</Text>
                  {count > 0 && (
                    <View style={s.cellEventList}>
                      {entries.slice(0, 2).map((en, idx) => (
                        <Text
                          key={idx}
                          numberOfLines={1}
                          style={[
                            s.cellEventName,
                            { color: en.color },
                            isSel && { color: theme.color.onBrand },
                          ]}
                        >
                          {en.name}
                        </Text>
                      ))}
                      {count > 2 && (
                        <Text style={[s.cellEventMore, isSel && { color: theme.color.onBrand }]}>+{count - 2}</Text>
                      )}
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={s.listSection}>
          <View style={s.listHeaderRow}>
            <Text style={s.sectionTitle}>
              {mode === "events" ? "Wydarzenia" : "Grafik pracowników"} — {new Date(selected).toLocaleDateString("pl-PL", { day: "numeric", month: "long" })}
            </Text>
            <Pressable
              testID={mode === "schedule" ? "print-grafik-btn" : "print-month-btn"}
              onPress={() => {
                if (mode === "schedule") {
                  printSchedule({ year, month, events, staff: staffAll, ownerName: user?.name });
                } else {
                  printMonthCalendar({ year, month, events, staff: staffAll, ownerName: user?.name });
                }
              }}
              style={s.printBtn}
            >
              <Feather name="printer" size={14} color={theme.color.brand} />
              <Text style={s.printBtnText}>{mode === "schedule" ? "Drukuj grafik" : "Drukuj miesiąc"}</Text>
            </Pressable>
          </View>
          {loading ? (
            <ActivityIndicator color={theme.color.brand} style={{ marginTop: 24 }} />
          ) : mode === "events" ? (
            dayEvents.length === 0 ? (
              <View style={s.emptyBox}>
                <Feather name="calendar" size={32} color={theme.color.onSurfaceSecondary} />
                <Text style={s.emptyText}>Brak wydarzeń tego dnia</Text>
                <Pressable
                  testID="cal-add-event"
                  style={s.emptyBtn}
                  onPress={() => router.push({ pathname: "/event/[id]", params: { id: "new", date: selected } })}
                >
                  <Text style={s.emptyBtnText}>+ Dodaj imprezę</Text>
                </Pressable>
              </View>
            ) : (
              dayEvents.map(ev => (
                <Pressable
                  key={ev.id}
                  testID={`cal-event-${ev.id}`}
                  style={s.eventCard}
                  onPress={() => router.push({ pathname: "/event/[id]", params: { id: ev.id } })}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.evName}>{ev.name}</Text>
                    <Text style={s.evMeta}>{formatTimeRange(ev.time_start, ev.time_end, ev.time)}{ev.people ? `  ·  ${ev.people} os.` : ""}</Text>
                    <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                      {ev.category ? <Text style={s.evCat}>{categoryLabel(ev.category)}</Text> : null}
                      {ev.package_set && findAdultSet(ev.package_set) ? (
                        <View style={s.setBadge}>
                          <Text style={s.setBadgeText}>{findAdultSet(ev.package_set)!.name} · {findAdultSet(ev.package_set)!.price_per_person} zł/os.</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={s.evProfit}>{formatPLN(ev.profit)}</Text>
                    <Text style={s.evSub}>zysk</Text>
                  </View>
                </Pressable>
              ))
            )
          ) : (
            dayShifts.length === 0 ? (
              <View style={s.emptyBox}>
                <Feather name="users" size={32} color={theme.color.onSurfaceSecondary} />
                <Text style={s.emptyText}>Brak pracowników w grafiku tego dnia</Text>
              </View>
            ) : (
              <>
                {dayShifts.map(row => (
                  <View key={row.staff.id} style={s.shiftCard} testID={`grafik-${row.staff.id}`}>
                    <View style={s.avatarCircle}><Text style={s.avatarText}>{initials(row.staff.name)}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.evName}>{row.staff.name}</Text>
                      <Text style={s.evMeta} numberOfLines={1}>{row.staff.role || "—"}  ·  {row.eventNames.join(", ")}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={s.evProfit}>{row.hours.toFixed(1)} h</Text>
                      <Text style={s.evSub}>{formatPLN(row.amount)}</Text>
                    </View>
                  </View>
                ))}
                <View style={s.dayTotal}>
                  <Text style={s.dayTotalLabel}>Razem dnia</Text>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={s.dayTotalHours}>
                      {dayShifts.reduce((sum, r) => sum + r.hours, 0).toFixed(1)} h
                    </Text>
                    <Text style={s.dayTotalAmount}>
                      {formatPLN(dayShifts.reduce((sum, r) => sum + r.amount, 0))}
                    </Text>
                  </View>
                </View>
              </>
            )
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: {
    paddingHorizontal: 20, paddingBottom: 12, paddingTop: 8, borderBottomWidth: 1,
    borderBottomColor: theme.color.divider,
  },
  brand: { color: theme.color.onSurfaceSecondary, letterSpacing: 3, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthTitle: { color: theme.color.onSurface, fontSize: 24, fontWeight: "700" },
  navBtn: { padding: 8, backgroundColor: theme.color.surfaceSecondary, borderRadius: 999 },
  calendarWrap: { paddingHorizontal: 16, paddingTop: 16 },
  weekRow: { flexDirection: "row", justifyContent: "space-around", marginBottom: 8 },
  weekLabel: { flex: 1, textAlign: "center", color: theme.color.onSurfaceSecondary, fontSize: 12, fontWeight: "600" },
  gridWrap: { flexDirection: "row", flexWrap: "wrap" },
  cell: {
    width: `${100 / 7}%`, minHeight: 62, alignItems: "center", justifyContent: "flex-start",
    paddingTop: 6, paddingHorizontal: 2, paddingBottom: 4,
  },
  cellSelected: {
    backgroundColor: theme.color.brand, borderRadius: 12,
  },
  cellText: { color: theme.color.onSurface, fontSize: 18, fontWeight: "700" },
  cellTextSelected: { color: theme.color.onBrand, fontWeight: "800" },
  cellEventList: { width: "100%", marginTop: 3, alignItems: "center" },
  cellEventName: {
    fontSize: 10, lineHeight: 12, color: theme.color.brand, maxWidth: "100%",
    textAlign: "center", fontWeight: "600",
  },
  cellEventMore: {
    fontSize: 10, color: theme.color.brand, fontWeight: "700", marginTop: 1,
  },
  dotRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3, marginTop: 4,
  },
  dot: { width: 5, height: 5, borderRadius: 3 },
  dotMore: { color: theme.color.brand, fontSize: 9, fontWeight: "700", marginLeft: 2 },
  listSection: { paddingHorizontal: 20, paddingTop: 20 },
  listHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sectionTitle: { color: theme.color.onSurface, fontSize: 16, fontWeight: "700" },
  printBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 999, borderWidth: 1, borderColor: theme.color.brand,
    backgroundColor: "rgba(212,175,55,0.06)",
  },
  printBtnText: { color: theme.color.brand, fontSize: 12, fontWeight: "700" },
  emptyBox: { alignItems: "center", padding: 24, borderWidth: 1, borderColor: theme.color.border, borderRadius: 16, borderStyle: "dashed" },
  emptyText: { color: theme.color.onSurfaceSecondary, marginTop: 12, marginBottom: 16 },
  emptyBtn: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: theme.color.brand, borderRadius: 999 },
  emptyBtnText: { color: theme.color.onBrand, fontWeight: "700" },
  eventCard: {
    flexDirection: "row", backgroundColor: theme.color.surfaceSecondary,
    padding: 16, borderRadius: 16, marginBottom: 10, borderWidth: 1, borderColor: theme.color.border,
    alignItems: "center",
  },
  evName: { color: theme.color.onSurface, fontSize: 16, fontWeight: "700", marginBottom: 4 },
  evMeta: { color: theme.color.onSurfaceSecondary, fontSize: 13 },
  evCat: { color: theme.color.brand, fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  setBadge: {
    backgroundColor: theme.color.brand, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
  },
  setBadgeText: { color: theme.color.onBrand, fontSize: 10, fontWeight: "800" },
  evProfit: { color: theme.color.brand, fontSize: 16, fontWeight: "700" },
  evSub: { color: theme.color.onSurfaceSecondary, fontSize: 11, letterSpacing: 1 },
  modeToggle: {
    flexDirection: "row", backgroundColor: theme.color.surfaceSecondary, borderRadius: 999,
    padding: 4, marginTop: 12, borderWidth: 1, borderColor: theme.color.border,
  },
  modeBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 8, borderRadius: 999,
  },
  modeBtnActive: { backgroundColor: theme.color.brand },
  modeText: { color: theme.color.onSurfaceSecondary, fontSize: 13, fontWeight: "700" },
  modeTextActive: { color: theme.color.onBrand },
  shiftCard: {
    flexDirection: "row", backgroundColor: theme.color.surfaceSecondary,
    padding: 14, borderRadius: 16, marginBottom: 8, borderWidth: 1, borderColor: theme.color.border,
    alignItems: "center", gap: 12,
  },
  avatarCircle: {
    width: 40, height: 40, borderRadius: 999, backgroundColor: theme.color.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: theme.color.onBrandTertiary, fontWeight: "700", fontSize: 13 },
  dayTotal: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginTop: 8, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: theme.color.brandTertiary,
    backgroundColor: "rgba(212,175,55,0.06)",
  },
  dayTotalLabel: { color: theme.color.onSurface, fontSize: 14, fontWeight: "700" },
  dayTotalHours: { color: theme.color.brand, fontSize: 18, fontWeight: "800" },
  dayTotalAmount: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
});

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, StatusBar, RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { v2 } from "@/src/designTokensV2";
import { api } from "@/src/api";
import { MONTHS_PL } from "@/src/theme";
import { categoryLabel } from "@/src/categories";
import { printSchedule } from "@/src/printSchedule";

const DAY_LABELS = ["pn", "wt", "śr", "cz", "pt", "sb", "nd"];

const monthCells = (y: number, m: number): (string | null)[] => {
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const startPad = (new Date(y, m, 1).getDay() + 6) % 7; // Mon=0
  const cells: (string | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
};

export default function GrafikPracownikow() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [events, setEvents] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterId, setFilterId] = useState<string | null>(null);
  const [selDay, setSelDay] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [evs, st]: any[] = await Promise.all([api.listEvents(ym.y, ym.m + 1), api.listStaff()]);
      setEvents(Array.isArray(evs) ? evs : []);
      setStaff(Array.isArray(st) ? st : []);
    } catch (e) { console.warn("grafik load", e); }
  }, [ym]);

  useEffect(() => { setLoading(true); setSelDay(null); load().finally(() => setLoading(false)); }, [load]);

  const staffMap = useMemo(() => {
    const m: Record<string, any> = {};
    staff.forEach(s => { m[s.id] = s; });
    return m;
  }, [staff]);

  const evShifts = useCallback(
    (ev: any) => (ev.shifts || []).filter((sh: any) => staffMap[sh.staff_id] && (!filterId || sh.staff_id === filterId)),
    [filterId, staffMap]
  );

  // events shown: with filter → only that staff's events; without → all events of the month
  const visibleEvents = useMemo(
    () => (filterId ? events.filter(ev => evShifts(ev).length > 0) : events).slice().sort((a, b) => (a.date + (a.time_start || "")).localeCompare(b.date + (b.time_start || ""))),
    [events, filterId, evShifts]
  );

  const byDate = useMemo(() => {
    const m: Record<string, any[]> = {};
    visibleEvents.forEach(ev => { (m[ev.date] = m[ev.date] || []).push(ev); });
    return m;
  }, [visibleEvents]);

  const staffInMonth = useMemo(() => {
    const ids = new Set<string>();
    events.forEach(ev => (ev.shifts || []).forEach((sh: any) => ids.add(sh.staff_id)));
    return staff.filter(s => ids.has(s.id));
  }, [events, staff]);

  const cells = useMemo(() => monthCells(ym.y, ym.m), [ym]);
  const todayIso = new Date().toISOString().slice(0, 10);

  const shiftMonth = (delta: number) => {
    setYm(({ y, m }) => {
      const d = new Date(y, m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  };

  const onPrint = async () => {
    const printEvents = filterId
      ? visibleEvents.map(ev => ({ ...ev, shifts: evShifts(ev) }))
      : visibleEvents;
    await printSchedule({
      year: ym.y, month: ym.m, events: printEvents, staff,
      ownerName: filterId ? `Pracownik: ${staffMap[filterId]?.name || ""}` : undefined,
      includePay: false,
    });
  };

  const renderDayEvents = (date: string) => (byDate[date] || []).map(ev => {
    const shifts = evShifts(ev);
    return (
      <Pressable key={ev.id} style={s.dayEvCard} onPress={() => router.push(`/event/${ev.id}` as any)} testID={`sched-event-${ev.id}`}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={s.dayEvName} numberOfLines={1}>{ev.name}</Text>
          <Feather name="chevron-right" size={14} color={v2.color.textSubtle} />
        </View>
        <Text style={s.dayEvMeta}>
          {ev.time_start ? `${ev.time_start}${ev.time_end ? `–${ev.time_end}` : ""}` : ev.time || ""}
          {ev.category ? ` · ${categoryLabel(ev.category)}` : ""}
          {ev.people ? ` · ${ev.people} os.` : ""}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
          {shifts.length === 0 ? (
            <View style={[s.staffChip, { backgroundColor: "#FEF3C7", borderColor: "#F59E0B" }]}>
              <Text style={[s.staffChipText, { color: "#92400E" }]}>⚠ brak obsady</Text>
            </View>
          ) : shifts.map((sh: any, i: number) => {
            const p = staffMap[sh.staff_id];
            const time = sh.time_start ? `${sh.time_start}${sh.time_end ? `–${sh.time_end}` : ""}` : `${Number(sh.hours) || 0} h`;
            return (
              <View key={i} style={s.staffChip}>
                <Text style={s.staffChipText}>{p?.name || "?"} · {time}</Text>
              </View>
            );
          })}
        </View>
      </Pressable>
    );
  });

  const daysWithEvents = useMemo(
    () => Object.keys(byDate).sort(),
    [byDate]
  );

  return (
    <View style={{ flex: 1, backgroundColor: v2.color.bg }}>
      <StatusBar barStyle="light-content" />
      {/* HEADER */}
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.headerBtn} testID="sched-back">
          <Feather name="arrow-left" size={18} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.brand}>ZESPÓŁ</Text>
          <Text style={s.title}>Grafik pracowników</Text>
        </View>
        <Pressable onPress={onPrint} hitSlop={12} style={s.headerBtn} testID="sched-print">
          <Feather name="printer" size={18} color="#fff" />
        </Pressable>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={v2.color.forest} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={v2.color.forest} />}
        >
          {/* Month switcher */}
          <View style={s.monthRow}>
            <Pressable onPress={() => shiftMonth(-1)} hitSlop={10} style={s.monthBtn} testID="sched-prev-month">
              <Feather name="chevron-left" size={20} color={v2.color.forest} />
            </Pressable>
            <Text style={s.monthLabel}>{MONTHS_PL[ym.m]} {ym.y}</Text>
            <Pressable onPress={() => shiftMonth(1)} hitSlop={10} style={s.monthBtn} testID="sched-next-month">
              <Feather name="chevron-right" size={20} color={v2.color.forest} />
            </Pressable>
          </View>

          {/* Staff filter */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <Pressable
                onPress={() => setFilterId(null)}
                style={[s.filterChip, !filterId && s.filterChipActive]}
                testID="sched-filter-all"
              >
                <Text style={[s.filterChipText, !filterId && s.filterChipTextActive]}>Wszyscy</Text>
              </Pressable>
              {staffInMonth.map(p => (
                <Pressable
                  key={p.id}
                  onPress={() => setFilterId(filterId === p.id ? null : p.id)}
                  style={[s.filterChip, filterId === p.id && s.filterChipActive]}
                  testID={`sched-filter-${p.id}`}
                >
                  <Text style={[s.filterChipText, filterId === p.id && s.filterChipTextActive]}>{p.name}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>

          {/* Month grid */}
          <View style={s.grid}>
            <View style={s.gridHead}>
              {DAY_LABELS.map(d => <Text key={d} style={s.gridHeadText}>{d}</Text>)}
            </View>
            {Array.from({ length: cells.length / 7 }, (_, r) => (
              <View key={r} style={s.gridRow}>
                {cells.slice(r * 7, r * 7 + 7).map((date, i) => {
                  if (!date) return <View key={i} style={s.cell} />;
                  const evs = byDate[date] || [];
                  const has = evs.length > 0;
                  const isToday = date === todayIso;
                  const isSel = date === selDay;
                  return (
                    <Pressable
                      key={i}
                      onPress={() => setSelDay(isSel ? null : date)}
                      style={[
                        s.cell,
                        has && s.cellHas,
                        isToday && s.cellToday,
                        isSel && s.cellSel,
                      ]}
                      testID={`sched-day-${date}`}
                    >
                      <Text style={[s.cellNum, has && { color: v2.color.forest, fontWeight: "800" }, isSel && { color: "#fff" }]}>
                        {parseInt(date.slice(-2), 10)}
                      </Text>
                      {has && (
                        <View style={[s.cellBadge, isSel && { backgroundColor: "#fff" }]}>
                          <Text style={[s.cellBadgeText, isSel && { color: v2.color.forest }]}>{evs.length}</Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>

          {/* Selected day detail */}
          {selDay && (
            <View style={{ marginTop: 14 }}>
              <Text style={s.sectionLabel}>
                {new Date(selDay + "T12:00:00").toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" })}
              </Text>
              {(byDate[selDay] || []).length === 0 ? (
                <Text style={s.emptyText}>Brak imprez tego dnia.</Text>
              ) : renderDayEvents(selDay)}
            </View>
          )}

          {/* Full month list */}
          <Text style={[s.sectionLabel, { marginTop: 18 }]}>
            Zmiany w miesiącu ({daysWithEvents.reduce((n, d) => n + byDate[d].length, 0)} imprez)
          </Text>
          {daysWithEvents.length === 0 ? (
            <View style={s.emptyBox}>
              <Feather name="calendar" size={22} color={v2.color.sage} />
              <Text style={s.emptyText}>{filterId ? "Ten pracownik nie ma zmian w tym miesiącu." : "Brak imprez w tym miesiącu."}</Text>
            </View>
          ) : daysWithEvents.map(date => (
            <View key={date} style={{ marginBottom: 10 }}>
              <View style={s.dayHead}>
                <Text style={s.dayHeadNum}>{date.slice(-2)}</Text>
                <Text style={s.dayHeadLabel}>
                  {new Date(date + "T12:00:00").toLocaleDateString("pl-PL", { weekday: "long" })}
                </Text>
                {date === todayIso && (
                  <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: v2.color.mint }}>
                    <Text style={{ color: v2.color.forest, fontSize: 9, fontWeight: "800" }}>DZIŚ</Text>
                  </View>
                )}
              </View>
              {renderDayEvents(date)}
            </View>
          ))}

          {/* Print CTA */}
          <Pressable onPress={onPrint} style={s.printBtn} testID="sched-print-cta">
            <Feather name="printer" size={16} color="#fff" />
            <Text style={s.printBtnText}>Drukuj grafik miesięczny (PDF)</Text>
          </Pressable>
          <Text style={{ color: v2.color.textMuted, fontSize: 11, textAlign: "center", marginTop: 6 }}>
            Wydruk nie zawiera stawek ani wypłat — można powiesić dla zespołu.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingBottom: 12, backgroundColor: v2.color.forestDeep,
  },
  headerBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  brand: { color: v2.color.moss, letterSpacing: 3, fontSize: 10, fontWeight: "800" },
  title: { color: "#fff", fontSize: 19, fontWeight: "800" },

  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  monthBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: v2.color.mint, alignItems: "center", justifyContent: "center" },
  monthLabel: { color: v2.color.text, fontSize: 17, fontWeight: "800", textTransform: "capitalize" },

  filterChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    borderWidth: 1.5, borderColor: v2.color.border, backgroundColor: v2.color.card,
  },
  filterChipActive: { borderColor: v2.color.forest, backgroundColor: v2.color.forest },
  filterChipText: { color: v2.color.text, fontSize: 12, fontWeight: "700" },
  filterChipTextActive: { color: "#fff" },

  grid: { borderRadius: 14, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, padding: 8 },
  gridHead: { flexDirection: "row", marginBottom: 4 },
  gridHeadText: { flex: 1, textAlign: "center", color: v2.color.textMuted, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  gridRow: { flexDirection: "row" },
  cell: { flex: 1, aspectRatio: 0.9, alignItems: "center", justifyContent: "center", borderRadius: 8, margin: 1 },
  cellHas: { backgroundColor: v2.color.mint },
  cellToday: { borderWidth: 1.5, borderColor: v2.color.forest },
  cellSel: { backgroundColor: v2.color.forest },
  cellNum: { color: v2.color.text, fontSize: 13 },
  cellBadge: { marginTop: 2, minWidth: 14, height: 14, borderRadius: 7, backgroundColor: v2.color.forest, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  cellBadgeText: { color: "#fff", fontSize: 8, fontWeight: "900" },

  sectionLabel: { color: v2.color.text, fontSize: 13, fontWeight: "800", marginBottom: 8, textTransform: "capitalize" },
  dayHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  dayHeadNum: { color: v2.color.forest, fontSize: 16, fontWeight: "900" },
  dayHeadLabel: { color: v2.color.textMuted, fontSize: 12, fontWeight: "700", textTransform: "capitalize" },

  dayEvCard: {
    padding: 12, borderRadius: 12, backgroundColor: v2.color.card,
    borderWidth: 1, borderColor: v2.color.border, marginBottom: 6,
  },
  dayEvName: { color: v2.color.text, fontSize: 14, fontWeight: "800", flex: 1, marginRight: 8 },
  dayEvMeta: { color: v2.color.textMuted, fontSize: 12, marginTop: 2 },
  staffChip: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
    backgroundColor: v2.color.mint, borderWidth: 1, borderColor: v2.color.forest + "44",
  },
  staffChipText: { color: v2.color.forest, fontSize: 11, fontWeight: "700" },

  emptyBox: { alignItems: "center", gap: 8, padding: 24, borderRadius: 14, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border },
  emptyText: { color: v2.color.textMuted, fontSize: 13 },

  printBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: v2.color.forest, paddingVertical: 14, borderRadius: 12, marginTop: 18,
  },
  printBtnText: { color: "#fff", fontSize: 14, fontWeight: "800" },
});

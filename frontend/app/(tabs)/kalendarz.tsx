import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme, MONTHS_PL, DAYS_PL, formatPLN } from "@/src/theme";
import { api } from "@/src/api";

function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate(); }
// return weekday index Mon=0..Sun=6 for a given date (m: 0-11)
function firstWeekday(y: number, m: number) {
  const d = new Date(y, m, 1).getDay(); // 0 = Sun
  return (d + 6) % 7;
}
function fmt(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export default function Kalendarz() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selected, setSelected] = useState<string>(fmt(today.getFullYear(), today.getMonth(), today.getDate()));
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res: any = await api.listEvents(year, month + 1);
      setEvents(res);
    } catch {}
  }, [year, month]);

  useFocusEffect(useCallback(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]));
  useEffect(() => { load(); }, [load]);

  const eventDates = useMemo(() => {
    const s = new Set<string>();
    events.forEach(e => s.add(e.date));
    return s;
  }, [events]);

  const dayEvents = useMemo(() => events.filter(e => e.date === selected), [events, selected]);

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
              const hasEv = eventDates.has(dateStr);
              return (
                <Pressable
                  key={i}
                  onPress={() => setSelected(dateStr)}
                  style={[s.cell, isSel && s.cellSelected]}
                  testID={`day-${dateStr}`}
                >
                  <Text style={[s.cellText, isSel && s.cellTextSelected, isToday && !isSel && { color: theme.color.brand, fontWeight: "700" }]}>{d}</Text>
                  {hasEv && <View style={[s.dot, isSel && { backgroundColor: theme.color.onBrand }]} />}
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={s.listSection}>
          <Text style={s.sectionTitle}>Wydarzenia — {new Date(selected).toLocaleDateString("pl-PL", { day: "numeric", month: "long" })}</Text>
          {loading ? (
            <ActivityIndicator color={theme.color.brand} style={{ marginTop: 24 }} />
          ) : dayEvents.length === 0 ? (
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
                  <Text style={s.evMeta}>{ev.time || "—"}  ·  {ev.venue || "Bez lokalizacji"}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={s.evProfit}>{formatPLN(ev.profit)}</Text>
                  <Text style={s.evSub}>zysk</Text>
                </View>
              </Pressable>
            ))
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
    width: `${100 / 7}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center",
  },
  cellSelected: {
    backgroundColor: theme.color.brand, borderRadius: 12,
  },
  cellText: { color: theme.color.onSurface, fontSize: 15 },
  cellTextSelected: { color: theme.color.onBrand, fontWeight: "700" },
  dot: {
    position: "absolute", bottom: 6, width: 5, height: 5, borderRadius: 5,
    backgroundColor: theme.color.brand,
  },
  listSection: { paddingHorizontal: 20, paddingTop: 20 },
  sectionTitle: { color: theme.color.onSurface, fontSize: 16, fontWeight: "700", marginBottom: 12 },
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
  evProfit: { color: theme.color.brand, fontSize: 16, fontWeight: "700" },
  evSub: { color: theme.color.onSurfaceSecondary, fontSize: 11, letterSpacing: 1 },
});

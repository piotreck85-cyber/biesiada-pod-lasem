import { useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, StatusBar,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { v2 } from "@/src/designTokensV2";
import { api } from "@/src/api";
import { MONTHS_PL } from "@/src/theme";

type Decl = {
  date: string; staff_id: string; staff_name?: string; staff_role?: string;
  status: "available" | "unavailable"; all_day?: boolean;
  time_from?: string; time_to?: string; note?: string;
};

const DAY_LABELS = ["pn", "wt", "śr", "cz", "pt", "sb", "nd"];

const buildMonthCells = (y: number, m: number): (string | null)[] => {
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const startPad = (new Date(y, m, 1).getDay() + 6) % 7;
  const cells: (string | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
};

export default function TeamAvailabilityScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [ym, setYm] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [rows, setRows] = useState<Decl[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selDay, setSelDay] = useState<string | null>(today);

  useEffect(() => {
    api.listStaff().then((r: any) => setStaff(Array.isArray(r) ? r : [])).catch(() => setStaff([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const mm = String(ym.m + 1).padStart(2, "0");
    api.availabilityTeam(`${ym.y}-${mm}-01`, `${ym.y}-${mm}-31`)
      .then((r: any) => { if (!cancelled) setRows(Array.isArray(r) ? r : []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ym]);

  const byDate = useMemo(() => {
    const m: Record<string, Decl[]> = {};
    rows.forEach(r => { (m[r.date] = m[r.date] || []).push(r); });
    return m;
  }, [rows]);

  const unavailable = useMemo(
    () => rows.filter(r => r.status === "unavailable").sort((a, b) => a.date.localeCompare(b.date)),
    [rows]
  );

  const gridCells = useMemo(() => buildMonthCells(ym.y, ym.m), [ym]);
  const shiftYm = (delta: number) => {
    setSelDay(null);
    setYm(({ y, m }) => { const d = new Date(y, m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  };

  const pillFor = (d?: Decl) => !d
    ? { txt: "⚪ Brak deklaracji", bg: v2.color.cardMuted, fg: v2.color.textMuted }
    : d.status === "available"
      ? { txt: d.all_day === false ? `🟢 Dostępny ${d.time_from}–${d.time_to}` : "🟢 Dostępny", bg: v2.color.successBg, fg: v2.color.success }
      : { txt: d.all_day === false ? `🔴 Niedostępny ${d.time_from}–${d.time_to}` : "🔴 Niedostępny (cały dzień)", bg: v2.color.errorBg, fg: v2.color.error };

  const selDecls = selDay ? (byDate[selDay] || []) : [];
  const selMap: Record<string, Decl> = {};
  selDecls.forEach(d => { selMap[d.staff_id] = d; });

  return (
    <View style={{ flex: 1, backgroundColor: v2.color.bg }}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.headerBtn} testID="team-avail-back">
          <Feather name="arrow-left" size={18} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.brand}>ZESPÓŁ</Text>
          <Text style={s.title}>Dostępność zespołu</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 60 }}>
        {/* Month switcher */}
        <View style={s.monthRow}>
          <Pressable onPress={() => shiftYm(-1)} hitSlop={10} style={s.monthBtn} testID="team-avail-prev">
            <Feather name="chevron-left" size={18} color={v2.color.forest} />
          </Pressable>
          <Text style={s.monthLabel}>{MONTHS_PL[ym.m]} {ym.y}</Text>
          <Pressable onPress={() => shiftYm(1)} hitSlop={10} style={s.monthBtn} testID="team-avail-next">
            <Feather name="chevron-right" size={18} color={v2.color.forest} />
          </Pressable>
        </View>

        {/* Legend */}
        <View style={s.legendRow}>
          <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: v2.color.success }]} /><Text style={s.legendText}>Dostępni</Text></View>
          <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: v2.color.error }]} /><Text style={s.legendText}>Niedostępni</Text></View>
        </View>

        {loading ? (
          <View style={{ padding: 32, alignItems: "center" }}><ActivityIndicator color={v2.color.forest} /></View>
        ) : (
          <>
            {/* Month grid */}
            <View style={s.gridBox}>
              <View style={{ flexDirection: "row", marginBottom: 4 }}>
                {DAY_LABELS.map(d => <Text key={d} style={s.gridHeadText}>{d}</Text>)}
              </View>
              {Array.from({ length: gridCells.length / 7 }, (_, r) => (
                <View key={r} style={{ flexDirection: "row" }}>
                  {gridCells.slice(r * 7, r * 7 + 7).map((date, i) => {
                    if (!date) return <View key={i} style={s.gcell} />;
                    const ds = byDate[date] || [];
                    const nUnavail = ds.filter(d => d.status === "unavailable").length;
                    const nAvail = ds.filter(d => d.status === "available").length;
                    const isToday = date === today;
                    const isSel = date === selDay;
                    return (
                      <Pressable
                        key={i}
                        onPress={() => setSelDay(isSel ? null : date)}
                        style={[s.gcell, isToday && s.gcellToday, isSel && s.gcellSel]}
                        testID={`team-avail-day-${date}`}
                      >
                        <Text style={[s.gcellNum, isSel && { color: "#fff", fontWeight: "800" }]}>
                          {parseInt(date.slice(-2), 10)}
                        </Text>
                        <View style={{ flexDirection: "row", gap: 2, marginTop: 2, minHeight: 5 }}>
                          {nAvail > 0 ? <View style={[s.miniDot, { backgroundColor: isSel ? "#fff" : v2.color.success }]} /> : null}
                          {nUnavail > 0 ? <View style={[s.miniDot, { backgroundColor: isSel ? "#fff" : v2.color.error }]} /> : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>

            {/* Selected day — all staff with status */}
            {selDay ? (
              <View style={{ marginTop: 14 }}>
                <Text style={s.sectionLabel}>
                  {new Date(selDay + "T12:00:00").toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" })}
                </Text>
                {staff.length === 0 ? (
                  <View style={s.emptyBox}><Text style={s.emptyText}>Brak pracowników</Text></View>
                ) : staff.map(st => {
                  const d = selMap[st.id];
                  const pill = pillFor(d);
                  return (
                    <View key={st.id} style={s.staffRow} testID={`team-avail-staff-${st.id}`}>
                      <View style={s.avatar}>
                        <Text style={s.avatarText}>{(st.name || "?").split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.staffName}>{st.name}</Text>
                        {st.role ? <Text style={s.staffRole}>{st.role}</Text> : null}
                        {d?.note ? <Text style={s.staffNote} numberOfLines={1}>💬 {d.note}</Text> : null}
                      </View>
                      <View style={[s.pill, { backgroundColor: pill.bg }]}>
                        <Text style={[s.pillText, { color: pill.fg }]}>{pill.txt}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : null}

            {/* Month unavailability summary */}
            <View style={{ marginTop: 20 }}>
              <Text style={s.sectionLabel}>🔴 Niedostępności w tym miesiącu ({unavailable.length})</Text>
              {unavailable.length === 0 ? (
                <View style={s.emptyBox}>
                  <Feather name="check-circle" size={18} color={v2.color.success} />
                  <Text style={s.emptyText}>Nikt nie zgłosił braku dostępności</Text>
                </View>
              ) : unavailable.map((d, ix) => (
                <Pressable key={`${d.staff_id}-${d.date}-${ix}`} style={s.unavailRow} onPress={() => setSelDay(d.date)}>
                  <View style={s.dateBox}>
                    <Text style={s.dateBoxDay}>{d.date.slice(-2)}</Text>
                    <Text style={s.dateBoxMon}>{d.date.slice(5, 7)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.staffName}>{d.staff_name}</Text>
                    <Text style={s.staffRole}>
                      {d.all_day === false ? `w godz. ${d.time_from}–${d.time_to}` : "cały dzień"}
                      {d.note ? ` · ${d.note}` : ""}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={v2.color.textSubtle} />
                </Pressable>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "flex-end", gap: 12,
    paddingHorizontal: 20, paddingBottom: 14,
    backgroundColor: v2.color.forestDeep,
  },
  headerBtn: {
    width: 38, height: 38, borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  brand: { color: v2.color.moss, letterSpacing: 3, fontSize: 10, fontWeight: "800", marginBottom: 2 },
  title: { color: v2.color.onDark, fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },

  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  monthBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: v2.color.mint, alignItems: "center", justifyContent: "center" },
  monthLabel: { color: v2.color.text, fontSize: 16, fontWeight: "800", textTransform: "capitalize" },

  legendRow: { flexDirection: "row", gap: 14, marginBottom: 8, paddingHorizontal: 2 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 999 },
  legendText: { color: v2.color.textMuted, fontSize: 11, fontWeight: "700" },

  gridBox: { borderRadius: 14, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, padding: 8 },
  gridHeadText: { flex: 1, textAlign: "center", color: v2.color.textMuted, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  gcell: { flex: 1, aspectRatio: 0.95, alignItems: "center", justifyContent: "center", borderRadius: 8, margin: 1 },
  gcellToday: { borderWidth: 1.5, borderColor: v2.color.forest },
  gcellSel: { backgroundColor: v2.color.forest },
  gcellNum: { color: v2.color.text, fontSize: 13 },
  miniDot: { width: 5, height: 5, borderRadius: 999 },

  sectionLabel: { color: v2.color.text, fontSize: 15, fontWeight: "800", marginBottom: 8 },
  emptyBox: {
    padding: 18, alignItems: "center", gap: 6, borderRadius: v2.radius.md,
    backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, borderStyle: "dashed",
  },
  emptyText: { color: v2.color.textMuted, fontSize: 12 },

  staffRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 12, marginBottom: 6, borderRadius: v2.radius.md,
    borderWidth: 1, borderColor: v2.color.border, backgroundColor: v2.color.card,
  },
  avatar: {
    width: 36, height: 36, borderRadius: 999, backgroundColor: v2.color.mint,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: v2.color.forest, fontSize: 12, fontWeight: "800" },
  staffName: { color: v2.color.text, fontSize: 14, fontWeight: "800" },
  staffRole: { color: v2.color.textMuted, fontSize: 11, marginTop: 2 },
  staffNote: { color: v2.color.textMuted, fontSize: 11, marginTop: 2 },
  pill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, maxWidth: 150 },
  pillText: { fontSize: 10, fontWeight: "800" },

  unavailRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 12, marginBottom: 6, borderRadius: v2.radius.md,
    borderWidth: 1, borderColor: v2.color.error + "33", backgroundColor: v2.color.card,
  },
  dateBox: {
    width: 44, height: 44, borderRadius: v2.radius.md,
    backgroundColor: v2.color.errorBg, alignItems: "center", justifyContent: "center",
  },
  dateBoxDay: { color: v2.color.error, fontSize: 16, fontWeight: "800" },
  dateBoxMon: { color: v2.color.error, fontSize: 10, fontWeight: "700" },
});

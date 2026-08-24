import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { v2 } from "@/src/designTokensV2";

const MONTHS = ["styczeń","luty","marzec","kwiecień","maj","czerwiec","lipiec","sierpień","wrzesień","październik","listopad","grudzień"];
const DOW = ["pn","wt","śr","cz","pt","sb","nd"];

// Bez fikcyjnych danych — pokazuję strukturę bez dorobionych rekordów
const SAMPLE_EVENTS: Record<string, { name: string; count: number; status: string }[]> = {};

export default function CalMockup() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const today = new Date();
  const [ym, setYm] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [selected, setSelected] = useState(today.toISOString().slice(0,10));

  const firstDay = new Date(ym.y, ym.m, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;   // Mon=0
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
  const cells = Array.from({ length: startOffset + daysInMonth }, (_, i) => i < startOffset ? null : i - startOffset + 1);

  const nav = (delta: number) => {
    let m = ym.m + delta; let y = ym.y;
    if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
    setYm({ y, m });
  };

  return (
    <View style={{ flex: 1, backgroundColor: v2.color.bg }}>
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={s.iconBtn}><Feather name="chevron-left" size={22} color="#fff" /></Pressable>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={s.brand}>KALENDARZ</Text>
          <Text style={s.month}>{MONTHS[ym.m]} {ym.y}</Text>
        </View>
        <Pressable onPress={() => nav(-1)} style={s.iconBtn}><Feather name="chevron-left" size={18} color="#fff" /></Pressable>
        <Pressable onPress={() => nav(1)} style={s.iconBtn}><Feather name="chevron-right" size={18} color="#fff" /></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
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
            const iso = `${ym.y}-${String(ym.m + 1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
            const isToday = iso === today.toISOString().slice(0,10);
            const isSelected = iso === selected;
            const events = SAMPLE_EVENTS[iso] || [];
            return (
              <Pressable key={idx} onPress={() => setSelected(iso)}
                style={[s.cell, isSelected && s.cellSelected, isToday && !isSelected && s.cellToday]}>
                <Text style={[s.day, isSelected && { color: "#fff" }, isToday && !isSelected && { color: v2.color.forest, fontWeight: "800" }]}>{day}</Text>
                {events.length > 0 && (
                  <View style={s.dotsRow}>
                    {events.slice(0, 3).map((_, i) => <View key={i} style={[s.eventDot, { backgroundColor: isSelected ? "#fff" : v2.color.forest }]} />)}
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        {/* Selected day agenda */}
        <View style={{ padding: 16 }}>
          <Text style={s.agendaTitle}>{new Date(selected + "T00:00:00").toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" })}</Text>
          {(SAMPLE_EVENTS[selected] || []).length === 0 ? (
            <View style={s.emptyBox}>
              <Feather name="calendar" size={28} color={v2.color.textSubtle} />
              <Text style={s.emptyText}>Brak imprez tego dnia</Text>
              <Pressable style={s.emptyBtn}><Feather name="plus" size={14} color={v2.color.forest} /><Text style={s.emptyBtnText}>Dodaj imprezę</Text></Pressable>
            </View>
          ) : null}
        </View>
      </ScrollView>

      <View style={[s.tabBar, { paddingBottom: insets.bottom + 6 }]}>
        {[
          { icon: "home", label: "Start", active: false },
          { icon: "calendar", label: "Kalendarz", active: true },
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
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 14, backgroundColor: v2.color.forestDeep, gap: 4 },
  iconBtn: { width: 36, height: 36, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  brand: { color: v2.color.moss, letterSpacing: 3, fontSize: 10, fontWeight: "800" },
  month: { color: "#fff", fontSize: 20, fontWeight: "800", textTransform: "capitalize" },
  legend: { flexDirection: "row", gap: 12, padding: 14, justifyContent: "center" },
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
  agendaTitle: { color: v2.color.text, fontSize: 16, fontWeight: "800", marginBottom: 10, textTransform: "capitalize" },
  emptyBox: { padding: 24, borderRadius: v2.radius.md, backgroundColor: v2.color.card, borderWidth: 1, borderStyle: "dashed", borderColor: v2.color.border, alignItems: "center", gap: 8 },
  emptyText: { color: v2.color.textMuted, fontSize: 13 },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: v2.radius.md, backgroundColor: v2.color.mint, marginTop: 6 },
  emptyBtnText: { color: v2.color.forest, fontWeight: "800", fontSize: 12 },
  tabBar: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: v2.color.card, borderTopWidth: 1, borderTopColor: v2.color.border, flexDirection: "row", justifyContent: "space-around", paddingTop: 8 },
  tab: { alignItems: "center", gap: 3 },
  tabLabel: { fontSize: 10, fontWeight: "700" },
});

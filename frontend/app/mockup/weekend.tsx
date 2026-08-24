import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { v2 } from "@/src/designTokensV2";

function nextWeekend() {
  const today = new Date(); today.setHours(0,0,0,0);
  const daysToSat = (6 - today.getDay() + 7) % 7;
  const sat = new Date(today); sat.setDate(today.getDate() + daysToSat);
  const sun = new Date(sat); sun.setDate(sat.getDate() + 1);
  return { sat, sun };
}

export default function WeekendMockup() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { sat, sun } = nextWeekend();
  const days = [
    { label: "Sobota",    date: sat, events: 0, guests: 0, staff: 0, problems: 0, readiness: 0 },
    { label: "Niedziela", date: sun, events: 0, guests: 0, staff: 0, problems: 0, readiness: 0 },
  ];
  return (
    <View style={{ flex: 1, backgroundColor: v2.color.bg }}>
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={s.iconBtn}><Feather name="chevron-left" size={22} color="#fff" /></Pressable>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={s.brand}>PLAN WEEKENDOWY</Text>
          <Text style={s.title}>{sat.getDate()}–{sun.getDate()} {sat.toLocaleDateString("pl-PL", { month: "long" })}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 130, gap: 16 }}>
        <View style={s.summaryBar}>
          <View style={s.sumItem}><Text style={s.sumLabel}>Imprezy</Text><Text style={s.sumValue}>0</Text></View>
          <View style={s.sumDiv} />
          <View style={s.sumItem}><Text style={s.sumLabel}>Gości</Text><Text style={s.sumValue}>0</Text></View>
          <View style={s.sumDiv} />
          <View style={s.sumItem}><Text style={s.sumLabel}>Problemy</Text><Text style={[s.sumValue, { color: v2.color.error }]}>0</Text></View>
        </View>

        {days.map(d => (
          <View key={d.label} style={s.dayCard}>
            <View style={s.dayHead}>
              <View>
                <Text style={s.dayLabel}>{d.label}</Text>
                <Text style={s.dayDate}>{d.date.toLocaleDateString("pl-PL", { day: "numeric", month: "long" })}</Text>
              </View>
              <View style={[s.readyPill, { backgroundColor: d.readiness >= 80 ? v2.color.successBg : d.readiness >= 50 ? v2.color.warningBg : v2.color.errorBg }]}>
                <Text style={[s.readyText, { color: d.readiness >= 80 ? v2.color.success : d.readiness >= 50 ? v2.color.warning : v2.color.error }]}>{d.readiness}% gotowe</Text>
              </View>
            </View>

            {d.events === 0 ? (
              <View style={s.emptyDay}>
                <Feather name="coffee" size={22} color={v2.color.textSubtle} />
                <Text style={s.emptyText}>Brak imprez tego dnia</Text>
              </View>
            ) : null}

            <View style={s.metrics}>
              <View style={s.metric}><Feather name="calendar" size={13} color={v2.color.forest} /><Text style={s.mLabel}>Imprezy</Text><Text style={s.mValue}>{d.events}</Text></View>
              <View style={s.metric}><Feather name="users" size={13} color={v2.color.forest} /><Text style={s.mLabel}>Gości</Text><Text style={s.mValue}>{d.guests || "—"}</Text></View>
              <View style={s.metric}><Feather name="briefcase" size={13} color={v2.color.forest} /><Text style={s.mLabel}>Obsada</Text><Text style={s.mValue}>{d.staff || "—"}</Text></View>
              <View style={s.metric}><Feather name="alert-triangle" size={13} color={d.problems > 0 ? v2.color.error : v2.color.forest} /><Text style={s.mLabel}>Problemy</Text><Text style={[s.mValue, { color: d.problems > 0 ? v2.color.error : v2.color.text }]}>{d.problems}</Text></View>
            </View>

            <View style={{ marginTop: 12 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                <Text style={s.mLabel}>Poziom przygotowania</Text>
                <Text style={[s.mLabel, { color: v2.color.text, fontWeight: "800" }]}>{d.readiness}%</Text>
              </View>
              <View style={s.progressBg}><View style={[s.progressFill, { width: `${d.readiness}%`, backgroundColor: d.readiness >= 80 ? v2.color.success : d.readiness >= 50 ? v2.color.warning : v2.color.error }]} /></View>
            </View>

            <Pressable style={s.dayCta}>
              <Feather name="list" size={14} color={v2.color.forest} />
              <Text style={s.dayCtaText}>Zobacz szczegóły dnia</Text>
              <Feather name="chevron-right" size={14} color={v2.color.forest} />
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 14, backgroundColor: v2.color.forestDeep },
  iconBtn: { width: 36, height: 36, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  brand: { color: v2.color.moss, letterSpacing: 3, fontSize: 10, fontWeight: "800" },
  title: { color: "#fff", fontSize: 18, fontWeight: "800", textTransform: "capitalize" },
  summaryBar: { flexDirection: "row", padding: 14, borderRadius: v2.radius.xl, backgroundColor: v2.color.forest },
  sumItem: { flex: 1, alignItems: "center" },
  sumLabel: { color: v2.color.sage, fontSize: 10, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  sumValue: { color: "#fff", fontSize: 22, fontWeight: "800", marginTop: 4 },
  sumDiv: { width: 1, backgroundColor: v2.color.moss, marginHorizontal: 6 },
  dayCard: { padding: 16, borderRadius: v2.radius.xl, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, ...v2.shadow.sm },
  dayHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  dayLabel: { color: v2.color.text, fontSize: 18, fontWeight: "800" },
  dayDate: { color: v2.color.textMuted, fontSize: 12, fontWeight: "600", marginTop: 2 },
  readyPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  readyText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.3 },
  emptyDay: { padding: 16, alignItems: "center", gap: 6, borderRadius: v2.radius.md, backgroundColor: v2.color.cardMuted, borderWidth: 1, borderColor: v2.color.border, borderStyle: "dashed", marginBottom: 8 },
  emptyText: { color: v2.color.textMuted, fontSize: 12 },
  metrics: { flexDirection: "row", gap: 6 },
  metric: { flex: 1, padding: 10, borderRadius: v2.radius.sm, backgroundColor: v2.color.cardMuted, alignItems: "center", gap: 4 },
  mLabel: { color: v2.color.textSubtle, fontSize: 9, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  mValue: { color: v2.color.text, fontSize: 15, fontWeight: "800" },
  progressBg: { height: 6, borderRadius: 3, backgroundColor: v2.color.divider, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3 },
  dayCta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 14, padding: 12, borderRadius: v2.radius.md, backgroundColor: v2.color.mint },
  dayCtaText: { color: v2.color.forest, fontSize: 13, fontWeight: "800" },
});

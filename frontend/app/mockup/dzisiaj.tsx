import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { v2 } from "@/src/designTokensV2";

const TASKS = [
  { id: 1, title: "Rozpalić grill",       done: true,  cat: "przed"      },
  { id: 2, title: "Ustawić stoły",        done: true,  cat: "przed"      },
  { id: 3, title: "Sprawdzić toalety",    done: true,  cat: "przed"      },
  { id: 4, title: "Powitanie klientów",   done: false, cat: "w_trakcie"  },
  { id: 5, title: "Uzupełniać napoje",    done: false, cat: "w_trakcie"  },
  { id: 6, title: "Kontrola czystości",   done: false, cat: "w_trakcie"  },
  { id: 7, title: "Posprzątać stoły",     done: false, cat: "po"         },
  { id: 8, title: "Wynieść śmieci",       done: false, cat: "po"         },
];

const CAT_LABELS: Record<string, string> = { przed: "Przed imprezą", w_trakcie: "W trakcie", po: "Po imprezie" };

export default function DzisiajMockup() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tasks, setTasks] = useState(TASKS);
  const toggle = (id: number) => setTasks(t => t.map(x => x.id === id ? { ...x, done: !x.done } : x));
  const done = tasks.filter(x => x.done).length;
  const pct = Math.round(done * 100 / tasks.length);

  return (
    <View style={{ flex: 1, backgroundColor: v2.color.bg }}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={s.iconBtn}>
          <Feather name="chevron-left" size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={s.brand}>DZISIAJ</Text>
          <Text style={s.date}>sobota, 24 sierpnia</Text>
        </View>
        <View style={s.avatarBtn}><Text style={s.avatarTxt}>Z</Text></View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 130, gap: 14 }}>
        {/* Event card */}
        <View style={s.eventCard}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={s.locationPill}>
              <Feather name="map-pin" size={11} color={v2.color.forest} />
              <Text style={s.locationText}>Sala biesiadna</Text>
            </View>
          </View>
          <Text style={s.eventName}>Wesele Nowak</Text>
          <View style={s.eventMetaRow}>
            <View style={s.metaItem}>
              <Feather name="clock" size={13} color={v2.color.textMuted} />
              <Text style={s.metaText}>14:00 – 22:00</Text>
            </View>
            <View style={s.metaItem}>
              <Feather name="briefcase" size={13} color={v2.color.textMuted} />
              <Text style={s.metaText}>Kelnerka</Text>
            </View>
          </View>
        </View>

        {/* Info from owner */}
        <View style={s.infoCard}>
          <Feather name="info" size={16} color={v2.color.info} />
          <View style={{ flex: 1 }}>
            <Text style={s.infoLabel}>Info od właściciela</Text>
            <Text style={s.infoText}>Pamiętaj o dostawie kwiatów o 13:30. Klient prosi o dyskretną obsługę stołu głównego.</Text>
          </View>
        </View>

        {/* Progress */}
        <View style={s.progressCard}>
          <View style={{ flex: 1 }}>
            <Text style={s.progressLabel}>MOJE ZADANIA</Text>
            <Text style={s.progressBig}>{done} / {tasks.length}</Text>
            <View style={s.progressBg}>
              <View style={[s.progressFill, { width: `${pct}%` }]} />
            </View>
          </View>
          <View style={s.circle}>
            <Text style={s.circleText}>{pct}%</Text>
          </View>
        </View>

        {/* Task groups */}
        {["przed", "w_trakcie", "po"].map(cat => {
          const group = tasks.filter(t => t.cat === cat);
          return (
            <View key={cat}>
              <Text style={s.groupLabel}>{CAT_LABELS[cat]}</Text>
              {group.map(t => (
                <Pressable key={t.id} onPress={() => toggle(t.id)} style={[s.taskRow, t.done && s.taskRowDone]}>
                  <View style={[s.check, t.done && s.checkOn]}>
                    {t.done && <Feather name="check" size={16} color="#fff" />}
                  </View>
                  <Text style={[s.taskTitle, t.done && s.taskTitleDone]}>{t.title}</Text>
                </Pressable>
              ))}
            </View>
          );
        })}
      </ScrollView>

      {/* FAB */}
      <Pressable style={[s.fab, { bottom: insets.bottom + 20 }]}>
        <Feather name="alert-triangle" size={20} color="#fff" />
        <Text style={s.fabText}>Zgłoś problem</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 20, backgroundColor: v2.color.forestDeep },
  iconBtn: { width: 40, height: 40, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  brand: { color: v2.color.moss, letterSpacing: 3, fontSize: 10, fontWeight: "800" },
  date:  { color: "#fff", fontSize: 20, fontWeight: "800", marginTop: 2 },
  avatarBtn: { width: 40, height: 40, borderRadius: 999, backgroundColor: v2.color.moss, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: "#fff", fontWeight: "800", fontSize: 16 },

  eventCard: { padding: 18, borderRadius: v2.radius.xl, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, ...v2.shadow.sm, marginTop: -8 },
  locationPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: v2.color.mint },
  locationText: { color: v2.color.forest, fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },
  eventName: { color: v2.color.text, fontSize: 24, fontWeight: "800", letterSpacing: -0.5, marginTop: 8 },
  eventMetaRow: { flexDirection: "row", gap: 14, marginTop: 8 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { color: v2.color.text, fontSize: 13, fontWeight: "600" },

  infoCard: { flexDirection: "row", gap: 10, padding: 14, borderRadius: v2.radius.md, backgroundColor: v2.color.infoBg, borderLeftWidth: 3, borderLeftColor: v2.color.info },
  infoLabel: { color: v2.color.info, fontSize: 10, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  infoText: { color: v2.color.text, fontSize: 13, marginTop: 4, lineHeight: 18 },

  progressCard: { flexDirection: "row", padding: 16, borderRadius: v2.radius.lg, backgroundColor: v2.color.mint, alignItems: "center", gap: 14 },
  progressLabel: { color: v2.color.textMuted, fontSize: 10, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  progressBig: { color: v2.color.forest, fontSize: 22, fontWeight: "800", marginTop: 3 },
  progressBg: { height: 8, borderRadius: 4, backgroundColor: v2.color.card, marginTop: 8, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 4, backgroundColor: v2.color.forest },
  circle: { width: 64, height: 64, borderRadius: 32, borderWidth: 5, borderColor: v2.color.forest, alignItems: "center", justifyContent: "center", backgroundColor: v2.color.card },
  circleText: { color: v2.color.forest, fontSize: 15, fontWeight: "800" },

  groupLabel: { color: v2.color.textMuted, fontSize: 10, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 8, marginTop: 4 },
  taskRow: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14, marginBottom: 6, borderRadius: v2.radius.md, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border },
  taskRowDone: { backgroundColor: v2.color.mint + "80" },
  check: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: v2.color.borderStrong, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: v2.color.forest, borderColor: v2.color.forest },
  taskTitle: { flex: 1, color: v2.color.text, fontSize: 15, fontWeight: "600" },
  taskTitleDone: { color: v2.color.textMuted, textDecorationLine: "line-through" },

  fab: {
    position: "absolute", left: 20, right: 20,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    paddingVertical: 16, borderRadius: v2.radius.pill,
    backgroundColor: v2.color.error,
    shadowColor: "#DC2626", shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  fabText: { color: "#fff", fontSize: 15, fontWeight: "800", letterSpacing: 0.3 },
});

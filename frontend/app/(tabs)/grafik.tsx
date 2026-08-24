import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator, Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

type Ev = {
  id: string; date: string; name: string; time_start?: string; time_end?: string;
  people?: number; status?: string; location?: string; package_set?: string;
  my_shift?: { role?: string; hours?: number; from?: string; to?: string };
};

const dow = (iso: string) => {
  try {
    const d = new Date(iso + "T12:00:00");
    return ["nd","pn","wt","śr","cz","pt","sb"][d.getDay()];
  } catch { return ""; }
};
const isToday = (iso: string) => iso === new Date().toISOString().slice(0, 10);

export default function GrafikScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [events, setEvents] = useState<Ev[]>([]);
  const [openSession, setOpenSession] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [sched, mine]: any[] = await Promise.all([
        api.mySchedule(today),
        api.timeMy(5),
      ]);
      setEvents(sched || []);
      const open = (mine || []).find((r: any) => !r.end_at);
      setOpenSession(open || null);
    } catch (e: any) { console.warn("grafik load", e); }
  }, []);

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const todayEvent = useMemo(() => events.find(e => e.date === today), [events, today]);
  const upcoming = useMemo(() => events.filter(e => e.date > today).slice(0, 10), [events, today]);

  const clockIn = async () => {
    try {
      const row: any = await api.timeStart({ event_id: todayEvent?.id });
      setOpenSession(row);
      Alert.alert("Rozpoczęto pracę", new Date(row.start_at).toLocaleTimeString("pl-PL"));
    } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
  };
  const clockOut = async () => {
    if (!openSession) return;
    try {
      const row: any = await api.timeStop({ entry_id: openSession.id });
      setOpenSession(null);
      const h = Math.floor(row.hours);
      const m = Math.round((row.hours - h) * 60);
      Alert.alert("Zakończono pracę", `Przepracowano: ${h} godz. ${m} min`);
      await load();
    } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
  };

  if (loading) return <View style={s.rootLoading}><ActivityIndicator color={theme.color.brand} /></View>;

  const firstName = (user?.name || user?.email || "").split(/\s|@/)[0];

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: insets.top + 8, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={theme.color.brand} />}>
        {/* Hi header */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View>
            <Text style={s.brand}>MÓJ PANEL</Text>
            <Text style={s.title}>Cześć, {firstName} 👋</Text>
          </View>
          <Pressable onPress={logout} hitSlop={10} style={s.iconBtn}>
            <Feather name="log-out" size={16} color={theme.color.onSurfaceSecondary} />
          </Pressable>
        </View>

        {/* Today card */}
        <View style={[s.card, { backgroundColor: theme.color.brand + "0A", borderColor: theme.color.brand + "44" }]}>
          <Text style={s.sectionLabel}>DZISIAJ</Text>
          {todayEvent ? (
            <>
              <Text style={s.eventName}>{todayEvent.name}</Text>
              <View style={{ flexDirection: "row", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                {todayEvent.time_start ? (
                  <View style={s.metaChip}>
                    <Feather name="clock" size={12} color={theme.color.brand} />
                    <Text style={s.metaText}>{todayEvent.time_start}{todayEvent.time_end ? `–${todayEvent.time_end}` : ""}</Text>
                  </View>
                ) : null}
                {todayEvent.people ? (
                  <View style={s.metaChip}>
                    <Feather name="users" size={12} color={theme.color.brand} />
                    <Text style={s.metaText}>{todayEvent.people} osób</Text>
                  </View>
                ) : null}
                {todayEvent.my_shift?.role ? (
                  <View style={s.metaChip}>
                    <Feather name="briefcase" size={12} color={theme.color.brand} />
                    <Text style={s.metaText}>{todayEvent.my_shift.role}</Text>
                  </View>
                ) : null}
                {todayEvent.location ? (
                  <View style={s.metaChip}>
                    <Feather name="map-pin" size={12} color={theme.color.brand} />
                    <Text style={s.metaText}>{todayEvent.location}</Text>
                  </View>
                ) : null}
              </View>
            </>
          ) : (
            <Text style={{ color: theme.color.onSurfaceSecondary, marginTop: 4 }}>Nie masz dziś zaplanowanej pracy.</Text>
          )}
        </View>

        {/* Clock in/out */}
        <View style={[s.card, { marginTop: 12 }]}>
          <Text style={s.sectionLabel}>LISTA OBECNOŚCI</Text>
          {openSession ? (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
                <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: "#EF4444" }} />
                <Text style={{ color: theme.color.onSurface, fontWeight: "700", fontSize: 14 }}>
                  Trwa praca · rozpoczęto {new Date(openSession.start_at).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}
                </Text>
              </View>
              <Pressable onPress={clockOut} style={[s.primaryBtn, { backgroundColor: "#EF4444", marginTop: 10 }]}>
                <Feather name="log-out" size={18} color="#fff" />
                <Text style={[s.primaryBtnText, { color: "#fff" }]}>KOŃCZĘ PRACĘ</Text>
              </Pressable>
            </>
          ) : (
            <Pressable onPress={clockIn} style={[s.primaryBtn, { marginTop: 8 }]}>
              <Feather name="play" size={18} color={theme.color.onBrand} />
              <Text style={s.primaryBtnText}>ROZPOCZYNAM PRACĘ</Text>
            </Pressable>
          )}
          <Pressable onPress={() => router.push("/obecnosc")} style={s.linkBtn}>
            <Text style={s.linkBtnText}>Zobacz moją historię obecności ›</Text>
          </Pressable>
        </View>

        {/* Upcoming shifts */}
        <View style={{ marginTop: 20 }}>
          <Text style={s.sectionTitle}>Nadchodzące ({upcoming.length})</Text>
          {upcoming.length === 0 ? (
            <Text style={{ color: theme.color.onSurfaceSecondary, textAlign: "center", padding: 20 }}>
              Brak zaplanowanych zmian.
            </Text>
          ) : upcoming.map(ev => (
            <View key={ev.id} style={s.evRow}>
              <View style={s.dateBox}>
                <Text style={s.dateBoxDay}>{ev.date.slice(-2)}</Text>
                <Text style={s.dateBoxMon}>{dow(ev.date)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.evTitle} numberOfLines={1}>{ev.name}</Text>
                <Text style={s.evMeta}>
                  {ev.time_start ? `${ev.time_start}${ev.time_end ? `–${ev.time_end}` : ""}` : ""}
                  {ev.my_shift?.role ? ` · ${ev.my_shift.role}` : ""}
                  {ev.people ? ` · ${ev.people} os.` : ""}
                </Text>
              </View>
              {isToday(ev.date) ? (
                <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: theme.color.brand + "22" }}>
                  <Text style={{ color: theme.color.brand, fontSize: 9, fontWeight: "800" }}>DZIŚ</Text>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  rootLoading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.surface },
  brand: { color: theme.color.onSurfaceSecondary, letterSpacing: 3, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  title: { color: theme.color.onSurface, fontSize: 24, fontWeight: "700" },
  iconBtn: { width: 36, height: 36, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.border },
  card: { marginTop: 14, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface },
  sectionLabel: { color: theme.color.onSurfaceSecondary, letterSpacing: 1, fontSize: 10, fontWeight: "700" },
  eventName: { color: theme.color.onSurface, fontSize: 20, fontWeight: "800", marginTop: 4 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: theme.color.brand + "18" },
  metaText: { color: theme.color.brand, fontSize: 11, fontWeight: "700" },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14, borderRadius: 12, backgroundColor: theme.color.brand },
  primaryBtnText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 15, letterSpacing: 0.5 },
  linkBtn: { alignItems: "center", padding: 8 },
  linkBtnText: { color: theme.color.brand, fontSize: 12, fontWeight: "600" },
  sectionTitle: { color: theme.color.onSurface, fontSize: 16, fontWeight: "700", marginBottom: 8 },
  evRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, marginBottom: 6, borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface },
  dateBox: { width: 44, height: 44, borderRadius: 12, backgroundColor: theme.color.brand + "18", alignItems: "center", justifyContent: "center" },
  dateBoxDay: { color: theme.color.brand, fontSize: 16, fontWeight: "800" },
  dateBoxMon: { color: theme.color.brand, fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  evTitle: { color: theme.color.onSurface, fontSize: 14, fontWeight: "700" },
  evMeta: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
});

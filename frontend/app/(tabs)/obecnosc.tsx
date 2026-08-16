import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator, Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { api } from "@/src/api";

type Entry = {
  id: string; start_at: string; end_at: string | null; hours: number;
  event_id?: string | null; note?: string; manual?: boolean;
};

const fmtDate = (iso: string) => {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("pl-PL", { day: "2-digit", month: "long", year: "numeric" });
  } catch { return iso.slice(0, 10); }
};
const fmtTime = (iso: string | null) => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
};
const fmtDur = (h: number) => {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh} godz. ${mm} min`;
};

export default function ObecnoscScreen() {
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [openSession, setOpenSession] = useState<Entry | null>(null);

  const load = useCallback(async () => {
    try {
      const list: any = await api.timeMy(120);
      setEntries(list || []);
      setOpenSession((list || []).find((e: Entry) => !e.end_at) || null);
    } catch {}
  }, []);
  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);

  const clockIn = async () => {
    try {
      const r: any = await api.timeStart();
      await load();
      Alert.alert("Rozpoczęto pracę", fmtTime(r.start_at));
    } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
  };
  const clockOut = async () => {
    if (!openSession) return;
    try {
      const r: any = await api.timeStop({ entry_id: openSession.id });
      await load();
      Alert.alert("Zakończono pracę", `Przepracowano: ${fmtDur(r.hours)}`);
    } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
  };

  const totals = useMemo(() => {
    const now = new Date();
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay() + 1); // Mon
    weekStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    let wk = 0, mo = 0;
    entries.forEach(e => {
      if (!e.end_at || !e.hours) return;
      const d = new Date(e.start_at);
      if (d >= weekStart) wk += e.hours;
      if (d >= monthStart) mo += e.hours;
    });
    return { week: wk, month: mo };
  }, [entries]);

  if (loading) return <View style={s.rootLoading}><ActivityIndicator color={theme.color.brand} /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Text style={s.brand}>Lista obecności</Text>
        <Text style={s.title}>Moja historia</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={theme.color.brand} />}>
        {/* Summary + button */}
        <View style={s.hero}>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 1 }}><Text style={s.k}>TEN TYDZIEŃ</Text><Text style={s.v}>{fmtDur(totals.week)}</Text></View>
            <View style={{ flex: 1 }}><Text style={s.k}>TEN MIESIĄC</Text><Text style={s.v}>{fmtDur(totals.month)}</Text></View>
          </View>
          {openSession ? (
            <Pressable onPress={clockOut} style={[s.primaryBtn, { backgroundColor: "#EF4444", marginTop: 14 }]}>
              <Feather name="log-out" size={18} color="#fff" />
              <Text style={[s.primaryBtnText, { color: "#fff" }]}>KOŃCZĘ PRACĘ · od {fmtTime(openSession.start_at)}</Text>
            </Pressable>
          ) : (
            <Pressable onPress={clockIn} style={[s.primaryBtn, { marginTop: 14 }]}>
              <Feather name="play" size={18} color={theme.color.onBrand} />
              <Text style={s.primaryBtnText}>ROZPOCZYNAM PRACĘ</Text>
            </Pressable>
          )}
        </View>

        <Text style={s.sectionTitle}>Historia</Text>
        {entries.length === 0 ? (
          <Text style={{ color: theme.color.onSurfaceSecondary, textAlign: "center", padding: 20 }}>Jeszcze brak zapisów.</Text>
        ) : entries.map(e => (
          <View key={e.id} style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.date}>{fmtDate(e.start_at)}</Text>
              <Text style={s.meta}>Wejście: {fmtTime(e.start_at)} · Wyjście: {fmtTime(e.end_at)}</Text>
              {e.note ? <Text style={s.note}>{e.note}</Text> : null}
              {e.manual ? <Text style={s.manual}>· korekta administratora</Text> : null}
            </View>
            <View style={{ alignItems: "flex-end" }}>
              {e.end_at ? (
                <>
                  <Text style={s.hoursBig}>{fmtDur(e.hours)}</Text>
                </>
              ) : (
                <View style={s.liveBadge}>
                  <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: "#fff" }} />
                  <Text style={s.liveTxt}>W TRAKCIE</Text>
                </View>
              )}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  rootLoading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.surface },
  header: { paddingHorizontal: 20, paddingBottom: 8 },
  brand: { color: theme.color.onSurfaceSecondary, letterSpacing: 3, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  title: { color: theme.color.onSurface, fontSize: 24, fontWeight: "700" },
  hero: { marginTop: 8, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.color.brand + "44", backgroundColor: theme.color.brand + "0A" },
  k: { color: theme.color.onSurfaceSecondary, letterSpacing: 1, fontSize: 10, fontWeight: "700" },
  v: { color: theme.color.brand, fontSize: 18, fontWeight: "800", marginTop: 2 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14, borderRadius: 12, backgroundColor: theme.color.brand },
  primaryBtnText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 14, letterSpacing: 0.5 },
  sectionTitle: { color: theme.color.onSurface, fontSize: 16, fontWeight: "700", marginTop: 20, marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, marginBottom: 6, borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface },
  date: { color: theme.color.onSurface, fontSize: 14, fontWeight: "700" },
  meta: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  note: { color: theme.color.onSurfaceSecondary, fontSize: 11, fontStyle: "italic" },
  manual: { color: theme.color.warning, fontSize: 10, marginTop: 2 },
  hoursBig: { color: theme.color.brand, fontSize: 14, fontWeight: "800" },
  liveBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: "#EF4444" },
  liveTxt: { color: "#fff", fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
});

import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  TextInput, Alert, StatusBar, RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { v2 } from "@/src/designTokensV2";
import { api } from "@/src/api";

const fmtT = (iso?: string | null) => {
  try { return iso ? new Date(iso).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" }) : "…"; }
  catch { return "…"; }
};
const fmtDur = (h?: number) => {
  const mins = Math.round((h || 0) * 60);
  return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, "0")} min`;
};
const fmtDiff = (m?: number | null) => m == null ? "" : (m >= 0 ? `+${m} min` : `${m} min`);
const addDays = (iso: string, d: number) => {
  const dt = new Date(iso + "T12:00:00"); dt.setDate(dt.getDate() + d);
  return dt.toISOString().slice(0, 10);
};
const composeIso = (date: string, hhmm: string): string | null => {
  if (!/^\d{1,2}:\d{2}$/.test(hhmm.trim())) return null;
  const d = new Date(`${date}T${hhmm.trim().padStart(5, "0")}:00`);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

export default function CzasZespolu() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  // inline correction proposal per entry
  const [proposeFor, setProposeFor] = useState<any | null>(null); // {entry, staff_id}
  const [pStart, setPStart] = useState("");
  const [pEnd, setPEnd] = useState("");
  const [pReason, setPReason] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.timeTeam(date)); } catch (e) { console.warn(e); }
  }, [date]);
  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);

  const sendProposal = async () => {
    if (!proposeFor) return;
    const reason = pReason.trim();
    if (!reason) { Alert.alert("Błąd", "Podaj powód korekty"); return; }
    const entryDate = (proposeFor.entry.start_at || "").slice(0, 10) || date;
    const ps = pStart.trim() ? composeIso(entryDate, pStart) : null;
    const pe = pEnd.trim() ? composeIso(entryDate, pEnd) : null;
    if (!ps && !pe) { Alert.alert("Błąd", "Podaj proponowany START lub STOP"); return; }
    setSending(true);
    try {
      await api.timeCorrectionCreate({
        entry_id: proposeFor.entry.id, corr_type: "edit", staff_id: proposeFor.staff_id,
        proposed_start: ps || undefined, proposed_end: pe || undefined, reason,
      });
      setProposeFor(null); setPStart(""); setPEnd(""); setPReason("");
      await load();
      Alert.alert("Wysłano ✓", "Propozycja korekty czeka na akceptację pracownika. Zmiana zacznie obowiązywać dopiero po jego zatwierdzeniu.");
    } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
    finally { setSending(false); }
  };

  const rows = data?.rows || [];

  return (
    <View style={{ flex: 1, backgroundColor: v2.color.bg }}>
      <StatusBar barStyle="light-content" />
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.headerBtn} testID="team-back">
          <Feather name="arrow-left" size={18} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.brand}>ZESPÓŁ</Text>
          <Text style={s.title}>Czas pracy zespołu</Text>
        </View>
        <Pressable onPress={() => router.push("/korekty-czasu" as any)} hitSlop={10} style={s.headerBtn} testID="team-corrections">
          <Feather name="edit-3" size={16} color="#fff" />
          {!!data?.corrections_awaiting_manager && (
            <View style={s.badge}><Text style={s.badgeText}>{data.corrections_awaiting_manager}</Text></View>
          )}
        </Pressable>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={v2.color.forest} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={v2.color.forest} />}>

          {/* date nav */}
          <View style={s.dateRow}>
            <Pressable onPress={() => setDate(d => addDays(d, -1))} style={s.dateBtn} testID="team-prev-day">
              <Feather name="chevron-left" size={18} color={v2.color.forest} />
            </Pressable>
            <View style={{ alignItems: "center" }}>
              <Text style={s.dateLabel}>
                {new Date(date + "T12:00:00").toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" })}
              </Text>
              {date !== new Date().toISOString().slice(0, 10) && (
                <Pressable onPress={() => setDate(new Date().toISOString().slice(0, 10))}>
                  <Text style={{ color: v2.color.forest, fontSize: 11, fontWeight: "800" }}>Wróć do dziś</Text>
                </Pressable>
              )}
            </View>
            <Pressable onPress={() => setDate(d => addDays(d, 1))} style={s.dateBtn} testID="team-next-day">
              <Feather name="chevron-right" size={18} color={v2.color.forest} />
            </Pressable>
          </View>

          {/* corrections awaiting manager */}
          {!!data?.corrections_awaiting_manager && (
            <Pressable onPress={() => router.push("/korekty-czasu" as any)} style={s.corrBanner} testID="team-corr-banner">
              <Feather name="alert-circle" size={15} color="#92400E" />
              <Text style={s.corrBannerText}>
                Korekty oczekujące na moją akceptację: {data.corrections_awaiting_manager} ›
              </Text>
            </Pressable>
          )}

          {rows.length === 0 ? (
            <View style={s.emptyBox}>
              <Feather name="clock" size={22} color={v2.color.sage} />
              <Text style={s.emptyText}>Brak planów i wpisów czasu tego dnia.</Text>
            </View>
          ) : rows.map((r: any) => (
            <View key={r.staff_id} style={s.card} testID={`team-row-${r.staff_id}`}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={s.name}>{r.name}</Text>
                {r.active ? (
                  <View style={s.liveBadge}>
                    <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: "#fff" }} />
                    <Text style={s.liveText}>PRACA TRWA od {fmtT(r.active.start_at)}</Text>
                  </View>
                ) : r.diff_minutes != null ? (
                  <Text style={[s.diff, { color: r.diff_minutes >= 0 ? "#166534" : "#B45309" }]}>{fmtDiff(r.diff_minutes)}</Text>
                ) : null}
              </View>

              {/* planned */}
              {(r.planned || []).map((p: any, i: number) => (
                <Text key={i} style={s.planLine}>
                  📋 Plan: <Text style={s.strong}>{p.time_start || "?"}–{p.time_end || "?"}</Text>
                  {p.role ? ` · ${p.role}` : ""} · {p.event_name}
                </Text>
              ))}
              {(r.planned || []).length === 0 && <Text style={s.planLine}>📋 Brak planu na ten dzień</Text>}

              {/* actual entries */}
              {(r.entries || []).filter((e: any) => e.end_at).map((e: any) => (
                <View key={e.id} style={s.entryRow}>
                  <Text style={s.entryText}>
                    ⏱ Faktycznie: <Text style={s.strong}>{fmtT(e.start_at)}–{fmtT(e.end_at)}</Text> · {fmtDur(e.hours)}
                    {e.pending_correction_id ? "  ⏳ korekta oczekuje" : e.corrected ? "  ✓ po korekcie" : ""}
                  </Text>
                  {!e.pending_correction_id && (
                    <Pressable onPress={() => { setProposeFor({ entry: e, staff_id: r.staff_id }); setPStart(""); setPEnd(""); setPReason(""); }}
                      hitSlop={8} testID={`team-propose-${e.id}`}>
                      <Feather name="edit-2" size={14} color={v2.color.textMuted} />
                    </Pressable>
                  )}
                </View>
              ))}

              {!!r.pending_corrections && (
                <Text style={{ color: "#B45309", fontSize: 11, fontWeight: "800", marginTop: 4 }}>
                  ⏳ Oczekujące korekty: {r.pending_corrections}
                </Text>
              )}

              {/* inline manager proposal */}
              {proposeFor?.entry && r.entries?.some((e: any) => e.id === proposeFor.entry.id) && (
                <View style={s.proposeBox}>
                  <Text style={s.proposeTitle}>Zaproponuj korektę ({fmtT(proposeFor.entry.start_at)}–{fmtT(proposeFor.entry.end_at)})</Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <TextInput value={pStart} onChangeText={setPStart} placeholder="START 09:00" placeholderTextColor={v2.color.textMuted} style={[s.input, { flex: 1 }]} testID="team-p-start" />
                    <TextInput value={pEnd} onChangeText={setPEnd} placeholder="STOP 15:00" placeholderTextColor={v2.color.textMuted} style={[s.input, { flex: 1 }]} testID="team-p-end" />
                  </View>
                  <TextInput value={pReason} onChangeText={setPReason} placeholder="Powód (np. korekta po uzgodnieniu)" placeholderTextColor={v2.color.textMuted} style={[s.input, { marginTop: 6 }]} testID="team-p-reason" />
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                    <Pressable disabled={sending} onPress={sendProposal} style={[s.sendBtn, sending && { opacity: 0.5 }]} testID="team-p-send">
                      {sending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.sendBtnText}>Wyślij do akceptacji pracownika</Text>}
                    </Pressable>
                    <Pressable onPress={() => setProposeFor(null)} style={s.cancelBtn}>
                      <Text style={{ color: v2.color.textMuted, fontSize: 12, fontWeight: "700" }}>Anuluj</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          ))}
          <Text style={{ color: v2.color.textMuted, fontSize: 11, textAlign: "center", marginTop: 8 }}>
            Każda zmiana godzin wymaga akceptacji pracownika — nie ma edycji jednostronnej.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: v2.color.forestDeep },
  headerBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: "#F59E0B", alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  badgeText: { color: "#fff", fontSize: 9, fontWeight: "900" },
  brand: { color: v2.color.moss, letterSpacing: 3, fontSize: 10, fontWeight: "800" },
  title: { color: "#fff", fontSize: 19, fontWeight: "800" },

  dateRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  dateBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: v2.color.mint, alignItems: "center", justifyContent: "center" },
  dateLabel: { color: v2.color.text, fontSize: 15, fontWeight: "800", textTransform: "capitalize" },

  corrBanner: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, backgroundColor: "#FEF3C7", borderWidth: 1, borderColor: "#F59E0B", marginBottom: 12 },
  corrBannerText: { color: "#92400E", fontSize: 13, fontWeight: "800", flex: 1 },

  emptyBox: { alignItems: "center", gap: 8, padding: 26, borderRadius: 14, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border },
  emptyText: { color: v2.color.textMuted, fontSize: 13 },

  card: { padding: 14, borderRadius: 14, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, marginBottom: 10 },
  name: { color: v2.color.text, fontSize: 15, fontWeight: "900" },
  diff: { fontSize: 13, fontWeight: "900" },
  liveBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: v2.color.forest, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7 },
  liveText: { color: "#fff", fontSize: 10, fontWeight: "900" },
  planLine: { color: v2.color.textMuted, fontSize: 12, marginTop: 5 },
  strong: { fontWeight: "900", color: v2.color.text },
  entryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 5 },
  entryText: { color: v2.color.text, fontSize: 12, flex: 1 },

  proposeBox: { marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: v2.color.bg, borderWidth: 1, borderColor: v2.color.border },
  proposeTitle: { color: v2.color.text, fontSize: 12, fontWeight: "800", marginBottom: 6 },
  input: { borderWidth: 1, borderColor: v2.color.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: v2.color.text, fontSize: 12, backgroundColor: v2.color.card },
  sendBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, backgroundColor: v2.color.forest, alignItems: "center" },
  sendBtnText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  cancelBtn: { paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
});

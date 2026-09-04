import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  TextInput, Alert, StatusBar, RefreshControl, KeyboardAvoidingView, Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { v2 } from "@/src/designTokensV2";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  PENDING_EMPLOYEE: { label: "Oczekuje na akceptację pracownika", color: "#92400E", bg: "#FEF3C7" },
  PENDING_MANAGER:  { label: "Oczekuje na akceptację szefa",      color: "#1E40AF", bg: "#DBEAFE" },
  APPROVED:         { label: "Zatwierdzona przez obie strony",     color: "#166534", bg: "#DCFCE7" },
  REJECTED:         { label: "Odrzucona",                          color: "#991B1B", bg: "#FEE2E2" },
  CANCELLED:        { label: "Wycofana",                           color: "#57534E", bg: "#F5F5F4" },
};

const fmtDT = (iso?: string | null) => {
  try { return iso ? new Date(iso).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"; }
  catch { return "—"; }
};
const fmtT = (iso?: string | null) => {
  try { return iso ? new Date(iso).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" }) : "…"; }
  catch { return "…"; }
};
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const composeIso = (date: string, hhmm: string): string | null => {
  if (!/^\d{1,2}:\d{2}$/.test(hhmm.trim())) return null;
  const d = new Date(`${date}T${hhmm.trim().padStart(5, "0")}:00`);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

export default function KorektyCzasu() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role !== "staff";
  const params = useLocalSearchParams<{ mode?: string; entry?: string }>();

  const [corrections, setCorrections] = useState<any[]>([]);
  const [myEntries, setMyEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // new request form (staff)
  const [formOpen, setFormOpen] = useState(!!params.mode);
  const [corrType, setCorrType] = useState<"edit" | "add">("edit");
  const [entryId, setEntryId] = useState<string | null>((params.entry as string) || null);
  const [date, setDate] = useState(todayLocal());
  const [startT, setStartT] = useState(params.mode === "start" ? "" : "");
  const [endT, setEndT] = useState("");
  const [reason, setReason] = useState(
    params.mode === "start" ? "Zapomniałem/am włączyć czas pracy" :
    params.mode === "stop" ? "Zapomniałem/am wyłączyć czas pracy" : ""
  );
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const [corrs, entries]: any[] = await Promise.all([
        api.timeCorrections(),
        isAdmin ? Promise.resolve([]) : api.timeMy(15),
      ]);
      setCorrections(Array.isArray(corrs) ? corrs : []);
      setMyEntries(Array.isArray(entries) ? entries : []);
      if (!entryId && Array.isArray(entries) && entries.length > 0) setEntryId(entries[0].id);
    } catch (e) { console.warn("korekty load", e); }
  }, [isAdmin, entryId]);

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const r = reason.trim();
    if (!r) { Alert.alert("Błąd", "Podaj powód korekty"); return; }
    const ps = startT.trim() ? composeIso(date, startT) : null;
    const pe = endT.trim() ? composeIso(date, endT) : null;
    if (startT.trim() && !ps) { Alert.alert("Błąd", "Nieprawidłowa godzina rozpoczęcia (format HH:MM)"); return; }
    if (endT.trim() && !pe) { Alert.alert("Błąd", "Nieprawidłowa godzina zakończenia (format HH:MM)"); return; }
    if (corrType === "add" && (!ps || !pe)) { Alert.alert("Błąd", "Dla nowego wpisu podaj START i STOP"); return; }
    if (corrType === "edit" && !ps && !pe) { Alert.alert("Błąd", "Podaj proponowany START lub STOP"); return; }
    if (corrType === "edit" && !entryId) { Alert.alert("Błąd", "Wybierz wpis czasu do korekty"); return; }
    setSending(true);
    try {
      await api.timeCorrectionCreate({
        corr_type: corrType,
        entry_id: corrType === "edit" ? entryId || undefined : undefined,
        proposed_start: ps || undefined,
        proposed_end: pe || undefined,
        reason: r,
      });
      setFormOpen(false); setStartT(""); setEndT(""); setReason("");
      await load();
      Alert.alert("Wysłano ✓", "Wniosek o korektę czeka na akceptację szefa. Zmiana zacznie obowiązywać dopiero po zatwierdzeniu.");
    } catch (e: any) { Alert.alert("Błąd", e?.message || "Nie udało się wysłać wniosku"); }
    finally { setSending(false); }
  };

  const act = async (c: any, action: "approve" | "reject" | "cancel") => {
    setBusyId(c.id);
    try {
      if (action === "approve") await api.timeCorrectionApprove(c.id);
      if (action === "reject") await api.timeCorrectionReject(c.id);
      if (action === "cancel") await api.timeCorrectionCancel(c.id);
      await load();
    } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
    finally { setBusyId(null); }
  };

  const awaitingMe = corrections.filter(c =>
    isAdmin ? c.status === "PENDING_MANAGER" : c.status === "PENDING_EMPLOYEE");
  const others = corrections.filter(c => !awaitingMe.includes(c));

  const renderCorr = (c: any, withActions: boolean) => {
    const st = STATUS_META[c.status] || STATUS_META.CANCELLED;
    const busy = busyId === c.id;
    const canCancel = (c.status === "PENDING_EMPLOYEE" || c.status === "PENDING_MANAGER") && c.requested_by_user_id === user?.id;
    return (
      <View key={c.id} style={s.card} testID={`corr-${c.id}`}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={s.corrStaff}>{c.staff_name}</Text>
          <View style={[s.statusChip, { backgroundColor: st.bg }]}>
            <Text style={[s.statusChipText, { color: st.color }]}>{st.label}</Text>
          </View>
        </View>
        <Text style={s.corrTitle}>
          {c.corr_type === "add" ? "➕ Dodanie zapomnianego wpisu" : c.corr_type === "delete" ? "🗑️ Usunięcie wpisu" : "✏️ Zmiana czasu pracy"}
        </Text>
        {c.corr_type !== "add" && (
          <Text style={s.corrLine}>było: <Text style={s.strong}>{fmtT(c.original_start)}–{fmtT(c.original_end)}</Text></Text>
        )}
        {c.corr_type !== "delete" && (
          <Text style={s.corrLine}>
            ma być: <Text style={[s.strong, { color: v2.color.forest }]}>
              {fmtT(c.proposed_start || c.original_start)}–{fmtT(c.proposed_end || c.original_end)}
            </Text>
          </Text>
        )}
        <Text style={s.corrMeta}>powód: „{c.reason}”</Text>
        <Text style={s.corrMeta}>zgłosił(a): {c.requested_by_name} · {fmtDT(c.created_at)}</Text>
        {c.status === "APPROVED" && (
          <Text style={s.corrMeta}>
            ✓ pracownik: {c.employee_approved_by} · szef: {c.manager_approved_by}
          </Text>
        )}
        {withActions ? (
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <Pressable disabled={busy} onPress={() => act(c, "approve")}
              style={[s.actBtn, { flex: 1.4, backgroundColor: "#16A34A", borderColor: "#16A34A" }]} testID={`corr-approve-${c.id}`}>
              {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={[s.actText, { color: "#fff" }]}>ZATWIERDŹ</Text>}
            </Pressable>
            <Pressable disabled={busy} onPress={() => act(c, "reject")}
              style={[s.actBtn, { flex: 1, borderColor: v2.color.error }]} testID={`corr-reject-${c.id}`}>
              <Text style={[s.actText, { color: v2.color.error }]}>ODRZUĆ</Text>
            </Pressable>
          </View>
        ) : canCancel ? (
          <Pressable disabled={busy} onPress={() => act(c, "cancel")} style={{ marginTop: 8 }} testID={`corr-cancel-${c.id}`}>
            <Text style={{ color: v2.color.textMuted, fontSize: 12, fontWeight: "700" }}>Wycofaj wniosek</Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: v2.color.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <StatusBar barStyle="light-content" />
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.headerBtn} testID="corr-back">
          <Feather name="arrow-left" size={18} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.brand}>CZAS PRACY</Text>
          <Text style={s.title}>Korekty czasu</Text>
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={v2.color.forest} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={v2.color.forest} />}>

          {/* Staff: new request */}
          {!isAdmin && (
            <View style={s.formCard}>
                  <Pressable onPress={() => setFormOpen(o => !o)} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }} testID="corr-form-toggle">
                <Text style={s.formTitle}>📝 Zgłoś korektę czasu</Text>
                <Feather name={formOpen ? "chevron-up" : "chevron-down"} size={18} color={v2.color.forest} />
              </Pressable>
              {formOpen && (
                <View style={{ marginTop: 10 }}>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <Pressable onPress={() => setCorrType("edit")} style={[s.typeChip, corrType === "edit" && s.typeChipActive]} testID="corr-type-edit">
                      <Text style={[s.typeChipText, corrType === "edit" && { color: "#fff" }]}>Popraw START/STOP</Text>
                    </Pressable>
                    <Pressable onPress={() => setCorrType("add")} style={[s.typeChip, corrType === "add" && s.typeChipActive]} testID="corr-type-add">
                      <Text style={[s.typeChipText, corrType === "add" && { color: "#fff" }]}>Dodaj zapomniany wpis</Text>
                    </Pressable>
                  </View>

                  {corrType === "edit" && (
                    <>
                      <Text style={s.inputLabel}>WPIS DO KOREKTY</Text>
                      {myEntries.length === 0 ? (
                        <Text style={{ color: v2.color.textMuted, fontSize: 12 }}>
                          Brak wpisów. Jeśli zapomniałeś(-aś) START — najpierw kliknij „ROZPOCZYNAM PRACĘ”, potem zgłoś korektę godziny rozpoczęcia.
                        </Text>
                      ) : myEntries.slice(0, 6).map(e => (
                        <Pressable key={e.id} onPress={() => setEntryId(e.id)}
                          style={[s.entryPick, entryId === e.id && { borderColor: v2.color.forest, backgroundColor: v2.color.mint }]}
                          testID={`corr-entry-${e.id}`}>
                          <Feather name={entryId === e.id ? "check-circle" : "circle"} size={14} color={v2.color.forest} />
                          <Text style={s.entryPickText}>
                            {fmtDT(e.start_at)} → {e.end_at ? fmtT(e.end_at) : "PRACA TRWA"}
                            {e.pending_correction_id ? "  ⏳" : ""}
                          </Text>
                        </Pressable>
                      ))}
                    </>
                  )}

                  <Text style={s.inputLabel}>DATA</Text>
                  <TextInput value={date} onChangeText={setDate} placeholder="2026-09-05" placeholderTextColor={v2.color.textMuted} style={s.input} testID="corr-date" />
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.inputLabel}>PROPONOWANY START (HH:MM)</Text>
                      <TextInput value={startT} onChangeText={setStartT} placeholder="09:00" placeholderTextColor={v2.color.textMuted} style={s.input} testID="corr-start" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.inputLabel}>PROPONOWANY STOP (HH:MM)</Text>
                      <TextInput value={endT} onChangeText={setEndT} placeholder="15:00" placeholderTextColor={v2.color.textMuted} style={s.input} testID="corr-end" />
                    </View>
                  </View>
                  <Text style={s.inputLabel}>POWÓD</Text>
                  <TextInput value={reason} onChangeText={setReason} placeholder="np. Zapomniałam włączyć czas pracy"
                    placeholderTextColor={v2.color.textMuted} style={[s.input, { minHeight: 50 }]} multiline testID="corr-reason" />
                  <Pressable disabled={sending} onPress={submit} style={[s.submitBtn, sending && { opacity: 0.5 }]} testID="corr-submit">
                    {sending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.submitBtnText}>Wyślij wniosek o korektę</Text>}
                  </Pressable>
                  <Text style={{ color: v2.color.textMuted, fontSize: 10, textAlign: "center", marginTop: 6 }}>
                    Zmiana zacznie obowiązywać dopiero po zatwierdzeniu przez szefa.
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Awaiting my approval */}
          <Text style={s.sectionLabel}>
            {isAdmin ? "OCZEKUJĄCE NA MOJĄ AKCEPTACJĘ (SZEF)" : "OCZEKUJĄCE NA MOJĄ AKCEPTACJĘ"} · {awaitingMe.length}
          </Text>
          {awaitingMe.length === 0 ? (
            <Text style={s.emptyText}>Brak korekt do zatwierdzenia.</Text>
          ) : awaitingMe.map(c => renderCorr(c, true))}

          {/* Others */}
          <Text style={[s.sectionLabel, { marginTop: 16 }]}>
            {isAdmin ? "WSZYSTKIE KOREKTY" : "MOJE ZGŁOSZENIA I HISTORIA"} · {others.length}
          </Text>
          {others.length === 0 ? (
            <Text style={s.emptyText}>Brak innych korekt.</Text>
          ) : others.map(c => renderCorr(c, false))}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: v2.color.forestDeep },
  headerBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  brand: { color: v2.color.moss, letterSpacing: 3, fontSize: 10, fontWeight: "800" },
  title: { color: "#fff", fontSize: 19, fontWeight: "800" },

  formCard: { padding: 14, borderRadius: 14, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, marginBottom: 16 },
  formTitle: { color: v2.color.text, fontSize: 14, fontWeight: "800" },
  typeChip: { flex: 1, paddingVertical: 9, borderRadius: 9, borderWidth: 1.5, borderColor: v2.color.border, alignItems: "center" },
  typeChipActive: { backgroundColor: v2.color.forest, borderColor: v2.color.forest },
  typeChipText: { color: v2.color.text, fontSize: 11, fontWeight: "800" },
  inputLabel: { color: v2.color.textMuted, fontSize: 9, fontWeight: "800", letterSpacing: 0.5, marginTop: 10, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: v2.color.border, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 9, color: v2.color.text, fontSize: 13, backgroundColor: v2.color.bg },
  entryPick: { flexDirection: "row", alignItems: "center", gap: 8, padding: 9, borderRadius: 9, borderWidth: 1.2, borderColor: v2.color.border, marginBottom: 4 },
  entryPickText: { color: v2.color.text, fontSize: 12, fontWeight: "600" },
  submitBtn: { marginTop: 12, paddingVertical: 12, borderRadius: 10, backgroundColor: v2.color.forest, alignItems: "center" },
  submitBtnText: { color: "#fff", fontSize: 13, fontWeight: "800" },

  sectionLabel: { color: v2.color.text, fontSize: 12, fontWeight: "900", letterSpacing: 0.5, marginBottom: 8 },
  emptyText: { color: v2.color.textMuted, fontSize: 12, marginBottom: 8 },

  card: { padding: 14, borderRadius: 14, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, marginBottom: 10 },
  corrStaff: { color: v2.color.forest, fontSize: 12, fontWeight: "800" },
  statusChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, maxWidth: 220 },
  statusChipText: { fontSize: 9, fontWeight: "900" },
  corrTitle: { color: v2.color.text, fontSize: 14, fontWeight: "800", marginTop: 6 },
  corrLine: { color: v2.color.text, fontSize: 13, marginTop: 3 },
  strong: { fontWeight: "900" },
  corrMeta: { color: v2.color.textMuted, fontSize: 11, marginTop: 3 },
  actBtn: { paddingVertical: 11, borderRadius: 9, borderWidth: 1.5, borderColor: v2.color.border, alignItems: "center", justifyContent: "center" },
  actText: { fontSize: 12, fontWeight: "900" },
});

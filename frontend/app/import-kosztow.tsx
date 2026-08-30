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
import { formatPLN } from "@/src/theme";

const fmtDate = (iso?: string) => {
  try { return iso ? new Date(iso + "T12:00:00").toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" }) : ""; }
  catch { return iso || ""; }
};

export default function ImportKosztow() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [pending, setPending] = useState<any[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { amount: string; category: string }>>({});
  const [pickEventFor, setPickEventFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, s]: any[] = await Promise.all([api.costImportPending(), api.costImportSummary()]);
      setPending(Array.isArray(p) ? p : []);
      setSummary(s || null);
    } catch (e) { console.warn("import load", e); }
  }, []);

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);

  const getEdit = (r: any) => edits[r.id] || { amount: String(r.amount), category: r.category || "" };
  const setEdit = (id: string, patch: Partial<{ amount: string; category: string }>) =>
    setEdits(prev => ({ ...prev, [id]: { ...(prev[id] || { amount: "", category: "" }), ...patch } }));

  const resolve = async (r: any, action: string, event_id?: string) => {
    const e = getEdit(r);
    const amount = parseFloat((e.amount || String(r.amount)).replace(",", "."));
    if (action !== "reject" && (!amount || amount <= 0)) { Alert.alert("Błąd", "Nieprawidłowa kwota"); return; }
    setBusyId(r.id);
    try {
      await api.costImportResolve(r.id, { action, event_id, amount, category: e.category || r.category });
      setPending(prev => prev.filter(x => x.id !== r.id));
      setPickEventFor(null);
      api.costImportSummary().then((s: any) => setSummary(s)).catch(() => {});
    } catch (err: any) {
      Alert.alert("Błąd", err?.message || "Nie udało się zapisać");
    } finally { setBusyId(null); }
  };

  const rep = summary?.last_report;
  const byRes = summary?.by_resolution || {};
  const chip = (label: string, count: number | undefined, sum?: number, color?: string) => (
    <View style={[s.sumChip, color ? { borderColor: color } : null]} key={label}>
      <Text style={s.sumChipCount}>{count || 0}</Text>
      <Text style={s.sumChipLabel}>{label}</Text>
      {sum != null ? <Text style={s.sumChipSum}>{formatPLN(sum)}</Text> : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: v2.color.bg }}>
      <StatusBar barStyle="light-content" />
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.headerBtn} testID="import-back">
          <Feather name="arrow-left" size={18} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.brand}>FINANSE</Text>
          <Text style={s.title}>Import kosztów</Text>
        </View>
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
          {/* Report summary */}
          {rep ? (
            <View style={s.reportBox}>
              <Text style={s.reportTitle}>📊 Raport importu ({rep.batch_id})</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {chip("do imprez", rep.event_costs, rep.event_costs_sum, "#16A34A")}
                {chip("ogólne", rep.general_costs, rep.general_costs_sum)}
                {chip("inwestycje", rep.investments, rep.investments_sum, "#7C3AED")}
                {chip("rozliczenia", rep.settlements, rep.settlements_sum)}
                {chip("duplikaty", rep.skipped_duplicates)}
                {chip("informacje", rep.skipped_info)}
              </View>
              <Text style={s.reportHint}>
                Zarchiwizowano {rep.archived_old_whatsapp} starych wpisów WhatsApp (kopia bezpieczeństwa zachowana).
              </Text>
            </View>
          ) : null}

          {/* Pending */}
          <View style={s.sectionHead}>
            <Text style={s.sectionLabel}>DO WERYFIKACJI ({pending.length})</Text>
            {!!byRes.pending?.sum && <Text style={s.sectionSum}>{formatPLN(byRes.pending.sum)}</Text>}
          </View>

          {pending.length === 0 ? (
            <View style={s.emptyBox}>
              <Feather name="check-circle" size={26} color={v2.color.forest} />
              <Text style={s.emptyText}>Wszystko zweryfikowane 🎉</Text>
            </View>
          ) : pending.map(r => {
            const e = getEdit(r);
            const busy = busyId === r.id;
            return (
              <View key={r.id} style={s.card} testID={`import-rec-${r.id}`}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={s.cardDate}>{fmtDate(r.date)}{r.author ? ` · ${r.author}` : ""}</Text>
                  <Text style={s.cardType}>{r.record_type}</Text>
                </View>
                <Text style={s.cardDesc}>„{r.description}”</Text>
                <Text style={s.cardMeta}>
                  {r.category}{r.subcategory ? ` · ${r.subcategory}` : ""}{r.person ? ` · ${r.person}` : ""}
                </Text>
                {!!r.match_note && <Text style={s.matchNote}>ℹ️ {r.match_note}</Text>}

                {/* editable amount + category */}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                  <View style={{ width: 110 }}>
                    <Text style={s.inputLabel}>KWOTA (zł)</Text>
                    <TextInput
                      value={e.amount}
                      onChangeText={t => setEdit(r.id, { amount: t })}
                      keyboardType="decimal-pad"
                      style={s.input}
                      testID={`import-amount-${r.id}`}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.inputLabel}>KATEGORIA</Text>
                    <TextInput
                      value={e.category}
                      onChangeText={t => setEdit(r.id, { category: t })}
                      style={s.input}
                      testID={`import-category-${r.id}`}
                    />
                  </View>
                </View>

                {/* assign to event */}
                {pickEventFor === r.id ? (
                  <View style={{ marginTop: 8 }}>
                    <Text style={s.inputLabel}>WYBIERZ IMPREZĘ ({fmtDate(r.date)}):</Text>
                    {(r.candidates || []).length === 0 ? (
                      <Text style={s.cardMeta}>Brak imprez tego dnia — wybierz inną akcję.</Text>
                    ) : (r.candidates || []).map((ev: any) => (
                      <Pressable
                        key={ev.id}
                        disabled={busy}
                        onPress={() => resolve(r, "event", ev.id)}
                        style={s.candidateBtn}
                        testID={`import-candidate-${r.id}-${ev.id}`}
                      >
                        <Feather name="calendar" size={13} color={v2.color.forest} />
                        <Text style={s.candidateText} numberOfLines={1}>
                          {ev.name}{ev.time_start ? ` · ${ev.time_start}` : ""}
                        </Text>
                      </Pressable>
                    ))}
                    <Pressable onPress={() => setPickEventFor(null)}>
                      <Text style={{ color: v2.color.textMuted, fontSize: 12, textAlign: "center", marginTop: 6 }}>Anuluj wybór</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                    <Pressable disabled={busy} onPress={() => setPickEventFor(r.id)}
                      style={[s.actBtn, { backgroundColor: "#DCFCE7", borderColor: "#16A34A" }]} testID={`import-act-event-${r.id}`}>
                      <Text style={[s.actText, { color: "#166534" }]}>📅 Do imprezy{(r.candidates || []).length ? ` (${r.candidates.length})` : ""}</Text>
                    </Pressable>
                    <Pressable disabled={busy} onPress={() => resolve(r, "general")}
                      style={s.actBtn} testID={`import-act-general-${r.id}`}>
                      <Text style={s.actText}>Koszt ogólny</Text>
                    </Pressable>
                    <Pressable disabled={busy} onPress={() => resolve(r, "investment")}
                      style={[s.actBtn, { backgroundColor: "#EDE9FE", borderColor: "#7C3AED" }]} testID={`import-act-investment-${r.id}`}>
                      <Text style={[s.actText, { color: "#5B21B6" }]}>Inwestycja</Text>
                    </Pressable>
                    <Pressable disabled={busy} onPress={() => resolve(r, "settlement")}
                      style={s.actBtn} testID={`import-act-settlement-${r.id}`}>
                      <Text style={s.actText}>Rozlicz. właśc.</Text>
                    </Pressable>
                    <Pressable disabled={busy} onPress={() => resolve(r, "reject")}
                      style={[s.actBtn, { borderColor: v2.color.error }]} testID={`import-act-reject-${r.id}`}>
                      {busy ? <ActivityIndicator size="small" color={v2.color.error} /> : <Text style={[s.actText, { color: v2.color.error }]}>Odrzuć</Text>}
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
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

  reportBox: { padding: 14, borderRadius: 14, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, marginBottom: 14 },
  reportTitle: { color: v2.color.text, fontSize: 13, fontWeight: "800" },
  reportHint: { color: v2.color.textMuted, fontSize: 11, marginTop: 8 },
  sumChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: v2.color.border, backgroundColor: v2.color.bg, alignItems: "center" },
  sumChipCount: { color: v2.color.text, fontSize: 15, fontWeight: "900" },
  sumChipLabel: { color: v2.color.textMuted, fontSize: 10, fontWeight: "700" },
  sumChipSum: { color: v2.color.forest, fontSize: 10, fontWeight: "800", marginTop: 1 },

  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  sectionLabel: { color: v2.color.text, fontSize: 13, fontWeight: "900", letterSpacing: 0.5 },
  sectionSum: { color: "#B45309", fontSize: 12, fontWeight: "800" },

  emptyBox: { alignItems: "center", gap: 8, padding: 28, borderRadius: 14, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border },
  emptyText: { color: v2.color.textMuted, fontSize: 14, fontWeight: "700" },

  card: { padding: 14, borderRadius: 14, backgroundColor: v2.color.card, borderWidth: 1, borderColor: "#F59E0B55", marginBottom: 10 },
  cardDate: { color: v2.color.textMuted, fontSize: 11, fontWeight: "700" },
  cardType: { color: "#B45309", fontSize: 10, fontWeight: "800", maxWidth: 170, textAlign: "right" },
  cardDesc: { color: v2.color.text, fontSize: 14, fontWeight: "700", marginTop: 4 },
  cardMeta: { color: v2.color.textMuted, fontSize: 11, marginTop: 2 },
  matchNote: { color: "#1E40AF", fontSize: 11, fontWeight: "700", marginTop: 4 },

  inputLabel: { color: v2.color.textMuted, fontSize: 9, fontWeight: "800", marginBottom: 3, letterSpacing: 0.5 },
  input: {
    borderWidth: 1, borderColor: v2.color.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
    color: v2.color.text, fontSize: 13, backgroundColor: v2.color.bg,
  },

  actBtn: {
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1.2,
    borderColor: v2.color.border, backgroundColor: v2.color.bg, alignItems: "center", justifyContent: "center",
  },
  actText: { color: v2.color.text, fontSize: 11, fontWeight: "800" },
  candidateBtn: {
    flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10,
    backgroundColor: v2.color.mint, borderWidth: 1, borderColor: v2.color.forest + "44", marginTop: 6,
  },
  candidateText: { color: v2.color.forest, fontSize: 13, fontWeight: "700", flex: 1 },
});

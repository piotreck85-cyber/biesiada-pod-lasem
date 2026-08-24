import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput,
  Modal, KeyboardAvoidingView, Platform, Alert, RefreshControl,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { theme, formatPLN } from "@/src/theme";
import { api } from "@/src/api";

type Partner = { id: string; name: string; staff_type?: string; role?: string; hourly_rate?: number };

type Settlement = {
  id: string;
  partner_id: string;
  partner_name: string;
  amount: number;
  date: string;
  method: string;
  note?: string;
  kind?: string;
  created_by_name?: string;
  created_at?: string;
};

type SummaryRow = { partner_id: string; partner_name?: string; total: number; count: number };

const METHODS = ["Przelew", "Gotówka", "BLIK", "Karta", "Inne"];
const KINDS = [
  { k: "wypłata",  l: "Wypłata" },
  { k: "zaliczka", l: "Zaliczka" },
  { k: "zwrot",    l: "Zwrot" },
];

const fmtDate = (iso: string) => {
  if (!iso) return "";
  try { return new Date(iso + "T00:00:00").toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" }); }
  catch { return iso; }
};

export default function WspolnicyScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [rows, setRows] = useState<Settlement[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Settlement | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ partner_id: "", amount: "", date: new Date().toISOString().slice(0, 10), method: "Przelew", note: "", kind: "wypłata" });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [staff, sList, sSummary]: any = await Promise.all([
        api.listStaff(),
        api.listPartnerSettlements(),
        api.partnerSettlementsSummary(),
      ]);
      const pList = (staff as Partner[]).filter(s => s.staff_type === "partner");
      setPartners(pList);
      setRows(sList as Settlement[]);
      setSummary(sSummary.by_partner || []);
      setTotal(sSummary.total || 0);
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openAdd = () => {
    if (partners.length === 0) {
      Alert.alert("Brak wspólników",
        "Najpierw oznacz przynajmniej jednego pracownika jako Wspólnika (Zespół → Pracownicy → edytuj → Rola).");
      return;
    }
    setEditing(null);
    setForm({
      partner_id: partners[0].id, amount: "",
      date: new Date().toISOString().slice(0, 10),
      method: "Przelew", note: "", kind: "wypłata",
    });
    setModalOpen(true);
  };

  const openEdit = (s: Settlement) => {
    setEditing(s);
    setForm({
      partner_id: s.partner_id, amount: String(s.amount),
      date: s.date, method: s.method || "Przelew",
      note: s.note || "", kind: s.kind || "wypłata",
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.partner_id) { Alert.alert("Uwaga", "Wybierz wspólnika"); return; }
    const amt = parseFloat(form.amount.replace(",", "."));
    if (!Number.isFinite(amt) || amt <= 0) { Alert.alert("Uwaga", "Podaj kwotę > 0"); return; }
    if (!form.date || form.date.length < 8) { Alert.alert("Uwaga", "Podaj datę"); return; }
    setSaving(true);
    try {
      if (editing) {
        await api.updatePartnerSettlement(editing.id, {
          amount: amt, date: form.date, method: form.method, note: form.note, kind: form.kind,
        });
      } else {
        await api.createPartnerSettlement({
          partner_id: form.partner_id, amount: amt, date: form.date,
          method: form.method, note: form.note, kind: form.kind,
        });
      }
      setModalOpen(false);
      await load();
    } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
    finally { setSaving(false); }
  };

  const remove = (s: Settlement) => {
    Alert.alert("Usunąć wypłatę?", `${formatPLN(s.amount)} · ${fmtDate(s.date)} · ${s.partner_name}`, [
      { text: "Anuluj", style: "cancel" },
      { text: "Usuń", style: "destructive", onPress: async () => {
        try { await api.deletePartnerSettlement(s.id); await load(); }
        catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
      }},
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.brand}>Finanse</Text>
          <Text style={s.title}>Rozliczenia wspólników</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={theme.color.brand} />}>

        {/* Info */}
        <View style={s.infoBox}>
          <Feather name="info" size={14} color={theme.color.info} />
          <Text style={s.infoText}>
            Wypłaty wspólników są rejestrowane osobno i <Text style={{ fontWeight: "800" }}>nie są kosztami firmy</Text>.
            Wypłaty pracowników godzinowych (nie-wspólników) pozostają w Kosztach.
          </Text>
        </View>

        {/* Total */}
        <View style={s.totalCard}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
            <Text style={s.totalLabel}>Suma wypłat</Text>
            <Text style={s.totalValue}>{formatPLN(total)}</Text>
          </View>
          <Text style={s.totalHint}>{rows.length} operacji · {summary.length} wspólników</Text>
        </View>

        {/* Per partner */}
        {summary.length > 0 && (
          <View style={{ marginTop: 14 }}>
            <Text style={s.sectionLabel}>Per wspólnik</Text>
            {summary.map(row => (
              <View key={row.partner_id} style={s.partnerRow}>
                <View style={s.avatar}>
                  <Feather name="user" size={14} color={theme.color.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.partnerName}>{row.partner_name || "?"}</Text>
                  <Text style={s.partnerMeta}>{row.count} wypłat</Text>
                </View>
                <Text style={s.partnerAmount}>{formatPLN(row.total)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* History */}
        <View style={{ marginTop: 18 }}>
          <Text style={s.sectionLabel}>Historia wypłat</Text>
          {loading ? (
            <ActivityIndicator color={theme.color.brand} style={{ marginTop: 20 }} />
          ) : rows.length === 0 ? (
            <View style={s.emptyBox}>
              <Feather name="credit-card" size={30} color={theme.color.onSurfaceSecondary} />
              <Text style={s.emptyTitle}>Brak wypłat</Text>
              <Text style={s.emptyText}>
                {partners.length === 0
                  ? "Najpierw oznacz pracownika jako Wspólnika w Zespole."
                  : "Dodaj pierwszą wypłatę wspólnikowi."}
              </Text>
            </View>
          ) : (
            rows.map(r => (
              <Pressable key={r.id} onPress={() => openEdit(r)} onLongPress={() => remove(r)} style={s.rowItem}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={s.rowAmount}>{formatPLN(r.amount)}</Text>
                    {r.kind ? <View style={s.kindPill}><Text style={s.kindText}>{r.kind}</Text></View> : null}
                  </View>
                  <Text style={s.rowMeta}>{r.partner_name} · {fmtDate(r.date)} · {r.method}{r.note ? ` · ${r.note}` : ""}</Text>
                </View>
                <Feather name="chevron-right" size={16} color={theme.color.onSurfaceSecondary} />
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>

      {/* FAB */}
      <Pressable onPress={openAdd} style={[s.fab, { bottom: insets.bottom + 20 }]} testID="add-partner-settlement">
        <Feather name="plus" size={22} color="#fff" />
      </Pressable>

      {/* Add / Edit modal */}
      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
            <Pressable style={{ flex: 1 }} onPress={() => setModalOpen(false)} />
            <View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}>
              <View style={s.handle} />
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={s.sheetTitle}>{editing ? "Edytuj wypłatę" : "Nowa wypłata wspólnika"}</Text>

                {!editing && (
                  <>
                    <Text style={s.label}>Wspólnik</Text>
                    <View style={s.chipRow}>
                      {partners.map(p => {
                        const active = form.partner_id === p.id;
                        return (
                          <Pressable key={p.id} onPress={() => setForm(f => ({ ...f, partner_id: p.id }))}
                            style={[s.chip, active && s.chipActive]}>
                            <Text style={[s.chipText, active && s.chipTextActive]}>{p.name}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                )}

                <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                  <View style={{ flex: 1.4 }}>
                    <Text style={s.label}>Kwota (zł)</Text>
                    <TextInput value={form.amount} onChangeText={t => setForm(f => ({ ...f, amount: t }))}
                      placeholder="0.00" placeholderTextColor={theme.color.onSurfaceSecondary}
                      keyboardType="decimal-pad" style={s.input} autoFocus />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.label}>Data</Text>
                    <TextInput value={form.date} onChangeText={t => setForm(f => ({ ...f, date: t }))}
                      placeholder="YYYY-MM-DD" placeholderTextColor={theme.color.onSurfaceSecondary} style={s.input} />
                  </View>
                </View>

                <Text style={[s.label, { marginTop: 14 }]}>Metoda</Text>
                <View style={s.chipRow}>
                  {METHODS.map(m => {
                    const active = form.method === m;
                    return (
                      <Pressable key={m} onPress={() => setForm(f => ({ ...f, method: m }))}
                        style={[s.chip, active && s.chipActive]}>
                        <Text style={[s.chipText, active && s.chipTextActive]}>{m}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={[s.label, { marginTop: 14 }]}>Rodzaj</Text>
                <View style={s.chipRow}>
                  {KINDS.map(k => {
                    const active = form.kind === k.k;
                    return (
                      <Pressable key={k.k} onPress={() => setForm(f => ({ ...f, kind: k.k }))}
                        style={[s.chip, active && s.chipActive]}>
                        <Text style={[s.chipText, active && s.chipTextActive]}>{k.l}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={[s.label, { marginTop: 14 }]}>Notatka (opcjonalna)</Text>
                <TextInput value={form.note} onChangeText={t => setForm(f => ({ ...f, note: t }))}
                  placeholder="np. wypłata za sierpień"
                  placeholderTextColor={theme.color.onSurfaceSecondary}
                  style={[s.input, { minHeight: 50, textAlignVertical: "top" }]}
                  multiline />

                <View style={{ flexDirection: "row", gap: 8, marginTop: 20 }}>
                  {editing && (
                    <Pressable onPress={() => { setModalOpen(false); remove(editing); }}
                      style={[s.saveBtn, { flex: 1, backgroundColor: theme.color.error + "22" }]}>
                      <Feather name="trash-2" size={16} color={theme.color.error} />
                      <Text style={[s.saveText, { color: theme.color.error }]}>Usuń</Text>
                    </Pressable>
                  )}
                  <Pressable onPress={save} disabled={saving} style={[s.saveBtn, { flex: 2 }, saving && { opacity: 0.5 }]}>
                    {saving ? <ActivityIndicator color="#fff" /> : (
                      <>
                        <Feather name="check" size={16} color="#fff" />
                        <Text style={s.saveText}>{editing ? "Zapisz" : "Dodaj wypłatę"}</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 12, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 6 },
  backBtn: { padding: 6, marginTop: 6 },
  brand: { color: theme.color.onSurfaceSecondary, letterSpacing: 3, fontSize: 10, fontWeight: "700", marginBottom: 2 },
  title: { color: theme.color.onSurface, fontSize: 22, fontWeight: "800" },

  infoBox: {
    flexDirection: "row", gap: 8, padding: 12, borderRadius: 12,
    backgroundColor: theme.color.info + "12", borderWidth: 1, borderColor: theme.color.info + "33",
    marginBottom: 14,
  },
  infoText: { flex: 1, color: theme.color.onSurface, fontSize: 12, lineHeight: 17 },

  totalCard: {
    padding: 14, borderRadius: 14, backgroundColor: theme.color.brand + "0A",
    borderWidth: 1, borderColor: theme.color.brand + "44",
  },
  totalLabel: { color: theme.color.onSurfaceSecondary, fontSize: 11, letterSpacing: 1, fontWeight: "700", textTransform: "uppercase" },
  totalValue: { color: theme.color.brand, fontSize: 24, fontWeight: "800" },
  totalHint: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 4 },

  sectionLabel: { color: theme.color.onSurfaceSecondary, fontSize: 10, letterSpacing: 1.5, fontWeight: "800", marginBottom: 8, textTransform: "uppercase" },

  partnerRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 12, marginBottom: 6, borderRadius: 10,
    backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border,
  },
  avatar: {
    width: 34, height: 34, borderRadius: 999,
    backgroundColor: theme.color.brand + "18",
    alignItems: "center", justifyContent: "center",
  },
  partnerName: { color: theme.color.onSurface, fontSize: 14, fontWeight: "700" },
  partnerMeta: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  partnerAmount: { color: theme.color.brand, fontSize: 15, fontWeight: "800" },

  emptyBox: {
    padding: 24, alignItems: "center", gap: 6, borderRadius: 12,
    borderWidth: 1, borderStyle: "dashed", borderColor: theme.color.border,
    backgroundColor: theme.color.surfaceSecondary + "80",
  },
  emptyTitle: { color: theme.color.onSurface, fontSize: 14, fontWeight: "700" },
  emptyText: { color: theme.color.onSurfaceSecondary, fontSize: 12, textAlign: "center", maxWidth: 280 },

  rowItem: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 12, marginBottom: 6, borderRadius: 10,
    backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border,
  },
  rowAmount: { color: theme.color.onSurface, fontSize: 15, fontWeight: "800" },
  rowMeta: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  kindPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: theme.color.brand + "18" },
  kindText: { color: theme.color.brand, fontSize: 9, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase" },

  fab: {
    position: "absolute", right: 20, width: 56, height: 56, borderRadius: 999,
    backgroundColor: theme.color.brand, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },

  sheet: { backgroundColor: theme.color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "88%" },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.color.border, marginBottom: 12 },
  sheetTitle: { color: theme.color.onSurface, fontSize: 18, fontWeight: "800", marginBottom: 12 },
  label: { color: theme.color.onSurfaceSecondary, fontSize: 11, letterSpacing: 1, fontWeight: "700", marginBottom: 6, textTransform: "uppercase" },
  input: {
    backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: theme.color.onSurface, fontSize: 15,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary,
  },
  chipActive: { borderColor: theme.color.brand, backgroundColor: theme.color.brand + "22" },
  chipText: { color: theme.color.onSurface, fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: theme.color.brand },

  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 12, backgroundColor: theme.color.brand },
  saveText: { color: "#fff", fontWeight: "800", fontSize: 14 },
});

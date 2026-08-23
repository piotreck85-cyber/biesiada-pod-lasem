import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, Alert, Modal,
  KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { api } from "@/src/api";
import { theme } from "@/src/theme";

type Payment = {
  id: string;
  amount: number;
  date: string;
  method: string;
  note?: string;
  kind?: string;
  created_by_name?: string;
  migrated_from_deposit?: boolean;
};

type Summary = {
  event: { id: string; name: string; date: string; price_total: number };
  payments: Payment[];
  payments_total: number;
  payments_remaining: number;
  payment_status: "Nie zapłacono" | "Zaliczka" | "Częściowo zapłacono" | "Zapłacono";
};

const PAYMENT_METHODS = ["Przelew", "Gotówka", "BLIK", "Karta", "Inne"];
const PAYMENT_KINDS: { key: string; label: string }[] = [
  { key: "zaliczka", label: "Zaliczka" },
  { key: "wpłata",   label: "Wpłata" },
  { key: "końcowa",  label: "Wpłata końcowa" },
];

function statusColor(s: string): string {
  if (s === "Zapłacono") return theme.color.success;
  if (s === "Częściowo zapłacono") return theme.color.warning;
  if (s === "Zaliczka") return theme.color.brand;
  return theme.color.error;
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return iso;
  }
}

const money = (n: number) => `${(Number(n) || 0).toFixed(2)} zł`;

export default function EventPayments({ eventId, priceTotalOverride }: { eventId: string; priceTotalOverride?: number }) {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Payment | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ amount: "", date: "", method: "Przelew", note: "", kind: "wpłata" });

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const r: any = await api.getEventPayments(eventId);
      setData(r);
    } catch (e: any) {
      setError(e?.message || "Błąd ładowania");
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const priceTotal = useMemo(() => {
    if (priceTotalOverride !== undefined && priceTotalOverride > 0) return priceTotalOverride;
    return data?.event?.price_total || 0;
  }, [data, priceTotalOverride]);

  const remaining = useMemo(() => {
    const paid = data?.payments_total || 0;
    return Math.max(0, priceTotal - paid);
  }, [data, priceTotal]);

  const openAdd = () => {
    setEditing(null);
    const isFirst = !data?.payments?.length;
    setForm({
      amount: "",
      date: new Date().toISOString().slice(0, 10),
      method: "Przelew",
      note: "",
      kind: isFirst ? "zaliczka" : "wpłata",
    });
    setModalOpen(true);
  };

  const openEdit = (p: Payment) => {
    setEditing(p);
    setForm({
      amount: String(p.amount),
      date: p.date,
      method: p.method || "Przelew",
      note: p.note || "",
      kind: p.kind || "wpłata",
    });
    setModalOpen(true);
  };

  const save = async () => {
    const amt = parseFloat(form.amount.replace(",", "."));
    if (!Number.isFinite(amt) || amt <= 0) { Alert.alert("Uwaga", "Podaj kwotę większą od zera"); return; }
    if (!form.date || form.date.length < 8) { Alert.alert("Uwaga", "Podaj datę wpłaty"); return; }
    setSaving(true);
    try {
      if (editing) {
        await api.editEventPayment(eventId, editing.id, {
          amount: amt, date: form.date, method: form.method, note: form.note, kind: form.kind,
        });
      } else {
        await api.addEventPayment(eventId, {
          amount: amt, date: form.date, method: form.method, note: form.note, kind: form.kind,
        });
      }
      setModalOpen(false);
      await load();
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "");
    } finally {
      setSaving(false);
    }
  };

  const remove = (p: Payment) => {
    Alert.alert("Usunąć wpłatę?", `${money(p.amount)} · ${fmtDate(p.date)}`, [
      { text: "Anuluj", style: "cancel" },
      { text: "Usuń", style: "destructive", onPress: async () => {
        try { await api.deleteEventPayment(eventId, p.id); await load(); }
        catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
      }},
    ]);
  };

  if (loading) return <View style={s.loadingBox}><ActivityIndicator color={theme.color.brand} /></View>;
  if (error) return (
    <View style={s.errBox}>
      <Feather name="alert-triangle" size={20} color={theme.color.error} />
      <Text style={s.errText}>{error}</Text>
      <Pressable onPress={load} style={s.retryBtn}><Text style={s.retryText}>Odśwież</Text></Pressable>
    </View>
  );

  const paidSum = data?.payments_total || 0;
  const status = data?.payment_status || "Nie zapłacono";

  return (
    <View>
      {/* Summary card */}
      <View style={s.summaryCard}>
        <View style={s.summaryRow}>
          <Text style={s.sumLabel}>Cena całkowita</Text>
          <Text style={s.sumValue}>{money(priceTotal)}</Text>
        </View>
        <View style={s.summaryRow}>
          <Text style={s.sumLabel}>Wpłacono</Text>
          <Text style={[s.sumValue, { color: paidSum > 0 ? theme.color.brand : theme.color.onSurfaceSecondary }]}>{money(paidSum)}</Text>
        </View>
        <View style={s.divider} />
        <View style={s.summaryRow}>
          <Text style={s.sumLabelBig}>Pozostało do zapłaty</Text>
          <Text style={[s.sumValueBig, { color: remaining > 0 ? theme.color.warning : theme.color.success }]}>{money(remaining)}</Text>
        </View>
        <View style={[s.statusPill, { backgroundColor: statusColor(status) + "22" }]}>
          <View style={[s.statusDot, { backgroundColor: statusColor(status) }]} />
          <Text style={[s.statusText, { color: statusColor(status) }]}>{status}</Text>
        </View>
      </View>

      {/* Payment history */}
      <View style={{ marginTop: 14 }}>
        <Text style={s.sectionLabel}>Historia wpłat ({data?.payments?.length || 0})</Text>
        {(data?.payments || []).length === 0 ? (
          <View style={s.emptyBox}>
            <Feather name="credit-card" size={22} color={theme.color.onSurfaceSecondary} />
            <Text style={s.emptyText}>Brak wpłat. Dodaj pierwszą wpłatę poniżej.</Text>
          </View>
        ) : (
          (data?.payments || []).map(p => (
            <Pressable key={p.id} onPress={() => openEdit(p)} onLongPress={() => remove(p)} style={s.payRow}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={s.payAmount}>{money(p.amount)}</Text>
                  {p.kind ? (
                    <View style={s.kindPill}>
                      <Text style={s.kindText}>{p.kind}</Text>
                    </View>
                  ) : null}
                  {p.migrated_from_deposit ? (
                    <View style={[s.kindPill, { backgroundColor: theme.color.info + "22" }]}>
                      <Text style={[s.kindText, { color: theme.color.info }]}>zmigrowana</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={s.payMeta}>{fmtDate(p.date)} · {p.method}{p.note ? ` · ${p.note}` : ""}</Text>
              </View>
              <Feather name="chevron-right" size={16} color={theme.color.onSurfaceSecondary} />
            </Pressable>
          ))
        )}
        <Pressable onPress={openAdd} style={s.addBtn} testID="add-payment-btn">
          <Feather name="plus" size={16} color="#fff" />
          <Text style={s.addText}>Dodaj wpłatę</Text>
        </Pressable>
      </View>

      {/* Add / Edit modal */}
      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
            <Pressable style={{ flex: 1 }} onPress={() => setModalOpen(false)} />
            <View style={s.sheet}>
              <View style={s.handle} />
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={s.sheetTitle}>{editing ? "Edytuj wpłatę" : "Nowa wpłata"}</Text>

                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1.4 }}>
                    <Text style={s.label}>Kwota (zł)</Text>
                    <TextInput
                      value={form.amount}
                      onChangeText={t => setForm(f => ({ ...f, amount: t }))}
                      placeholder="0.00"
                      placeholderTextColor={theme.color.onSurfaceSecondary}
                      keyboardType="decimal-pad"
                      style={s.input}
                      autoFocus
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.label}>Data</Text>
                    <TextInput
                      value={form.date}
                      onChangeText={t => setForm(f => ({ ...f, date: t }))}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={theme.color.onSurfaceSecondary}
                      style={s.input}
                    />
                  </View>
                </View>

                <Text style={[s.label, { marginTop: 14 }]}>Metoda</Text>
                <View style={s.rowWrap}>
                  {PAYMENT_METHODS.map(m => {
                    const active = form.method === m;
                    return (
                      <Pressable key={m} onPress={() => setForm(f => ({ ...f, method: m }))}
                        style={[s.chip, active && s.chipActive]}>
                        <Text style={[s.chipText, active && s.chipTextActive]}>{m}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={[s.label, { marginTop: 14 }]}>Rodzaj wpłaty</Text>
                <View style={s.rowWrap}>
                  {PAYMENT_KINDS.map(k => {
                    const active = form.kind === k.key;
                    return (
                      <Pressable key={k.key} onPress={() => setForm(f => ({ ...f, kind: k.key }))}
                        style={[s.chip, active && s.chipActive]}>
                        <Text style={[s.chipText, active && s.chipTextActive]}>{k.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={[s.label, { marginTop: 14 }]}>Notatka (opcjonalna)</Text>
                <TextInput
                  value={form.note}
                  onChangeText={t => setForm(f => ({ ...f, note: t }))}
                  placeholder="np. wpłata na konto Alior 12.08"
                  placeholderTextColor={theme.color.onSurfaceSecondary}
                  style={[s.input, { minHeight: 60, textAlignVertical: "top" }]}
                  multiline
                />

                <View style={{ flexDirection: "row", gap: 8, marginTop: 20 }}>
                  {editing ? (
                    <Pressable onPress={() => { setModalOpen(false); remove(editing); }}
                      style={[s.saveBtn, { flex: 1, backgroundColor: theme.color.error + "22" }]}>
                      <Feather name="trash-2" size={16} color={theme.color.error} />
                      <Text style={[s.saveText, { color: theme.color.error }]}>Usuń</Text>
                    </Pressable>
                  ) : null}
                  <Pressable onPress={save} disabled={saving} style={[s.saveBtn, { flex: 2 }, saving && { opacity: 0.5 }]}>
                    {saving ? <ActivityIndicator color="#fff" /> : (
                      <>
                        <Feather name="check" size={16} color="#fff" />
                        <Text style={s.saveText}>{editing ? "Zapisz zmiany" : "Dodaj wpłatę"}</Text>
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
  loadingBox: { padding: 20, alignItems: "center" },
  errBox: { padding: 14, alignItems: "center", gap: 6, borderRadius: 10, backgroundColor: theme.color.error + "0A" },
  errText: { color: theme.color.error, fontSize: 12 },
  retryBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.color.brand + "18" },
  retryText: { color: theme.color.brand, fontWeight: "700", fontSize: 12 },

  summaryCard: {
    padding: 14, borderRadius: 14,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: 1, borderColor: theme.color.border,
  },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 },
  sumLabel: { color: theme.color.onSurfaceSecondary, fontSize: 12 },
  sumValue: { color: theme.color.onSurface, fontSize: 15, fontWeight: "700" },
  divider: { height: 1, backgroundColor: theme.color.divider, marginVertical: 8 },
  sumLabelBig: { color: theme.color.onSurface, fontSize: 13, fontWeight: "700" },
  sumValueBig: { fontSize: 22, fontWeight: "800" },
  statusPill: {
    marginTop: 10, alignSelf: "flex-start",
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },

  sectionLabel: { color: theme.color.onSurfaceSecondary, fontSize: 10, letterSpacing: 1.5, fontWeight: "800", marginBottom: 8, textTransform: "uppercase" },
  emptyBox: { padding: 20, alignItems: "center", gap: 6, borderRadius: 12, backgroundColor: theme.color.surfaceSecondary + "80", borderWidth: 1, borderStyle: "dashed", borderColor: theme.color.border },
  emptyText: { color: theme.color.onSurfaceSecondary, fontSize: 12, textAlign: "center" },

  payRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 12, marginBottom: 6, borderRadius: 10,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: 1, borderColor: theme.color.border,
  },
  payAmount: { color: theme.color.onSurface, fontSize: 15, fontWeight: "800" },
  payMeta: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  kindPill: {
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999,
    backgroundColor: theme.color.brand + "18",
  },
  kindText: { color: theme.color.brand, fontSize: 9, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase" },

  addBtn: {
    marginTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    padding: 12, borderRadius: 10, backgroundColor: theme.color.brand,
  },
  addText: { color: "#fff", fontWeight: "800", fontSize: 14 },

  sheet: { backgroundColor: theme.color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32, maxHeight: "88%" },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.color.border, marginBottom: 12 },
  sheetTitle: { color: theme.color.onSurface, fontSize: 18, fontWeight: "800", marginBottom: 14 },
  label: { color: theme.color.onSurfaceSecondary, fontSize: 11, letterSpacing: 1, fontWeight: "700", marginBottom: 6, textTransform: "uppercase" },
  input: {
    backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: theme.color.onSurface, fontSize: 15,
  },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary,
  },
  chipActive: { borderColor: theme.color.brand, backgroundColor: theme.color.brand + "22" },
  chipText: { color: theme.color.onSurface, fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: theme.color.brand },

  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    padding: 14, borderRadius: 12, backgroundColor: theme.color.brand,
  },
  saveText: { color: "#fff", fontWeight: "800", fontSize: 14 },
});

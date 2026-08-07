import { useCallback, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, FlatList, TextInput, Modal,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView, RefreshControl,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme, formatPLN, MONTHS_PL } from "@/src/theme";
import { api } from "@/src/api";

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Koszty() {
  const insets = useSafeAreaInsets();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api.listExpenses(year, month + 1)); } catch {}
  }, [year, month]);
  useFocusEffect(useCallback(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]));

  const prev = () => { if (month === 0) { setMonth(11); setYear(year - 1); } else setMonth(month - 1); };
  const next = () => { if (month === 11) { setMonth(0); setYear(year + 1); } else setMonth(month + 1); };

  const total = useMemo(() => items.reduce((s, e) => s + (e.amount || 0), 0), [items]);

  const openNew = () => { setEditing(null); setLabel(""); setAmount(""); setDate(todayIso()); setNotes(""); setModalOpen(true); };
  const openEdit = (it: any) => { setEditing(it); setLabel(it.label); setAmount(String(it.amount)); setDate(it.date); setNotes(it.notes || ""); setModalOpen(true); };
  const save = async () => {
    if (!label.trim() || !date) return;
    setSaving(true);
    try {
      const body = { label: label.trim(), amount: parseFloat(amount.replace(",", ".")) || 0, date, notes: notes.trim() };
      if (editing) await api.updateExpense(editing.id, body);
      else await api.createExpense(body);
      setModalOpen(false);
      await load();
    } catch {} finally { setSaving(false); }
  };
  const remove = async (id: string) => {
    await api.deleteExpense(id);
    await load();
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]} testID="expenses-screen">
      <View style={s.header}>
        <Text style={s.brand}>Koszty firmowe</Text>
        <View style={s.monthNav}>
          <Pressable testID="exp-prev-month" onPress={prev} style={s.navBtn} hitSlop={10}>
            <Feather name="chevron-left" size={20} color={theme.color.onSurface} />
          </Pressable>
          <Text style={s.monthTitle}>{MONTHS_PL[month]} {year}</Text>
          <Pressable testID="exp-next-month" onPress={next} style={s.navBtn} hitSlop={10}>
            <Feather name="chevron-right" size={20} color={theme.color.onSurface} />
          </Pressable>
        </View>
      </View>

      <View style={s.summaryCard}>
        <View>
          <Text style={s.summaryLabel}>Suma kosztów miesiąca</Text>
          <Text style={s.summaryValue}>{formatPLN(total)}</Text>
        </View>
        <View style={s.summaryBadge}><Text style={s.summaryBadgeText}>{items.length} pozycji</Text></View>
      </View>

      {loading ? (
        <ActivityIndicator color={theme.color.brand} style={{ marginTop: 30 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: 140 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={theme.color.brand} />}
          ListEmptyComponent={
            <View style={s.emptyBox}>
              <Feather name="dollar-sign" size={40} color={theme.color.onSurfaceSecondary} />
              <Text style={s.emptyTitle}>Brak kosztów firmowych w tym miesiącu</Text>
              <Text style={s.emptySub}>Dodaj tu wydatki niezwiązane z konkretną imprezą (najem, media, marketing itp.). Wliczą się do zysku w Statystykach.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable testID={`exp-row-${item.id}`} style={s.row} onPress={() => openEdit(item)}>
              <View style={s.dateChip}><Text style={s.dateChipText}>{item.date.slice(8, 10)}.{item.date.slice(5, 7)}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={s.rowName}>{item.label}</Text>
                {!!item.notes && <Text style={s.rowNotes} numberOfLines={1}>{item.notes}</Text>}
              </View>
              <Text style={s.rowAmount}>{formatPLN(item.amount)}</Text>
              <Pressable testID={`exp-del-${item.id}`} onPress={() => remove(item.id)} hitSlop={10} style={{ paddingLeft: 10 }}>
                <Feather name="trash-2" size={16} color={theme.color.onSurfaceSecondary} />
              </Pressable>
            </Pressable>
          )}
        />
      )}

      <Pressable testID="add-expense-btn" style={[s.fab, { bottom: insets.bottom + 80 }]} onPress={openNew}>
        <Feather name="plus" size={24} color={theme.color.onBrand} />
      </Pressable>

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <Pressable style={s.backdrop} onPress={() => setModalOpen(false)} />
          <View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={s.grip} />
            <Text style={s.sheetTitle}>{editing ? "Edytuj koszt" : "Nowy koszt firmowy"}</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={s.label}>Nazwa</Text>
              <TextInput testID="exp-label-input" value={label} onChangeText={setLabel} placeholder="np. Najem, Prąd, Marketing" placeholderTextColor={theme.color.onSurfaceSecondary} style={s.input} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>Kwota (PLN)</Text>
                  <TextInput testID="exp-amount-input" value={amount} onChangeText={setAmount} placeholder="0" placeholderTextColor={theme.color.onSurfaceSecondary} keyboardType="decimal-pad" style={s.input} />
                </View>
                <View style={{ flex: 1.2 }}>
                  <Text style={s.label}>Data</Text>
                  <TextInput testID="exp-date-input" value={date} onChangeText={setDate} placeholder="2026-08-01" placeholderTextColor={theme.color.onSurfaceSecondary} style={s.input} />
                </View>
              </View>
              <Text style={s.label}>Notatka</Text>
              <TextInput testID="exp-notes-input" value={notes} onChangeText={setNotes} placeholder="np. faktura FV/2026/12" placeholderTextColor={theme.color.onSurfaceSecondary} style={s.input} />
              <Pressable testID="exp-save-btn" onPress={save} disabled={saving || !label.trim() || !date} style={[s.saveBtn, (saving || !label.trim() || !date) && { opacity: 0.5 }]}>
                {saving ? <ActivityIndicator color={theme.color.onBrand} /> : <Text style={s.saveBtnText}>Zapisz</Text>}
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: 20, paddingBottom: 12, paddingTop: 8, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  brand: { color: theme.color.onSurfaceSecondary, letterSpacing: 3, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthTitle: { color: theme.color.onSurface, fontSize: 22, fontWeight: "700" },
  navBtn: { padding: 8, backgroundColor: theme.color.surfaceSecondary, borderRadius: 999 },
  summaryCard: {
    marginHorizontal: 20, marginTop: 14, marginBottom: 6, padding: 14,
    borderRadius: 16, backgroundColor: theme.color.surfaceSecondary,
    borderWidth: 1, borderColor: theme.color.brandTertiary,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  summaryLabel: { color: theme.color.onSurfaceSecondary, fontSize: 12, letterSpacing: 1 },
  summaryValue: { color: theme.color.error, fontSize: 22, fontWeight: "800", marginTop: 2 },
  summaryBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: theme.color.brand },
  summaryBadgeText: { color: theme.color.brand, fontSize: 11, fontWeight: "700" },
  row: {
    flexDirection: "row", alignItems: "center", padding: 14, backgroundColor: theme.color.surfaceSecondary,
    borderRadius: 14, marginBottom: 8, borderWidth: 1, borderColor: theme.color.border, gap: 12,
  },
  dateChip: {
    width: 44, height: 44, borderRadius: 10, backgroundColor: theme.color.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  dateChipText: { color: theme.color.onBrandTertiary, fontWeight: "700", fontSize: 12 },
  rowName: { color: theme.color.onSurface, fontSize: 15, fontWeight: "600" },
  rowNotes: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  rowAmount: { color: theme.color.error, fontWeight: "700", fontSize: 15 },
  emptyBox: { marginTop: 40, alignItems: "center", paddingHorizontal: 40 },
  emptyTitle: { color: theme.color.onSurface, fontSize: 17, fontWeight: "700", marginTop: 16, textAlign: "center" },
  emptySub: { color: theme.color.onSurfaceSecondary, marginTop: 8, textAlign: "center", lineHeight: 20, fontSize: 13 },
  fab: {
    position: "absolute", right: 20, width: 56, height: 56, borderRadius: 28,
    backgroundColor: theme.color.brand, alignItems: "center", justifyContent: "center",
    shadowColor: theme.color.brand, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.5, shadowRadius: 12,
    elevation: 8,
  },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    backgroundColor: theme.color.surfaceSecondary, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12, borderWidth: 1, borderColor: theme.color.border,
    maxHeight: "80%",
  },
  grip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.color.borderStrong, marginBottom: 12 },
  sheetTitle: { color: theme.color.onSurface, fontSize: 18, fontWeight: "700", marginBottom: 12 },
  label: { color: theme.color.onSurfaceSecondary, fontSize: 12, letterSpacing: 1, marginTop: 12, marginBottom: 6 },
  input: {
    backgroundColor: theme.color.surfaceTertiary, borderRadius: 12, color: theme.color.onSurface,
    paddingHorizontal: 14, paddingVertical: 14, fontSize: 15, borderWidth: 1, borderColor: theme.color.border,
  },
  saveBtn: { marginTop: 20, backgroundColor: theme.color.brand, borderRadius: 12, paddingVertical: 15, alignItems: "center" },
  saveBtnText: { color: theme.color.onBrand, fontWeight: "700", fontSize: 16 },
});

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
import { EXPENSE_CATEGORIES, expenseCategoryLabel, expenseCategoryColor } from "@/src/expenseCategories";

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
  const [category, setCategory] = useState<string>("");
  const [filterCat, setFilterCat] = useState<string>(""); // "" = all
  const [saving, setSaving] = useState(false);
  const [scope, setScope] = useState<"month" | "all">("month");

  const load = useCallback(async () => {
    try {
      if (scope === "all") {
        setItems(await api.listExpenses());  // no year/month → all-time
      } else {
        setItems(await api.listExpenses(year, month + 1));
      }
    } catch {}
  }, [year, month, scope]);
  useFocusEffect(useCallback(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]));

  const prev = () => { if (month === 0) { setMonth(11); setYear(year - 1); } else setMonth(month - 1); };
  const next = () => { if (month === 11) { setMonth(0); setYear(year + 1); } else setMonth(month + 1); };

  const visible = useMemo(
    () => filterCat ? items.filter(e => (e.category || "") === filterCat) : items,
    [items, filterCat]
  );
  const total = useMemo(() => visible.reduce((s, e) => s + (e.amount || 0), 0), [visible]);
  const totalAll = useMemo(() => items.reduce((s, e) => s + (e.amount || 0), 0), [items]);
  const totalsByCat = useMemo(() => {
    const map: Record<string, number> = {};
    for (const it of items) map[it.category || ""] = (map[it.category || ""] || 0) + (it.amount || 0);
    return map;
  }, [items]);

  const openNew = () => { setEditing(null); setLabel(""); setAmount(""); setDate(todayIso()); setNotes(""); setCategory(""); setModalOpen(true); };
  const openEdit = (it: any) => { setEditing(it); setLabel(it.label); setAmount(String(it.amount)); setDate(it.date); setNotes(it.notes || ""); setCategory(it.category || ""); setModalOpen(true); };
  const save = async () => {
    if (!label.trim() || !date) return;
    setSaving(true);
    try {
      const body = {
        label: label.trim(),
        amount: parseFloat(amount.replace(",", ".")) || 0,
        date, notes: notes.trim(), category,
      };
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
          <Pressable testID="exp-prev-month" onPress={prev} style={s.navBtn} hitSlop={10} disabled={scope === "all"}>
            <Feather name="chevron-left" size={20} color={scope === "all" ? theme.color.onSurfaceSecondary : theme.color.onSurface} />
          </Pressable>
          <Text style={s.monthTitle}>{scope === "all" ? "Od początku" : `${MONTHS_PL[month]} ${year}`}</Text>
          <Pressable testID="exp-next-month" onPress={next} style={s.navBtn} hitSlop={10} disabled={scope === "all"}>
            <Feather name="chevron-right" size={20} color={scope === "all" ? theme.color.onSurfaceSecondary : theme.color.onSurface} />
          </Pressable>
        </View>
      </View>

      {/* Scope toggle: Miesiąc | Wszystkie */}
      <View style={s.scopeRow}>
        <Pressable testID="exp-scope-month" onPress={() => setScope("month")} style={[s.scopeBtn, scope === "month" && s.scopeBtnActive]}>
          <Feather name="calendar" size={13} color={scope === "month" ? "#FFFFFF" : theme.color.onSurface} />
          <Text style={[s.scopeBtnText, scope === "month" && { color: "#FFFFFF" }]}>Miesiąc</Text>
        </Pressable>
        <Pressable testID="exp-scope-all" onPress={() => setScope("all")} style={[s.scopeBtn, scope === "all" && s.scopeBtnActive]}>
          <Feather name="layers" size={13} color={scope === "all" ? "#FFFFFF" : theme.color.onSurface} />
          <Text style={[s.scopeBtnText, scope === "all" && { color: "#FFFFFF" }]}>Wszystkie</Text>
        </Pressable>
      </View>

      <View style={s.summaryCard}>
        <View>
          <Text style={s.summaryLabel}>
            {filterCat
              ? `Suma · ${expenseCategoryLabel(filterCat)}${scope === "all" ? " (od początku)" : ""}`
              : (scope === "all" ? "Suma od początku" : "Suma kosztów miesiąca")}
          </Text>
          <Text style={s.summaryValue}>{formatPLN(total)}</Text>
          {filterCat && total !== totalAll ? (
            <Text style={s.summarySubValue}>z {formatPLN(totalAll)} łącznie</Text>
          ) : null}
        </View>
        <View style={s.summaryBadge}><Text style={s.summaryBadgeText}>{visible.length} pozycji</Text></View>
      </View>

      {/* Category totals breakdown — only when no filter active */}
      {!filterCat && Object.keys(totalsByCat).length > 0 && totalAll > 0 ? (
        <View style={s.breakdown}>
          {EXPENSE_CATEGORIES.filter(c => (totalsByCat[c.id] || 0) > 0).map(c => (
            <Pressable
              key={c.id}
              testID={`exp-breakdown-${c.id}`}
              onPress={() => setFilterCat(c.id)}
              style={s.breakdownRow}
            >
              <View style={[s.breakdownDot, { backgroundColor: c.color }]} />
              <Text style={s.breakdownLabel} numberOfLines={1}>{c.label}</Text>
              <Text style={s.breakdownAmt}>{formatPLN(totalsByCat[c.id] || 0)}</Text>
            </Pressable>
          ))}
          {(totalsByCat[""] || 0) > 0 && (
            <View style={s.breakdownRow}>
              <View style={[s.breakdownDot, { backgroundColor: "#8E8E93" }]} />
              <Text style={s.breakdownLabel}>Bez kategorii</Text>
              <Text style={s.breakdownAmt}>{formatPLN(totalsByCat[""])}</Text>
            </View>
          )}
        </View>
      ) : null}

      {/* Category filter chips */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.chipsRow}
      >
        <Pressable
          testID="exp-filter-all"
          onPress={() => setFilterCat("")}
          style={[s.chip, !filterCat && s.chipActive]}
        >
          <Text style={[s.chipText, !filterCat && s.chipTextActive]}>Wszystkie · {items.length}</Text>
        </Pressable>
        {EXPENSE_CATEGORIES.map(c => {
          const active = filterCat === c.id;
          const count = items.filter(it => (it.category || "") === c.id).length;
          if (count === 0 && !active) return null; // hide empty categories to reduce clutter
          return (
            <Pressable
              key={c.id}
              testID={`exp-filter-${c.id}`}
              onPress={() => setFilterCat(active ? "" : c.id)}
              style={[s.chip, active && { backgroundColor: c.color, borderColor: c.color }]}
            >
              <View style={[s.chipDot, { backgroundColor: c.color }]} />
              <Text style={[s.chipText, active && { color: "#FFFFFF" }]}>{c.label} · {count}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <ActivityIndicator color={theme.color.brand} style={{ marginTop: 30 }} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: 140 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={theme.color.brand} />}
          ListEmptyComponent={
            <View style={s.emptyBox}>
              <Feather name="dollar-sign" size={40} color={theme.color.onSurfaceSecondary} />
              <Text style={s.emptyTitle}>Brak kosztów w tym miesiącu{filterCat ? ` (${expenseCategoryLabel(filterCat)})` : ""}</Text>
              <Text style={s.emptySub}>Dodaj wydatki (najem, media, marketing, pensje…). Wliczą się do zysku w Statystykach.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable testID={`exp-row-${item.id}`} style={s.row} onPress={() => openEdit(item)}>
              <View style={[s.dateChip, item.category && { backgroundColor: expenseCategoryColor(item.category) + "22", borderColor: expenseCategoryColor(item.category) }]}>
                <Text style={[s.dateChipText, item.category && { color: expenseCategoryColor(item.category) }]}>{item.date.slice(8, 10)}.{item.date.slice(5, 7)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.rowName}>{item.label}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                  {item.category ? (
                    <View style={[s.catPill, { backgroundColor: expenseCategoryColor(item.category) + "1F" }]}>
                      <View style={[s.catPillDot, { backgroundColor: expenseCategoryColor(item.category) }]} />
                      <Text style={[s.catPillText, { color: expenseCategoryColor(item.category) }]}>{expenseCategoryLabel(item.category)}</Text>
                    </View>
                  ) : null}
                  {!!item.notes && <Text style={s.rowNotes} numberOfLines={1}>{item.notes}</Text>}
                </View>
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
              <Text style={s.label}>Kategoria kosztu</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 4 }}>
                <Pressable
                  testID="exp-cat-none"
                  onPress={() => setCategory("")}
                  style={[s.chip, !category && s.chipActive]}
                >
                  <Text style={[s.chipText, !category && s.chipTextActive]}>Bez kategorii</Text>
                </Pressable>
                {EXPENSE_CATEGORIES.map(c => {
                  const active = category === c.id;
                  return (
                    <Pressable
                      key={c.id}
                      testID={`exp-cat-${c.id}`}
                      onPress={() => setCategory(c.id)}
                      style={[s.chip, active && { backgroundColor: c.color, borderColor: c.color }]}
                    >
                      <View style={[s.chipDot, { backgroundColor: c.color }]} />
                      <Text style={[s.chipText, active && { color: "#FFFFFF" }]}>{c.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
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
  summarySubValue: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  summaryBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: theme.color.brand },
  breakdown: {
    marginHorizontal: 20, marginBottom: 8, borderRadius: 12,
    backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.divider,
    paddingVertical: 4,
  },
  breakdownRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, gap: 10 },
  breakdownDot: { width: 8, height: 8, borderRadius: 4 },
  breakdownLabel: { flex: 1, color: theme.color.onSurface, fontSize: 13 },
  breakdownAmt: { color: theme.color.onSurface, fontSize: 13, fontWeight: "700" },
  scopeRow: {
    flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingBottom: 4,
  },
  scopeBtn: {
    flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center",
    paddingVertical: 8, borderRadius: 10, borderWidth: 1,
    borderColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary,
  },
  scopeBtnActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  scopeBtnText: { color: theme.color.onSurface, fontWeight: "700", fontSize: 12 },
  chipsRow: {
    paddingHorizontal: 20, gap: 8, marginBottom: 10, paddingVertical: 4,
  },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: 1, borderColor: theme.color.border,
  },
  chipActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  chipText: { color: theme.color.onSurface, fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: theme.color.onBrand },
  chipDot: { width: 8, height: 8, borderRadius: 999 },
  catPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
  },
  catPillDot: { width: 6, height: 6, borderRadius: 999 },
  catPillText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.3 },
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

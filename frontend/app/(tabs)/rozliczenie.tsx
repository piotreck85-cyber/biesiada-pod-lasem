import { useCallback, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl,
  TextInput, Modal, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { theme, formatPLN } from "@/src/theme";
import { api } from "@/src/api";

type CashState = {
  cash_current: number;
  cash_from_last_settlement: number;
  revenue_since_last: number;
  cost_since_last: number;
  payouts_since_last: number;
  last_settlement: Settlement | null;
};

type Payout = { partner_name: string; amount: number };
type Settlement = {
  id: string;
  date: string;
  cash_before: number;
  payouts: Payout[];
  total_payout: number;
  cash_after: number;
  notes?: string;
  created_by_name?: string;
};

const fmtDate = (iso: string): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
};

export default function Rozliczenie() {
  const insets = useSafeAreaInsets();
  const [cash, setCash] = useState<CashState | null>(null);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, s]: any[] = await Promise.all([api.cashState(), api.listSettlements()]);
      setCash(c);
      setSettlements(s || []);
    } catch (e) {}
  }, []);
  useFocusEffect(useCallback(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true); await load(); setRefreshing(false);
  }, [load]);

  // ---------- New settlement form ----------
  const [rows, setRows] = useState<Array<{ name: string; amount: string }>>([
    { name: "Wspólnik 1", amount: "" },
    { name: "Wspólnik 2", amount: "" },
  ]);
  const [notes, setNotes] = useState("");

  const openModal = () => {
    setRows([
      { name: "Wspólnik 1", amount: "" },
      { name: "Wspólnik 2", amount: "" },
    ]);
    setNotes("");
    setModalOpen(true);
  };
  const addRow = () => setRows(p => [...p, { name: "", amount: "" }]);
  const removeRow = (i: number) => setRows(p => p.filter((_, ix) => ix !== i));
  const totalPayout = useMemo(() =>
    rows.reduce((s, r) => s + (parseFloat(String(r.amount).replace(",", ".")) || 0), 0),
    [rows]);
  const cashAfter = (cash?.cash_current || 0) - totalPayout;

  const submit = async () => {
    const payouts = rows
      .map(r => ({ partner_name: r.name.trim(), amount: parseFloat(String(r.amount).replace(",", ".")) || 0 }))
      .filter(p => p.partner_name && p.amount > 0);
    if (payouts.length === 0) {
      Alert.alert("Brak wypłat", "Wpisz kwoty i imiona wspólników przed zatwierdzeniem.");
      return;
    }
    if (totalPayout > (cash?.cash_current || 0)) {
      Alert.alert(
        "Kwota przekracza stan kasy",
        `Chcesz wypłacić ${formatPLN(totalPayout)}, a w kasie jest ${formatPLN(cash?.cash_current || 0)}.\nCzy na pewno kontynuować?`,
        [
          { text: "Anuluj", style: "cancel" },
          { text: "Kontynuuj", onPress: () => doSave(payouts) },
        ]
      );
      return;
    }
    await doSave(payouts);
  };

  const doSave = async (payouts: Payout[]) => {
    setSaving(true);
    try {
      await api.createSettlement({ payouts, notes: notes || undefined });
      setModalOpen(false);
      await load();
      Alert.alert("Rozliczenie zapisane", `Wypłacono ${formatPLN(totalPayout)}. Pozostało w kasie: ${formatPLN(cashAfter)}.`);
    } catch (e: any) {
      Alert.alert("Błąd", e.message || "Nie udało się zapisać");
    } finally { setSaving(false); }
  };

  if (loading) {
    return (
      <View style={s.rootLoading}>
        <ActivityIndicator color={theme.color.brand} />
      </View>
    );
  }

  const last = cash?.last_settlement;

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Text style={s.brand}>Rozliczenie</Text>
        <Text style={s.title}>Bilans kasy</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.brand} />}
      >
        {/* HERO: Current cash */}
        <View style={s.heroCard}>
          <Text style={s.heroLabel}>AKTUALNY STAN KASY</Text>
          <Text style={[s.heroValue, { color: (cash?.cash_current || 0) >= 0 ? theme.color.brand : theme.color.error }]}>
            {formatPLN(cash?.cash_current || 0)}
          </Text>
          <Text style={s.heroSub}>
            {last
              ? `Od ostatniego rozliczenia (${fmtDate(last.date)})`
              : "Bilans od początku"}
          </Text>
        </View>

        {/* From last settlement — grid */}
        <View style={s.grid}>
          <View style={[s.miniCard, { borderColor: theme.color.success + "44" }]}>
            <Feather name="trending-up" size={16} color={theme.color.success} />
            <Text style={s.miniLabel}>Zyski od rozliczenia</Text>
            <Text style={[s.miniValue, { color: theme.color.success }]}>+{formatPLN(cash?.revenue_since_last || 0)}</Text>
          </View>
          <View style={[s.miniCard, { borderColor: theme.color.error + "44" }]}>
            <Feather name="trending-down" size={16} color={theme.color.error} />
            <Text style={s.miniLabel}>Koszty od rozliczenia</Text>
            <Text style={[s.miniValue, { color: theme.color.error }]}>−{formatPLN(cash?.cost_since_last || 0)}</Text>
          </View>
        </View>

        <View style={[s.grid, { marginTop: 10 }]}>
          <View style={[s.miniCard, { borderColor: "#8B5CF644" }]}>
            <Feather name="user-check" size={16} color="#8B5CF6" />
            <Text style={s.miniLabel}>Wypłaty wspólników</Text>
            <Text style={[s.miniValue, { color: "#8B5CF6" }]}>−{formatPLN(cash?.payouts_since_last || 0)}</Text>
          </View>
          <View style={[s.miniCard, { borderColor: theme.color.brand + "66", backgroundColor: theme.color.brand + "10" }]}>
            <Feather name="dollar-sign" size={16} color={theme.color.brand} />
            <Text style={s.miniLabel}>Do podziału</Text>
            <Text style={[s.miniValue, { color: theme.color.brand }]}>{formatPLN(cash?.cash_current || 0)}</Text>
          </View>
        </View>

        {/* Last settlement card */}
        {last ? (
          <View style={s.lastCard}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <Feather name="clock" size={13} color={theme.color.onSurfaceSecondary} />
              <Text style={s.sectionTitleSm}>OSTATNIE ROZLICZENIE</Text>
            </View>
            <Text style={s.lastDate}>{fmtDate(last.date)}</Text>
            <View style={s.rowBetween}>
              <Text style={s.rowLabel}>Stan przed</Text>
              <Text style={s.rowVal}>{formatPLN(last.cash_before)}</Text>
            </View>
            {last.payouts?.map((p, i) => (
              <View key={i} style={s.rowBetween}>
                <Text style={[s.rowLabel, { color: "#8B5CF6" }]}>Wypłata · {p.partner_name}</Text>
                <Text style={[s.rowVal, { color: "#8B5CF6" }]}>−{formatPLN(p.amount)}</Text>
              </View>
            ))}
            <View style={s.divider} />
            <View style={s.rowBetween}>
              <Text style={[s.rowLabel, { fontWeight: "800" }]}>Pozostało</Text>
              <Text style={[s.rowVal, { fontWeight: "800", color: theme.color.brand }]}>{formatPLN(last.cash_after)}</Text>
            </View>
            {last.notes ? <Text style={s.lastNotes}>{`„${last.notes}"`}</Text> : null}
          </View>
        ) : (
          <View style={s.lastCard}>
            <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 12, textAlign: "center" }}>
              Brak wcześniejszych rozliczeń. Kliknij poniżej, aby dodać pierwsze.
            </Text>
          </View>
        )}

        {/* Big CTA */}
        <Pressable testID="new-settlement" style={s.ctaBtn} onPress={openModal}>
          <Feather name="plus-circle" size={18} color={theme.color.onBrand} />
          <Text style={s.ctaText}>Nowe rozliczenie wspólników</Text>
        </Pressable>

        {/* History */}
        <View style={{ marginTop: 20, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Feather name="archive" size={14} color={theme.color.onSurface} />
          <Text style={s.sectionTitle}>Historia rozliczeń · {settlements.length}</Text>
        </View>
        {settlements.length === 0 && (
          <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 12, textAlign: "center", padding: 12 }}>
            Historia pusta.
          </Text>
        )}
        {settlements.map(sm => (
          <View key={sm.id} style={s.histCard}>
            <View style={s.rowBetween}>
              <Text style={s.histDate}>{fmtDate(sm.date)}</Text>
              <Text style={s.histBadge}>{sm.payouts.length} wypłat</Text>
            </View>
            <View style={{ marginTop: 6 }}>
              <View style={s.rowBetween}>
                <Text style={s.rowLabel}>Stan przed</Text>
                <Text style={s.rowVal}>{formatPLN(sm.cash_before)}</Text>
              </View>
              {sm.payouts.map((p, i) => (
                <View key={i} style={s.rowBetween}>
                  <Text style={[s.rowLabel, { color: "#8B5CF6" }]}>· {p.partner_name}</Text>
                  <Text style={[s.rowVal, { color: "#8B5CF6" }]}>−{formatPLN(p.amount)}</Text>
                </View>
              ))}
              <View style={s.divider} />
              <View style={s.rowBetween}>
                <Text style={[s.rowLabel, { fontWeight: "800" }]}>Pozostało</Text>
                <Text style={[s.rowVal, { fontWeight: "800", color: theme.color.brand }]}>{formatPLN(sm.cash_after)}</Text>
              </View>
            {sm.notes ? <Text style={s.lastNotes}>{`„${sm.notes}"`}</Text> : null}
              {sm.created_by_name ? (
                <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 10, marginTop: 4 }}>
                  zapisał: {sm.created_by_name}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </ScrollView>

      {/* ---- New settlement modal ---- */}
      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <Pressable style={s.backdrop} onPress={() => setModalOpen(false)} />
          <View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={s.sheetHandle} />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={s.sheetTitle}>Nowe rozliczenie wspólników</Text>
              <Pressable testID="settlement-save" onPress={submit} disabled={saving} style={s.saveBtn}>
                {saving ? <ActivityIndicator size="small" color={theme.color.onBrand} /> : <Text style={s.saveBtnText}>Zatwierdź</Text>}
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 560 }} contentContainerStyle={{ paddingBottom: 12 }}>
              <View style={s.beforeCard}>
                <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 11, letterSpacing: 0.5 }}>STAN PRZED ROZLICZENIEM</Text>
                <Text style={{ color: theme.color.onSurface, fontSize: 22, fontWeight: "800" }}>
                  {formatPLN(cash?.cash_current || 0)}
                </Text>
              </View>

              <Text style={s.editorSubHeader}>Wypłaty</Text>
              {rows.map((r, i) => (
                <View key={i} style={s.editorRow}>
                  <TextInput
                    testID={`row-name-${i}`}
                    style={[s.input, { flex: 2 }]}
                    value={r.name}
                    onChangeText={(v) => setRows(p => p.map((x, ix) => ix === i ? { ...x, name: v } : x))}
                    placeholder="Wspólnik…"
                    placeholderTextColor={theme.color.onSurfaceSecondary}
                  />
                  <TextInput
                    testID={`row-amount-${i}`}
                    style={[s.input, { flex: 1, textAlign: "right" }]}
                    value={r.amount}
                    onChangeText={(v) => setRows(p => p.map((x, ix) => ix === i ? { ...x, amount: v } : x))}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={theme.color.onSurfaceSecondary}
                  />
                  <Pressable testID={`row-del-${i}`} onPress={() => removeRow(i)} hitSlop={8}>
                    <Feather name="x" size={16} color={theme.color.error} />
                  </Pressable>
                </View>
              ))}
              <Pressable testID="add-row" onPress={addRow} style={s.addRowBtn}>
                <Feather name="plus" size={13} color={theme.color.brand} />
                <Text style={{ color: theme.color.brand, fontWeight: "700", fontSize: 12 }}>Dodaj wspólnika</Text>
              </Pressable>

              <View style={s.previewCard}>
                <View style={s.rowBetween}>
                  <Text style={s.rowLabel}>Łączna wypłata</Text>
                  <Text style={[s.rowVal, { color: "#8B5CF6" }]}>−{formatPLN(totalPayout)}</Text>
                </View>
                <View style={s.divider} />
                <View style={s.rowBetween}>
                  <Text style={[s.rowLabel, { fontWeight: "800" }]}>Pozostanie w kasie</Text>
                  <Text style={[s.rowVal, { fontWeight: "800", color: cashAfter >= 0 ? theme.color.brand : theme.color.error }]}>
                    {formatPLN(cashAfter)}
                  </Text>
                </View>
              </View>

              <Text style={[s.editorSubHeader, { marginTop: 10 }]}>Notatka (opcjonalnie)</Text>
              <TextInput
                testID="settlement-notes"
                style={[s.input, { height: 60, textAlignVertical: "top" }]}
                value={notes}
                onChangeText={setNotes}
                placeholder="np. Podział zysku Q2 2026"
                placeholderTextColor={theme.color.onSurfaceSecondary}
                multiline
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  rootLoading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.surface },
  header: { paddingHorizontal: 20, paddingBottom: 8 },
  brand: { color: theme.color.onSurfaceSecondary, letterSpacing: 3, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  title: { color: theme.color.onSurface, fontSize: 24, fontWeight: "700" },
  heroCard: {
    marginTop: 8, borderRadius: 20, padding: 20, alignItems: "center",
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: 1, borderColor: theme.color.brand + "44",
  },
  heroLabel: { color: theme.color.onSurfaceSecondary, letterSpacing: 2, fontSize: 10, fontWeight: "700" },
  heroValue: { fontSize: 34, fontWeight: "800", letterSpacing: -0.5, marginTop: 4 },
  heroSub: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 4 },
  grid: { flexDirection: "row", gap: 10, marginTop: 12 },
  miniCard: {
    flex: 1, borderRadius: 14, padding: 12,
    backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border,
  },
  miniLabel: { color: theme.color.onSurfaceSecondary, fontSize: 10, letterSpacing: 0.5, marginTop: 4, textTransform: "uppercase" },
  miniValue: { fontSize: 18, fontWeight: "800", marginTop: 2 },
  lastCard: {
    marginTop: 14, borderRadius: 14, padding: 14,
    backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border,
  },
  sectionTitle: { color: theme.color.onSurface, fontSize: 14, fontWeight: "700" },
  sectionTitleSm: { color: theme.color.onSurfaceSecondary, fontSize: 11, letterSpacing: 1, fontWeight: "700" },
  lastDate: { color: theme.color.onSurface, fontSize: 15, fontWeight: "800", marginBottom: 8 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  rowLabel: { color: theme.color.onSurface, fontSize: 13 },
  rowVal: { color: theme.color.onSurface, fontSize: 13, fontWeight: "700" },
  divider: { height: 1, backgroundColor: theme.color.divider, marginVertical: 4 },
  lastNotes: { color: theme.color.onSurfaceSecondary, fontSize: 11, fontStyle: "italic", marginTop: 6 },
  ctaBtn: {
    marginTop: 16, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
    backgroundColor: theme.color.brand, paddingVertical: 14, borderRadius: 14,
    shadowColor: theme.color.brand, shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
  ctaText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 15 },
  histCard: {
    marginBottom: 8, borderRadius: 12, padding: 12,
    backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border,
  },
  histDate: { color: theme.color.onSurface, fontWeight: "800", fontSize: 14 },
  histBadge: { color: theme.color.onSurfaceSecondary, fontSize: 11 },
  // ---- Modal ----
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    backgroundColor: theme.color.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12,
  },
  sheetHandle: { alignSelf: "center", width: 36, height: 4, borderRadius: 999, backgroundColor: theme.color.divider, marginBottom: 8 },
  sheetTitle: { color: theme.color.onSurface, fontSize: 18, fontWeight: "800", flex: 1 },
  saveBtn: { backgroundColor: theme.color.brand, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999 },
  saveBtnText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 13 },
  beforeCard: {
    padding: 12, borderRadius: 12, marginTop: 8, marginBottom: 8,
    backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border,
  },
  editorSubHeader: { color: theme.color.onSurfaceSecondary, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginTop: 8, marginBottom: 6 },
  editorRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  input: {
    paddingHorizontal: 10, paddingVertical: 9, borderRadius: 10,
    borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface,
    color: theme.color.onSurface, fontSize: 14,
  },
  addRowBtn: {
    marginTop: 4, alignSelf: "flex-start", flexDirection: "row", gap: 4, alignItems: "center",
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    borderWidth: 1, borderColor: theme.color.brand, backgroundColor: theme.color.brand + "12",
  },
  previewCard: {
    marginTop: 12, padding: 12, borderRadius: 12,
    backgroundColor: theme.color.brand + "10", borderWidth: 1, borderColor: theme.color.brand + "44",
  },
});

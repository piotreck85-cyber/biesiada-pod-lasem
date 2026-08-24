import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, Modal,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, RefreshControl,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatPLN } from "@/src/theme";
import { v2 } from "@/src/designTokensV2";
import { api } from "@/src/api";

type Item = { id: string; date: string; amount: number; description?: string; category?: string; source?: string };

export default function PozostalePrzychody() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r: any = await api.listMiscRevenues();
      setItems(r.items || []);
      setTotal(Number(r.total || 0));
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "Nie udało się załadować");
    }
  }, []);

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);

  const openNew = () => {
    setEditing(null);
    setDate(new Date().toISOString().slice(0, 10));
    setAmount(""); setDescription("");
    setModalOpen(true);
  };
  const openEdit = (it: Item) => {
    setEditing(it);
    setDate(it.date); setAmount(String(it.amount)); setDescription(it.description || "");
    setModalOpen(true);
  };
  const save = async () => {
    const amt = parseFloat(amount.replace(",", "."));
    if (!date || Number.isNaN(amt) || amt <= 0) {
      Alert.alert("Błąd", "Wpisz poprawną datę i kwotę.");
      return;
    }
    setSaving(true);
    try {
      const payload = { date, amount: amt, description: description.trim() };
      if (editing) await api.updateMiscRevenue(editing.id, payload);
      else await api.createMiscRevenue(payload);
      setModalOpen(false);
      await load();
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "Nie udało się");
    } finally { setSaving(false); }
  };
  const del = (it: Item) => {
    Alert.alert("Usunąć?", `${it.description || "przychód"} — ${formatPLN(it.amount)}`, [
      { text: "Anuluj", style: "cancel" },
      { text: "Usuń", style: "destructive", onPress: async () => { try { await api.deleteMiscRevenue(it.id); await load(); } catch (e: any) { Alert.alert("Błąd", e?.message || "Nie udało się"); } } },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: v2.color.bg }}>
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1, marginLeft: 6 }}>
          <Text style={s.brand}>POZOSTAŁE PRZYCHODY</Text>
          <Text style={s.title}>Sprzedaż · wynajem · refundy</Text>
        </View>
        <Pressable onPress={openNew} style={s.addBtn} testID="misc-add-btn">
          <Feather name="plus" size={22} color="#fff" />
        </Pressable>
      </View>

      <View style={s.summaryCard}>
        <Text style={s.summaryLabel}>Suma pozostałych przychodów</Text>
        <Text style={s.summaryValue}>{formatPLN(total)}</Text>
        <Text style={s.summaryHint}>{items.length} pozycji · doliczane do przychodu firmy</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refresh} onRefresh={async () => { setRefresh(true); await load(); setRefresh(false); }} tintColor={v2.color.forest} />}
      >
        {loading ? (
          <View style={{ padding: 40, alignItems: "center" }}>
            <ActivityIndicator color={v2.color.forest} />
          </View>
        ) : items.length === 0 ? (
          <View style={s.empty}>
            <Feather name="gift" size={32} color={v2.color.textSubtle} />
            <Text style={s.emptyText}>Brak pozostałych przychodów</Text>
            <Pressable onPress={openNew} style={s.emptyBtn}>
              <Feather name="plus" size={14} color={v2.color.forest} />
              <Text style={s.emptyBtnText}>Dodaj przychód</Text>
            </Pressable>
          </View>
        ) : items.map(it => (
          <Pressable key={it.id} onPress={() => openEdit(it)} style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowDate}>{it.date}</Text>
              <Text style={s.rowDesc} numberOfLines={2}>{it.description || "—"}</Text>
              {it.source === "whatsapp_zyski" ? (
                <View style={s.tag}><Text style={s.tagText}>📱 WhatsApp</Text></View>
              ) : null}
            </View>
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <Text style={s.amount}>+{formatPLN(it.amount)}</Text>
              <Pressable onPress={() => del(it)} hitSlop={10}>
                <Feather name="trash-2" size={15} color={v2.color.error} />
              </Pressable>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }} onPress={() => setModalOpen(false)} />
          <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={s.grip} />
            <Text style={s.sheetTitle}>{editing ? "Edytuj przychód" : "Nowy przychód"}</Text>
            <Text style={s.label}>Data</Text>
            <TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD"
              placeholderTextColor={v2.color.textSubtle} style={s.input} />
            <Text style={[s.label, { marginTop: 10 }]}>Kwota (zł)</Text>
            <TextInput value={amount} onChangeText={setAmount} placeholder="0"
              placeholderTextColor={v2.color.textSubtle} keyboardType="decimal-pad" style={s.input} />
            <Text style={[s.label, { marginTop: 10 }]}>Opis</Text>
            <TextInput value={description} onChangeText={setDescription}
              placeholder="np. Sprzedaż dmuchańca, wynajem sprzętu"
              placeholderTextColor={v2.color.textSubtle} style={[s.input, { minHeight: 60 }]} multiline />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
              <Pressable onPress={() => setModalOpen(false)} style={[s.secBtn, { flex: 1 }]}>
                <Text style={s.secBtnText}>Anuluj</Text>
              </Pressable>
              <Pressable onPress={save} disabled={saving} style={[s.primaryBtn, { flex: 2, opacity: saving ? 0.6 : 1 }]}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnText}>{editing ? "Zapisz" : "Dodaj"}</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 14, backgroundColor: v2.color.forestDeep, gap: 6 },
  backBtn: { width: 36, height: 36, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  brand: { color: v2.color.moss, letterSpacing: 2, fontSize: 10, fontWeight: "800" },
  title: { color: "#fff", fontSize: 15, fontWeight: "800", marginTop: 2 },
  addBtn: { width: 40, height: 40, borderRadius: 999, backgroundColor: "#14B8A6", alignItems: "center", justifyContent: "center" },
  summaryCard: { margin: 16, marginBottom: 0, padding: 18, borderRadius: v2.radius.xl, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, ...v2.shadow.sm },
  summaryLabel: { color: v2.color.textSubtle, fontSize: 10, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  summaryValue: { color: "#0F766E", fontSize: 26, fontWeight: "800", marginTop: 4, letterSpacing: -0.5 },
  summaryHint: { color: v2.color.textMuted, fontSize: 11, marginTop: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, marginBottom: 8, borderRadius: v2.radius.md, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border },
  rowDate: { color: v2.color.textSubtle, fontSize: 11, fontWeight: "700" },
  rowDesc: { color: v2.color.text, fontSize: 14, fontWeight: "700", marginTop: 3 },
  amount: { color: "#0F766E", fontSize: 15, fontWeight: "800" },
  tag: { alignSelf: "flex-start", marginTop: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: v2.color.mint },
  tagText: { color: v2.color.forest, fontSize: 9, fontWeight: "800" },
  empty: { padding: 40, alignItems: "center", gap: 8 },
  emptyText: { color: v2.color.textMuted, fontSize: 13 },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: v2.radius.md, backgroundColor: v2.color.mint, marginTop: 6 },
  emptyBtnText: { color: v2.color.forest, fontWeight: "800", fontSize: 12 },
  sheet: { backgroundColor: v2.color.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 12, borderWidth: 1, borderColor: v2.color.border },
  grip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: v2.color.borderStrong, marginBottom: 12 },
  sheetTitle: { color: v2.color.text, fontSize: 18, fontWeight: "800", marginBottom: 12 },
  label: { color: v2.color.textSubtle, fontSize: 10, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 },
  input: { backgroundColor: v2.color.bg, borderRadius: v2.radius.md, color: v2.color.text, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15, borderWidth: 1, borderColor: v2.color.border },
  primaryBtn: { paddingVertical: 13, alignItems: "center", borderRadius: v2.radius.md, backgroundColor: v2.color.forest },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  secBtn: { paddingVertical: 13, alignItems: "center", borderRadius: v2.radius.md, borderWidth: 1, borderColor: v2.color.borderStrong, backgroundColor: v2.color.card },
  secBtnText: { color: v2.color.text, fontWeight: "800" },
});

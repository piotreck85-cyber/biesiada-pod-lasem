import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator,
  Alert, RefreshControl, KeyboardAvoidingView, Platform, Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { api } from "@/src/api";
import { theme } from "@/src/theme";

type Template = {
  id: string;
  title: string;
  event_types?: string[] | null;
  order?: number;
};

// Event types available in the app (must match category values used elsewhere)
const EVENT_TYPES: { key: string; label: string; color: string }[] = [
  { key: "firmowe",          label: "Firmowe",          color: theme.color.categoryFirmowe },
  { key: "okolicznosciowe",  label: "Okolicznościowe",  color: theme.color.categoryOkolicznosciowe },
  { key: "urodzinki",        label: "Urodzinki",        color: theme.color.categoryUrodzinki },
  { key: "warsztaty",        label: "Warsztaty",        color: theme.color.categoryWarsztaty },
];

export default function ChecklistTemplatesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Add/Edit modal
  const [editing, setEditing] = useState<Template | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r: any = await api.listChecklistTemplates();
      setItems(Array.isArray(r) ? r : []);
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setEditing(null); setTitle(""); setTypes([]); setModalOpen(true);
  };
  const openEdit = (t: Template) => {
    setEditing(t); setTitle(t.title); setTypes(t.event_types || []); setModalOpen(true);
  };

  const toggleType = (k: string) => {
    setTypes(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]);
  };

  const save = async () => {
    const t = title.trim();
    if (!t) { Alert.alert("Uwaga", "Podaj treść zadania"); return; }
    setSaving(true);
    try {
      if (editing) {
        const r: any = await api.updateChecklistTemplate(editing.id,
          { title: t, event_types: types.length ? types : null, order: editing.order || 0 });
        setItems(list => list.map(x => x.id === editing.id ? r : x));
      } else {
        const nextOrder = items.length ? Math.max(...items.map(x => x.order || 0)) + 1 : 0;
        const r: any = await api.createChecklistTemplate({
          title: t, event_types: types.length ? types : null, order: nextOrder,
        });
        setItems(list => [...list, r].sort((a, b) => (a.order || 0) - (b.order || 0)));
      }
      setModalOpen(false);
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "");
    } finally {
      setSaving(false);
    }
  };

  const remove = (t: Template) => {
    Alert.alert("Usunąć szablon?", `„${t.title}"\n\nJuż utworzone zadania w imprezach pozostaną nietknięte.`, [
      { text: "Anuluj", style: "cancel" },
      { text: "Usuń", style: "destructive", onPress: async () => {
        try {
          await api.deleteChecklistTemplate(t.id);
          setItems(list => list.filter(x => x.id !== t.id));
        } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
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
          <Text style={s.brand}>Ustawienia</Text>
          <Text style={s.title}>Szablony zadań</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.color.brand} />}
      >
        <View style={s.infoBox}>
          <Feather name="info" size={14} color={theme.color.info} />
          <Text style={s.infoText}>
            Szablony są automatycznie dodawane jako zadania do checklisty każdej nowej imprezy pasującej typem.
            Bez oznaczonego typu — szablon dotyczy wszystkich imprez.
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator color={theme.color.brand} style={{ marginTop: 40 }} />
        ) : items.length === 0 ? (
          <View style={s.empty}>
            <Feather name="clipboard" size={40} color={theme.color.onSurfaceSecondary} />
            <Text style={s.emptyTitle}>Brak szablonów</Text>
            <Text style={s.emptyText}>{`Dodaj pierwszy szablon zadania, np. „Rozpalenie grilla" albo „Ustawienie stołów".`}</Text>
          </View>
        ) : (
          items.map(t => (
            <Pressable key={t.id} onPress={() => openEdit(t)} style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle} numberOfLines={2}>{t.title}</Text>
                <View style={s.chipRow}>
                  {(!t.event_types || t.event_types.length === 0) ? (
                    <View style={[s.chip, { backgroundColor: theme.color.divider }]}>
                      <Text style={[s.chipText, { color: theme.color.onSurface }]}>Wszystkie typy</Text>
                    </View>
                  ) : (
                    (t.event_types || []).map(et => {
                      const meta = EVENT_TYPES.find(x => x.key === et);
                      return (
                        <View key={et} style={[s.chip, { backgroundColor: (meta?.color || theme.color.brand) + "22" }]}>
                          <Text style={[s.chipText, { color: meta?.color || theme.color.brand }]}>{meta?.label || et}</Text>
                        </View>
                      );
                    })
                  )}
                </View>
              </View>
              <Pressable onPress={(e) => { e.stopPropagation(); remove(t); }} hitSlop={10} style={s.delBtn}>
                <Feather name="trash-2" size={16} color={theme.color.onSurfaceSecondary} />
              </Pressable>
            </Pressable>
          ))
        )}

        <Pressable onPress={openAdd} style={s.addBtn} testID="add-template-btn">
          <Feather name="plus" size={18} color="#fff" />
          <Text style={s.addBtnText}>Dodaj szablon</Text>
        </Pressable>
      </ScrollView>

      {/* Add / Edit modal */}
      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
            <Pressable style={{ flex: 1 }} onPress={() => setModalOpen(false)} />
            <View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}>
              <View style={s.handle} />
              <Text style={s.sheetTitle}>{editing ? "Edytuj szablon" : "Nowy szablon zadania"}</Text>

              <Text style={s.label}>Treść zadania</Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="np. Rozpalenie grilla"
                placeholderTextColor={theme.color.onSurfaceSecondary}
                style={s.input}
                autoFocus
              />

              <Text style={[s.label, { marginTop: 14 }]}>Zastosuj do typów imprez</Text>
              <Text style={s.hint}>Puste = wszystkie typy</Text>
              <View style={s.typesRow}>
                {EVENT_TYPES.map(et => {
                  const active = types.includes(et.key);
                  return (
                    <Pressable
                      key={et.key}
                      onPress={() => toggleType(et.key)}
                      style={[s.typeChip, active && { backgroundColor: et.color + "22", borderColor: et.color }]}
                    >
                      <Text style={[s.typeChipText, active && { color: et.color }]}>{et.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable onPress={save} disabled={saving || !title.trim()} style={[s.saveBtn, (!title.trim() || saving) && { opacity: 0.5 }]}>
                {saving ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Feather name="check" size={16} color="#fff" />
                    <Text style={s.saveText}>{editing ? "Zapisz zmiany" : "Dodaj szablon"}</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 12, paddingBottom: 12, flexDirection: "row", alignItems: "center", gap: 6 },
  backBtn: { padding: 6, marginTop: 6 },
  brand: { color: theme.color.onSurfaceSecondary, letterSpacing: 3, fontSize: 10, fontWeight: "700", marginBottom: 2 },
  title: { color: theme.color.onSurface, fontSize: 22, fontWeight: "800" },

  infoBox: {
    flexDirection: "row", gap: 8, padding: 12, borderRadius: 12,
    backgroundColor: theme.color.info + "12", borderWidth: 1, borderColor: theme.color.info + "44",
    marginBottom: 16,
  },
  infoText: { flex: 1, color: theme.color.onSurface, fontSize: 12, lineHeight: 17 },

  row: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 14, marginBottom: 8, borderRadius: 12,
    backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border,
  },
  rowTitle: { color: theme.color.onSurface, fontSize: 14, fontWeight: "700" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 6 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  chipText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.4 },
  delBtn: { padding: 6 },

  addBtn: {
    marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    padding: 14, borderRadius: 12, backgroundColor: theme.color.brand,
  },
  addBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },

  empty: { alignItems: "center", padding: 30, gap: 6 },
  emptyTitle: { color: theme.color.onSurface, fontSize: 15, fontWeight: "700", marginTop: 6 },
  emptyText: { color: theme.color.onSurfaceSecondary, fontSize: 12, textAlign: "center", lineHeight: 18, maxWidth: 300 },

  sheet: { backgroundColor: theme.color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.color.border, marginBottom: 12 },
  sheetTitle: { color: theme.color.onSurface, fontSize: 18, fontWeight: "800", marginBottom: 12 },
  label: { color: theme.color.onSurfaceSecondary, fontSize: 11, letterSpacing: 1, fontWeight: "700", marginBottom: 6, textTransform: "uppercase" },
  hint: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginBottom: 8, marginTop: -2 },
  input: {
    backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: theme.color.onSurface, fontSize: 15,
  },
  typesRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary,
  },
  typeChipText: { color: theme.color.onSurface, fontSize: 13, fontWeight: "700" },

  saveBtn: {
    marginTop: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    padding: 14, borderRadius: 12, backgroundColor: theme.color.brand,
  },
  saveText: { color: "#fff", fontWeight: "800", fontSize: 14 },
});

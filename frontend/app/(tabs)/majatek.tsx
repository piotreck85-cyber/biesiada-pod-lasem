import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, TextInput,
  ActivityIndicator, Alert, Platform, Modal, KeyboardAvoidingView, Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { theme, formatPLN } from "@/src/theme";
import { api } from "@/src/api";

type Asset = {
  id: string; name: string; qty: number; value: number;
  photo_base64?: string | null; notes?: string;
};

export default function MajatekScreen() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Asset[]>([]);
  const [totalValue, setTotalValue] = useState(0);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);

  const load = useCallback(async () => {
    try {
      const d: any = await api.assetsList(q);
      setItems(d?.items || []);
      setTotalValue(d?.total_value || 0);
    } catch {}
  }, [q]);
  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);

  const openNew = () => { setEditing({ id: "", name: "", qty: 1, value: 0, photo_base64: null, notes: "" }); setShowEdit(true); };
  const openEdit = (a: Asset) => { setEditing({ ...a }); setShowEdit(true); };
  const closeEdit = () => { setShowEdit(false); setEditing(null); };

  const deleteAsset = (a: Asset) => {
    Alert.alert("Usunąć pozycję?", a.name, [
      { text: "Anuluj", style: "cancel" },
      { text: "Usuń", style: "destructive", onPress: async () => { await api.assetsDelete(a.id); await load(); } },
    ]);
  };

  const stats = useMemo(() => ({
    count: items.length,
    totalUnits: items.reduce((s, a) => s + (a.qty || 0), 0),
    value: totalValue,
  }), [items, totalValue]);

  if (loading) return <View style={s.rootLoading}><ActivityIndicator color={theme.color.brand} /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
          <View>
            <Text style={s.brand}>Majątek firmy</Text>
            <Text style={s.title}>Wyposażenie</Text>
          </View>
          <Pressable onPress={openNew} style={s.primaryBtnSmall} hitSlop={8}>
            <Feather name="plus" size={14} color={theme.color.onBrand} />
            <Text style={s.primaryBtnSmallText}>Dodaj</Text>
          </Pressable>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={theme.color.brand} />}>
        {/* Summary */}
        <View style={s.hero}>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={s.k}>POZYCJI</Text>
              <Text style={[s.v, { color: theme.color.brand }]}>{stats.count}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.k}>ŁĄCZNIE SZTUK</Text>
              <Text style={[s.v, { color: theme.color.brand }]}>{stats.totalUnits.toFixed(0)}</Text>
            </View>
            <View style={{ flex: 1.5 }}>
              <Text style={s.k}>WARTOŚĆ MAJĄTKU</Text>
              <Text style={[s.v, { color: theme.color.brand }]}>{formatPLN(stats.value)}</Text>
            </View>
          </View>
        </View>

        {/* Search */}
        <View style={s.searchWrap}>
          <Feather name="search" size={14} color={theme.color.onSurfaceSecondary} />
          <TextInput
            value={q} onChangeText={setQ}
            placeholder="Szukaj: wkrętarka, kosiarka, głośnik..."
            placeholderTextColor={theme.color.onSurfaceSecondary}
            style={{ flex: 1, color: theme.color.onSurface, fontSize: 13, paddingVertical: 6 }}
          />
          {q ? <Pressable onPress={() => setQ("")} hitSlop={8}><Feather name="x" size={16} color={theme.color.onSurfaceSecondary} /></Pressable> : null}
        </View>

        {items.length === 0 ? (
          <View style={s.emptyCard}>
            <Feather name="package" size={40} color={theme.color.onSurfaceSecondary} />
            <Text style={s.emptyTitle}>{q ? "Nic nie znaleziono" : "Brak pozycji"}</Text>
            <Text style={s.emptyText}>
              {q ? "Zmień frazę wyszukiwania lub" : "Dodaj pierwszą rzecz z majątku firmy —"} użyj przycisku „Dodaj”.
            </Text>
          </View>
        ) : items.map(a => (
          <Pressable key={a.id} onPress={() => openEdit(a)} style={s.itemRow}>
            {a.photo_base64 ? (
              <Image source={{ uri: a.photo_base64.startsWith("data:") ? a.photo_base64 : `data:image/jpeg;base64,${a.photo_base64}` }} style={s.thumb} />
            ) : (
              <View style={[s.thumb, s.thumbPlaceholder]}>
                <Feather name="image" size={20} color={theme.color.onSurfaceSecondary} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={s.itName}>{a.name}</Text>
              <Text style={s.itMeta}>Ilość: {a.qty}  ·  {formatPLN(a.value)} / szt.</Text>
              <Text style={[s.itMeta, { color: theme.color.brand, fontWeight: "700" }]}>
                Wartość: {formatPLN((a.qty || 0) * (a.value || 0))}
              </Text>
              {a.notes ? <Text style={s.itMeta} numberOfLines={1}>{`„${a.notes}”`}</Text> : null}
            </View>
            <Pressable onPress={(e: any) => { e.stopPropagation?.(); deleteAsset(a); }} hitSlop={10} style={{ padding: 6 }}>
              <Feather name="trash-2" size={14} color={theme.color.error} />
            </Pressable>
          </Pressable>
        ))}
      </ScrollView>

      <EditAssetModal
        visible={showEdit}
        initial={editing}
        onClose={closeEdit}
        onSaved={async () => { closeEdit(); await load(); }}
      />
    </View>
  );
}

function EditAssetModal({ visible, initial, onClose, onSaved }: { visible: boolean; initial: Asset | null; onClose: () => void; onSaved: () => void }) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !initial) return;
    setName(initial.name || ""); setQty(String(initial.qty ?? 1));
    setValue(String(initial.value ?? "")); setNotes(initial.notes || "");
    setPhoto(initial.photo_base64 || null);
  }, [visible, initial]);

  const pickFromLibrary = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") { Alert.alert("Brak uprawnień", "Aby wybrać zdjęcie, zezwól aplikacji na dostęp do galerii."); return; }
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.55, base64: true, allowsEditing: true,
      });
      if (!r.canceled && r.assets?.[0]?.base64) {
        setPhoto(`data:image/jpeg;base64,${r.assets[0].base64}`);
      }
    } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
  };
  const takePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") { Alert.alert("Brak uprawnień", "Zezwól aplikacji na dostęp do aparatu, aby zrobić zdjęcie."); return; }
      const r = await ImagePicker.launchCameraAsync({ quality: 0.55, base64: true, allowsEditing: true });
      if (!r.canceled && r.assets?.[0]?.base64) {
        setPhoto(`data:image/jpeg;base64,${r.assets[0].base64}`);
      }
    } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
  };

  const save = async () => {
    if (!name.trim()) { Alert.alert("Brak nazwy", "Wpisz nazwę pozycji"); return; }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        qty: parseFloat(qty.replace(",", ".")) || 0,
        value: parseFloat(value.replace(",", ".")) || 0,
        photo_base64: photo || null,
        notes,
      };
      if (initial && initial.id) await api.assetsUpdate(initial.id, payload);
      else await api.assetsAdd(payload);
      onSaved();
    } catch (e: any) { Alert.alert("Błąd", e?.message || "Nie udało się"); }
    finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={{ backgroundColor: theme.color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: insets.bottom + 20 }}>
            <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.color.border, marginBottom: 12 }} />
            <Text style={s.title}>{initial?.id ? "Edytuj pozycję" : "Nowa pozycja"}</Text>
            <ScrollView style={{ maxHeight: 540 }} keyboardShouldPersistTaps="handled">
              {photo ? (
                <View style={{ position: "relative", marginTop: 10 }}>
                  <Image source={{ uri: photo }} style={{ width: "100%", height: 180, borderRadius: 12 }} />
                  <Pressable onPress={() => setPhoto(null)}
                    style={{ position: "absolute", top: 8, right: 8, backgroundColor: "rgba(0,0,0,0.6)", padding: 8, borderRadius: 999 }}
                    hitSlop={10}>
                    <Feather name="x" size={14} color="#fff" />
                  </Pressable>
                </View>
              ) : null}
              <View style={{ flexDirection: "row", gap: 6, marginTop: 10 }}>
                <Pressable onPress={takePhoto} style={[s.secondaryBtn, { flex: 1 }]}>
                  <Feather name="camera" size={14} color={theme.color.brand} />
                  <Text style={s.secondaryBtnText}>Aparat</Text>
                </Pressable>
                <Pressable onPress={pickFromLibrary} style={[s.secondaryBtn, { flex: 1 }]}>
                  <Feather name="image" size={14} color={theme.color.brand} />
                  <Text style={s.secondaryBtnText}>Z galerii</Text>
                </Pressable>
              </View>
              <Text style={[s.k, { marginTop: 12 }]}>Nazwa</Text>
              <TextInput value={name} onChangeText={setName} placeholder="np. Wkrętarka Bosch"
                placeholderTextColor={theme.color.onSurfaceSecondary} style={s.input} />
              <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.k}>Ilość</Text>
                  <TextInput value={qty} onChangeText={setQty} placeholder="1" keyboardType="decimal-pad"
                    placeholderTextColor={theme.color.onSurfaceSecondary} style={s.input} />
                </View>
                <View style={{ flex: 2 }}>
                  <Text style={s.k}>Wartość jednostkowa (PLN)</Text>
                  <TextInput value={value} onChangeText={setValue} placeholder="0" keyboardType="decimal-pad"
                    placeholderTextColor={theme.color.onSurfaceSecondary} style={s.input} />
                </View>
              </View>
              {qty && value ? (
                <Text style={{ color: theme.color.brand, fontSize: 12, fontWeight: "700", marginTop: 6 }}>
                  Łączna wartość: {formatPLN((parseFloat(qty.replace(",", ".")) || 0) * (parseFloat(value.replace(",", ".")) || 0))}
                </Text>
              ) : null}
              <Text style={[s.k, { marginTop: 8 }]}>Notatka</Text>
              <TextInput value={notes} onChangeText={setNotes} placeholder="np. garaż, do naprawy"
                placeholderTextColor={theme.color.onSurfaceSecondary} multiline style={[s.input, { minHeight: 50 }]} />
            </ScrollView>
            <Pressable onPress={save} disabled={saving || !name.trim()} style={[s.primaryBtn, { marginTop: 12 }, (saving || !name.trim()) && { opacity: 0.5 }]}>
              {saving ? <ActivityIndicator color={theme.color.onBrand} /> : (
                <>
                  <Feather name="check" size={16} color={theme.color.onBrand} />
                  <Text style={s.primaryBtnText}>Zapisz</Text>
                </>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  rootLoading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.surface },
  header: { paddingHorizontal: 20, paddingBottom: 8 },
  brand: { color: theme.color.onSurfaceSecondary, letterSpacing: 3, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  title: { color: theme.color.onSurface, fontSize: 22, fontWeight: "700" },
  primaryBtnSmall: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: theme.color.brand },
  primaryBtnSmallText: { color: theme.color.onBrand, fontWeight: "700", fontSize: 12 },
  hero: { marginTop: 6, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: theme.color.brand + "44", backgroundColor: theme.color.brand + "0A" },
  k: { color: theme.color.onSurfaceSecondary, letterSpacing: 1, fontSize: 10, fontWeight: "700" },
  v: { fontSize: 18, fontWeight: "800", marginTop: 2 },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, marginTop: 10, borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface },
  emptyCard: { alignItems: "center", padding: 30, marginTop: 24, borderRadius: 16, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface, gap: 8 },
  emptyTitle: { color: theme.color.onSurface, fontSize: 16, fontWeight: "700", marginTop: 8 },
  emptyText: { color: theme.color.onSurfaceSecondary, fontSize: 12, textAlign: "center", lineHeight: 18 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface },
  thumb: { width: 56, height: 56, borderRadius: 10, backgroundColor: theme.color.border },
  thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  itName: { color: theme.color.onSurface, fontSize: 14, fontWeight: "700" },
  itMeta: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  input: { paddingHorizontal: 10, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface, color: theme.color.onSurface, fontSize: 13, marginTop: 2 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 12, backgroundColor: theme.color.brand },
  primaryBtnText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 14 },
  secondaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.color.brand, backgroundColor: theme.color.brand + "12" },
  secondaryBtnText: { color: theme.color.brand, fontWeight: "700", fontSize: 12 },
});

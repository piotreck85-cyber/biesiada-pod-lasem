import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, FlatList, TextInput, Modal,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView, Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme, formatPLN, initials } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

export default function Pracownicy() {
  const insets = useSafeAreaInsets();
  const { logout, user, deleteAccount } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [rate, setRate] = useState("");
  const [saving, setSaving] = useState(false);
  const [workspace, setWorkspace] = useState<any>(null);
  const [wsModalOpen, setWsModalOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<"all" | "event" | "staff" | "expense" | "delete">("all");

  const load = useCallback(async () => {
    try {
      const [staff, ws] = await Promise.all([api.listStaff(), api.workspace().catch(() => null)]);
      setItems(staff);
      setWorkspace(ws);
    } catch {}
  }, []);

  const openHistory = useCallback(async () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const rows = await api.history(200);
      setHistory(Array.isArray(rows) ? rows : []);
    } catch (e: any) {
      Alert.alert("Błąd", e.message || "Nie udało się załadować historii");
    } finally {
      setHistoryLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]));

  const openNew = () => { setEditing(null); setName(""); setRole(""); setRate(""); setModalOpen(true); };
  const openEdit = (it: any) => { setEditing(it); setName(it.name); setRole(it.role || ""); setRate(String(it.hourly_rate || "")); setModalOpen(true); };

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const body = { name: name.trim(), role: role.trim(), hourly_rate: parseFloat(rate.replace(",", ".")) || 0 };
      if (editing) await api.updateStaff(editing.id, body);
      else await api.createStaff(body);
      setModalOpen(false);
      await load();
    } catch {} finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    await api.deleteStaff(id);
    await load();
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]} testID="staff-screen">
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.brand}>Pracownicy</Text>
          <Text style={s.title}>Twój zespół</Text>
        </View>
        <Pressable testID="workspace-btn" onPress={() => setWsModalOpen(true)} hitSlop={10} style={[s.logoutBtn, { marginRight: 8 }]}>
          <Feather name="users" size={18} color={theme.color.brand} />
        </Pressable>
        <Pressable testID="history-btn" onPress={openHistory} hitSlop={10} style={[s.logoutBtn, { marginRight: 8 }]}>
          <Feather name="clock" size={18} color={theme.color.brand} />
        </Pressable>
        <Pressable
          testID="delete-account-btn"
          onPress={() => {
            const confirmAndDelete = async () => {
              try { await deleteAccount(); }
              catch (e: any) { Alert.alert("Błąd", e.message || "Nie udało się"); }
            };
            if (Platform.OS === "web") {
              // eslint-disable-next-line no-alert
              if (window.confirm("Usuń konto i wszystkie dane (imprezy, pracowników, szablony)? Ta operacja jest nieodwracalna.")) {
                confirmAndDelete();
              }
            } else {
              Alert.alert(
                "Usuń konto",
                "Ta operacja trwale usunie konto i wszystkie dane (imprezy, pracowników, szablony). Kontynuować?",
                [
                  { text: "Anuluj", style: "cancel" },
                  { text: "Usuń konto", style: "destructive", onPress: confirmAndDelete },
                ]
              );
            }
          }}
          hitSlop={10}
          style={[s.logoutBtn, { marginRight: 8 }]}
        >
          <Feather name="trash-2" size={16} color={theme.color.error} />
        </Pressable>
        <Pressable testID="logout-button" onPress={logout} hitSlop={10} style={s.logoutBtn}>
          <Feather name="log-out" size={18} color={theme.color.onSurfaceSecondary} />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={theme.color.brand} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 120 }}
          ListEmptyComponent={
            <View style={s.emptyBox}>
              <Feather name="users" size={40} color={theme.color.onSurfaceSecondary} />
              <Text style={s.emptyTitle}>Brak pracowników</Text>
              <Text style={s.emptySub}>Dodaj pierwszego pracownika, aby przypisywać go do imprez.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable testID={`staff-row-${item.id}`} style={s.row} onPress={() => openEdit(item)}>
              <View style={s.avatar}><Text style={s.avatarText}>{initials(item.name)}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={s.rowName}>{item.name}</Text>
                <Text style={s.rowRole}>{item.role || "Bez stanowiska"}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={s.rowRate}>{formatPLN(item.hourly_rate)}</Text>
                <Text style={s.rowRateSub}>/godz.</Text>
              </View>
              <Pressable testID={`staff-delete-${item.id}`} onPress={() => remove(item.id)} hitSlop={10} style={{ paddingLeft: 12 }}>
                <Feather name="trash-2" size={18} color={theme.color.onSurfaceSecondary} />
              </Pressable>
            </Pressable>
          )}
        />
      )}

      <Pressable testID="add-staff-btn" style={[s.fab, { bottom: insets.bottom + 80 }]} onPress={openNew}>
        <Feather name="plus" size={24} color={theme.color.onBrand} />
      </Pressable>

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <Pressable style={s.backdrop} onPress={() => setModalOpen(false)} />
          <View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={s.grip} />
            <Text style={s.sheetTitle}>{editing ? "Edytuj pracownika" : "Nowy pracownik"}</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={s.label}>Imię i nazwisko</Text>
              <TextInput testID="staff-name-input" value={name} onChangeText={setName} placeholder="Jan Kowalski" placeholderTextColor={theme.color.onSurfaceSecondary} style={s.input} />
              <Text style={s.label}>Stanowisko</Text>
              <TextInput testID="staff-role-input" value={role} onChangeText={setRole} placeholder="Barman, Kelner..." placeholderTextColor={theme.color.onSurfaceSecondary} style={s.input} />
              <Text style={s.label}>Stawka godzinowa (PLN)</Text>
              <TextInput testID="staff-rate-input" value={rate} onChangeText={setRate} placeholder="50" placeholderTextColor={theme.color.onSurfaceSecondary} keyboardType="decimal-pad" style={s.input} />
              <Pressable testID="staff-save-btn" onPress={save} disabled={saving || !name.trim()} style={[s.saveBtn, (saving || !name.trim()) && { opacity: 0.5 }]}>
                {saving ? <ActivityIndicator color={theme.color.onBrand} /> : <Text style={s.saveBtnText}>Zapisz</Text>}
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={historyOpen} transparent animationType="slide" onRequestClose={() => setHistoryOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setHistoryOpen(false)} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={s.grip} />
          <Text style={s.sheetTitle}>Historia zmian ({history.length})</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
            {([
              { k: "all", label: "Wszystko" },
              { k: "event", label: "Imprezy" },
              { k: "staff", label: "Pracownicy" },
              { k: "expense", label: "Koszty" },
              { k: "delete", label: "Usunięcia" },
            ] as const).map((f) => (
              <Pressable
                key={f.k}
                testID={`history-filter-${f.k}`}
                onPress={() => setHistoryFilter(f.k)}
                style={[s.chip, historyFilter === f.k && s.chipActive]}
              >
                <Text style={[s.chipText, historyFilter === f.k && s.chipTextActive]}>{f.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <ScrollView>
            {historyLoading ? (
              <ActivityIndicator color={theme.color.brand} style={{ marginTop: 20 }} />
            ) : (() => {
              const filtered = history.filter((h) => {
                if (historyFilter === "all") return true;
                if (historyFilter === "delete") return h.action === "delete";
                return h.entity_type === historyFilter;
              });
              if (filtered.length === 0) {
                return (
                  <Text style={{ color: theme.color.onSurfaceSecondary, textAlign: "center", padding: 20 }}>
                    Brak zapisanych zmian
                  </Text>
                );
              }
              return filtered.map((h) => (
                <View key={h.id} style={s.historyRow} testID={`history-${h.id}`}>
                  <View style={[s.historyIcon, {
                    backgroundColor: h.action === "create" ? "rgba(16,185,129,0.15)" : h.action === "delete" ? "rgba(239,68,68,0.15)" : "rgba(212,175,55,0.15)"
                  }]}>
                    <Feather
                      name={h.action === "create" ? "plus" : h.action === "delete" ? "trash-2" : "edit-3"}
                      size={14}
                      color={h.action === "create" ? theme.color.success : h.action === "delete" ? theme.color.error : theme.color.brand}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.historyText}>{h.summary || `${h.action} ${h.entity_type}`}</Text>
                    <Text style={s.historyMeta}>{h.user_name}  ·  {new Date(h.at).toLocaleString("pl-PL")}</Text>
                  </View>
                </View>
              ));
            })()}
            <Pressable
              testID="history-clear-btn"
              onPress={async () => {
                const doClear = async () => {
                  try {
                    await api.clearHistory();
                    setHistory([]);
                  } catch (e: any) { Alert.alert("Błąd", e.message || "Nie udało się"); }
                };
                if (Platform.OS === "web") {
                  if (window.confirm("Wyczyścić całą historię zmian? Ta operacja jest nieodwracalna.")) doClear();
                } else {
                  Alert.alert("Wyczyść historię", "Ta operacja jest nieodwracalna.", [
                    { text: "Anuluj", style: "cancel" },
                    { text: "Wyczyść", style: "destructive", onPress: doClear },
                  ]);
                }
              }}
              style={[s.saveBtn, { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.color.borderStrong }]}
            >
              <Text style={[s.saveBtnText, { color: theme.color.onSurfaceSecondary }]}>Wyczyść historię</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={wsModalOpen} transparent animationType="slide" onRequestClose={() => setWsModalOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <Pressable style={s.backdrop} onPress={() => setWsModalOpen(false)} />
          <View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={s.grip} />
            <Text style={s.sheetTitle}>Zespół (wspólny kalendarz)</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={s.label}>Twój kod zaproszenia</Text>
              <View style={s.codeBox}>
                <Text testID="my-invite-code" style={s.codeText} selectable>{workspace?.invite_code || user?.id || "—"}</Text>
              </View>
              <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 8 }}>
                Podaj ten kod drugiej osobie, aby zobaczyła Twój kalendarz. Możesz też dołączyć do jej zespołu poniżej.
              </Text>
              <Text style={s.label}>Członkowie zespołu ({workspace?.members?.length || 0})</Text>
              {(workspace?.members || []).map((m: any) => (
                <View key={m.id} style={s.memberRow} testID={`member-${m.id}`}>
                  <View style={s.avatar}><Text style={s.avatarText}>{initials(m.name)}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowName}>{m.name}{m.id === user?.id ? " (Ty)" : ""}</Text>
                    <Text style={s.rowRole}>{m.email}</Text>
                  </View>
                </View>
              ))}
              <Text style={s.label}>Dołącz do zespołu (wklej kod)</Text>
              <TextInput
                testID="join-code-input"
                value={joinCode}
                onChangeText={setJoinCode}
                placeholder="Kod dostępu drugiej osoby"
                placeholderTextColor={theme.color.onSurfaceSecondary}
                style={s.input}
                autoCapitalize="none"
              />
              <Pressable
                testID="join-workspace-btn"
                onPress={async () => {
                  if (!joinCode.trim()) return;
                  try {
                    await api.joinWorkspace(joinCode.trim());
                    setJoinCode("");
                    const ws = await api.workspace();
                    setWorkspace(ws);
                    await load();
                    Alert.alert("Sukces", "Dołączono do zespołu. Teraz widzisz wspólny kalendarz.");
                  } catch (e: any) { Alert.alert("Błąd", e.message || "Nie udało się"); }
                }}
                style={s.saveBtn}
              >
                <Text style={s.saveBtnText}>Dołącz</Text>
              </Pressable>
              <Pressable
                testID="leave-workspace-btn"
                onPress={async () => {
                  const doLeave = async () => {
                    try {
                      await api.leaveWorkspace();
                      const ws = await api.workspace();
                      setWorkspace(ws);
                      await load();
                    } catch (e: any) { Alert.alert("Błąd", e.message || "Nie udało się"); }
                  };
                  if (Platform.OS === "web") {
                    if (window.confirm("Opuścić wspólny zespół? Wrócisz do własnego kalendarza.")) doLeave();
                  } else {
                    Alert.alert("Opuść zespół", "Wrócisz do własnego kalendarza.", [
                      { text: "Anuluj", style: "cancel" },
                      { text: "Opuść", style: "destructive", onPress: doLeave },
                    ]);
                  }
                }}
                style={[s.saveBtn, { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.color.borderStrong, marginTop: 8 }]}
              >
                <Text style={[s.saveBtnText, { color: theme.color.onSurfaceSecondary }]}>Opuść wspólny zespół</Text>
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
  header: { paddingHorizontal: 20, paddingBottom: 8, paddingTop: 8, flexDirection: "row", alignItems: "flex-end" },
  brand: { color: theme.color.onSurfaceSecondary, letterSpacing: 3, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  title: { color: theme.color.onSurface, fontSize: 24, fontWeight: "700" },
  logoutBtn: { padding: 8, backgroundColor: theme.color.surfaceSecondary, borderRadius: 999 },
  row: {
    flexDirection: "row", alignItems: "center", padding: 14, backgroundColor: theme.color.surfaceSecondary,
    borderRadius: 16, marginBottom: 8, borderWidth: 1, borderColor: theme.color.border,
  },
  avatar: {
    width: 42, height: 42, borderRadius: 999, backgroundColor: theme.color.brandTertiary,
    alignItems: "center", justifyContent: "center", marginRight: 12,
  },
  avatarText: { color: theme.color.onBrandTertiary, fontWeight: "700", fontSize: 14 },
  rowName: { color: theme.color.onSurface, fontSize: 15, fontWeight: "600" },
  rowRole: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  rowRate: { color: theme.color.brand, fontWeight: "700", fontSize: 15 },
  rowRateSub: { color: theme.color.onSurfaceSecondary, fontSize: 10 },
  emptyBox: { marginTop: 60, alignItems: "center", paddingHorizontal: 40 },
  emptyTitle: { color: theme.color.onSurface, fontSize: 17, fontWeight: "700", marginTop: 16 },
  emptySub: { color: theme.color.onSurfaceSecondary, marginTop: 8, textAlign: "center", lineHeight: 20 },
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
    paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, borderWidth: 1, borderColor: theme.color.border,
  },
  saveBtn: { marginTop: 20, backgroundColor: theme.color.brand, borderRadius: 12, paddingVertical: 15, alignItems: "center" },
  saveBtnText: { color: theme.color.onBrand, fontWeight: "700", fontSize: 16 },
  codeBox: {
    backgroundColor: theme.color.surfaceTertiary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14,
    borderWidth: 1, borderColor: theme.color.brand,
  },
  codeText: { color: theme.color.brand, fontSize: 12, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", letterSpacing: 0.3 },
  memberRow: {
    flexDirection: "row", alignItems: "center", gap: 10, padding: 12, marginBottom: 6,
    backgroundColor: theme.color.surfaceTertiary, borderRadius: 12,
    borderWidth: 1, borderColor: theme.color.border,
  },
  historyRow: {
    flexDirection: "row", alignItems: "center", gap: 10, padding: 10, marginBottom: 6,
    backgroundColor: theme.color.surfaceTertiary, borderRadius: 12,
    borderWidth: 1, borderColor: theme.color.border,
  },
  historyIcon: {
    width: 32, height: 32, borderRadius: 999, alignItems: "center", justifyContent: "center",
  },
  historyText: { color: theme.color.onSurface, fontSize: 13, fontWeight: "600" },
  historyMeta: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    backgroundColor: theme.color.surfaceTertiary,
    borderWidth: 1, borderColor: theme.color.border,
  },
  chipActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  chipText: { color: theme.color.onSurfaceSecondary, fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: theme.color.onBrand },
});

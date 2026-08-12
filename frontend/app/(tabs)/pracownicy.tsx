import { useCallback, useMemo, useState } from "react";
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

// Predefined role palette (Polish role names common for the venue). Any other role
// falls back to a stable hash-based color so it's consistent across renders.
const ROLE_COLORS: Record<string, { bg: string; fg: string }> = {
  "kucharz":       { bg: "#7C2D12", fg: "#FED7AA" },  // deep orange-brown
  "grill":         { bg: "#7C2D12", fg: "#FED7AA" },
  "grillmaster":   { bg: "#7C2D12", fg: "#FED7AA" },
  "kelner":        { bg: "#1E3A8A", fg: "#BFDBFE" },  // deep blue
  "kelnerka":      { bg: "#1E3A8A", fg: "#BFDBFE" },
  "animator":      { bg: "#5B21B6", fg: "#DDD6FE" },  // deep purple
  "animatorka":    { bg: "#5B21B6", fg: "#DDD6FE" },
  "prowadzący":    { bg: "#065F46", fg: "#A7F3D0" },  // deep green
  "prowadzacy":    { bg: "#065F46", fg: "#A7F3D0" },
  "obsługa":       { bg: "#374151", fg: "#E5E7EB" },  // neutral grey
  "obsluga":       { bg: "#374151", fg: "#E5E7EB" },
  "barman":        { bg: "#831843", fg: "#FBCFE8" },  // burgundy
  "sprzątanie":    { bg: "#164E63", fg: "#A5F3FC" },  // teal
  "sprzatanie":    { bg: "#164E63", fg: "#A5F3FC" },
  "opiekun":       { bg: "#78350F", fg: "#FDE68A" },  // amber
  "koordynator":   { bg: "#312E81", fg: "#C7D2FE" },
  "manager":       { bg: "#312E81", fg: "#C7D2FE" },
  "kierownik":     { bg: "#312E81", fg: "#C7D2FE" },
};
const FALLBACK_PALETTE = [
  { bg: "#7C2D12", fg: "#FED7AA" },
  { bg: "#1E3A8A", fg: "#BFDBFE" },
  { bg: "#5B21B6", fg: "#DDD6FE" },
  { bg: "#065F46", fg: "#A7F3D0" },
  { bg: "#831843", fg: "#FBCFE8" },
  { bg: "#164E63", fg: "#A5F3FC" },
  { bg: "#78350F", fg: "#FDE68A" },
  { bg: "#312E81", fg: "#C7D2FE" },
  { bg: "#4C1D95", fg: "#DDD6FE" },
  { bg: "#134E4A", fg: "#99F6E4" },
];
function roleColor(role: string) {
  const key = (role || "").trim().toLowerCase();
  if (!key) return { bg: "#374151", fg: "#9CA3AF" };
  if (ROLE_COLORS[key]) return ROLE_COLORS[key];
  // Stable hash → palette index
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0xffffffff;
  return FALLBACK_PALETTE[Math.abs(h) % FALLBACK_PALETTE.length];
}

type SortKey = "name" | "rate" | "role";
type SortDir = "asc" | "desc";

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

  // ---- Sort + filter state ----
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  const uniqueRoles = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      const r = (it.role || "").trim();
      if (r) set.add(r);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pl"));
  }, [items]);

  const visibleItems = useMemo(() => {
    let arr = [...items];
    // Search by name/role
    const q = search.trim().toLowerCase();
    if (q) {
      arr = arr.filter(x =>
        (x.name || "").toLowerCase().includes(q) ||
        (x.role || "").toLowerCase().includes(q)
      );
    }
    // Filter by role
    if (roleFilter !== "all") {
      arr = arr.filter(x => (x.role || "").trim() === roleFilter);
    }
    // Sort
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = (a.name || "").localeCompare(b.name || "", "pl");
      else if (sortKey === "rate") cmp = (a.hourly_rate || 0) - (b.hourly_rate || 0);
      else if (sortKey === "role") cmp = (a.role || "zzz").localeCompare(b.role || "zzz", "pl");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [items, search, roleFilter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

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
        <>
          {/* Search + Sort + Filter toolbar */}
          <View style={s.toolbar}>
            <View style={s.searchBox}>
              <Feather name="search" size={14} color={theme.color.onSurfaceSecondary} />
              <TextInput
                testID="staff-search"
                value={search}
                onChangeText={setSearch}
                placeholder="Szukaj po imieniu lub stanowisku"
                placeholderTextColor={theme.color.onSurfaceSecondary}
                style={s.searchInput}
              />
              {search.length > 0 && (
                <Pressable onPress={() => setSearch("")} hitSlop={10}>
                  <Feather name="x" size={14} color={theme.color.onSurfaceSecondary} />
                </Pressable>
              )}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: 8 }}>
              {([
                { k: "name", label: "Imię", icon: "user" },
                { k: "role", label: "Stanowisko", icon: "tag" },
                { k: "rate", label: "Stawka", icon: "dollar-sign" },
              ] as const).map(o => {
                const active = sortKey === o.k;
                return (
                  <Pressable
                    key={o.k}
                    testID={`staff-sort-${o.k}`}
                    onPress={() => toggleSort(o.k)}
                    style={[s.sortChip, active && s.sortChipActive]}
                  >
                    <Feather name={o.icon as any} size={11} color={active ? theme.color.onBrand : theme.color.onSurfaceSecondary} />
                    <Text style={[s.sortChipText, active && s.sortChipTextActive]}>{o.label}</Text>
                    {active && (
                      <Feather
                        name={sortDir === "asc" ? "arrow-up" : "arrow-down"}
                        size={11}
                        color={theme.color.onBrand}
                      />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {uniqueRoles.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.roleFilterRow}
            >
              <Pressable
                testID="staff-role-filter-all"
                onPress={() => setRoleFilter("all")}
                style={[s.roleFilterChip, roleFilter === "all" && s.roleFilterChipActive]}
              >
                <Text style={[s.roleFilterText, roleFilter === "all" && s.roleFilterTextActive]}>
                  Wszyscy · {items.length}
                </Text>
              </Pressable>
              {uniqueRoles.map(r => {
                const col = roleColor(r);
                const active = roleFilter === r;
                const count = items.filter(x => (x.role || "").trim() === r).length;
                return (
                  <Pressable
                    key={r}
                    testID={`staff-role-filter-${r}`}
                    onPress={() => setRoleFilter(active ? "all" : r)}
                    style={[
                      s.roleFilterChip,
                      { backgroundColor: active ? col.bg : theme.color.surfaceTertiary, borderColor: active ? col.bg : theme.color.border },
                    ]}
                  >
                    <View style={[s.roleDot, { backgroundColor: col.bg }]} />
                    <Text style={[s.roleFilterText, active && { color: col.fg }]}>{r} · {count}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          <FlatList
            data={visibleItems}
            keyExtractor={(i) => i.id}
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 120 }}
            ListEmptyComponent={
              <View style={s.emptyBox}>
                <Feather name="users" size={40} color={theme.color.onSurfaceSecondary} />
                <Text style={s.emptyTitle}>{items.length === 0 ? "Brak pracowników" : "Brak wyników"}</Text>
                <Text style={s.emptySub}>
                  {items.length === 0
                    ? "Dodaj pierwszego pracownika, aby przypisywać go do imprez."
                    : "Zmień kryteria wyszukiwania lub filtr stanowiska."}
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const col = roleColor(item.role || "");
              return (
                <Pressable testID={`staff-row-${item.id}`} style={s.row} onPress={() => openEdit(item)}>
                  <View style={[s.avatar, { backgroundColor: col.bg }]}>
                    <Text style={[s.avatarText, { color: col.fg }]}>{initials(item.name)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowName}>{item.name}</Text>
                    {item.role ? (
                      <View style={[s.roleBadge, { backgroundColor: col.bg }]}>
                        <Text style={[s.roleBadgeText, { color: col.fg }]}>{item.role}</Text>
                      </View>
                    ) : (
                      <Text style={s.rowRole}>Bez stanowiska</Text>
                    )}
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={s.rowRate}>{formatPLN(item.hourly_rate)}</Text>
                    <Text style={s.rowRateSub}>/godz.</Text>
                  </View>
                  <Pressable testID={`staff-delete-${item.id}`} onPress={() => remove(item.id)} hitSlop={10} style={{ paddingLeft: 12 }}>
                    <Feather name="trash-2" size={18} color={theme.color.onSurfaceSecondary} />
                  </Pressable>
                </Pressable>
              );
            }}
          />
        </>
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

  // ---- Toolbar (search + sort chips) ----
  toolbar: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8, gap: 10 },
  searchBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: theme.color.surfaceTertiary,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: theme.color.border,
  },
  searchInput: { flex: 1, color: theme.color.onSurface, fontSize: 14, padding: 0 },
  sortChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    backgroundColor: theme.color.surfaceTertiary,
    borderWidth: 1, borderColor: theme.color.border,
  },
  sortChipActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  sortChipText: { color: theme.color.onSurfaceSecondary, fontSize: 12, fontWeight: "700" },
  sortChipTextActive: { color: theme.color.onBrand },

  // ---- Role filter row ----
  roleFilterRow: { paddingHorizontal: 20, gap: 6, paddingBottom: 10 },
  roleFilterChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    backgroundColor: theme.color.surfaceTertiary,
    borderWidth: 1, borderColor: theme.color.border,
  },
  roleFilterChipActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  roleFilterText: { color: theme.color.onSurfaceSecondary, fontSize: 12, fontWeight: "600" },
  roleFilterTextActive: { color: theme.color.onBrand },
  roleDot: { width: 8, height: 8, borderRadius: 4 },

  // ---- Role badge (in each row) ----
  roleBadge: {
    alignSelf: "flex-start", marginTop: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  roleBadgeText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },
});

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, FlatList, TextInput, Modal,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView, Alert, StatusBar,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme, formatPLN, initials } from "@/src/theme";
import { v2 } from "@/src/designTokensV2";
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
  const router = useRouter();
  const { logout, user, deleteAccount } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [rate, setRate] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginPerms, setLoginPerms] = useState<Record<string, boolean>>({
    schedule: true, attendance: true, checklist: true, shopping: true, stock: true,
  });
  const [saving, setSaving] = useState(false);
  const [invite, setInvite] = useState<any | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [workspace, setWorkspace] = useState<any>(null);
  const [wsModalOpen, setWsModalOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<"all" | "event" | "staff" | "expense" | "delete">("all");

  // ---- Sort + filter state ----
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  // ---- Wages view ----
  const [mode, setMode] = useState<"list" | "wages">("list");
  // Payroll (weekly settlement based on clocked time_entries)
  const mondayIso = (d: Date) => {
    const day = d.getDay() || 7;
    const monday = new Date(d); monday.setDate(d.getDate() - day + 1);
    return monday.toISOString().slice(0, 10);
  };
  const sundayIso = (d: Date) => {
    const day = d.getDay() || 7;
    const sun = new Date(d); sun.setDate(d.getDate() + (7 - day));
    return sun.toISOString().slice(0, 10);
  };
  const [payrollOpen, setPayrollOpen] = useState(false);
  const [payrollFrom, setPayrollFrom] = useState<string>(mondayIso(new Date()));
  const [payrollTo, setPayrollTo]     = useState<string>(sundayIso(new Date()));
  const [payrollData, setPayrollData] = useState<any | null>(null);
  const [payrollLoading, setPayrollLoading] = useState(false);
  const [payrollMarking, setPayrollMarking] = useState(false);
  const loadPayroll = useCallback(async () => {
    setPayrollLoading(true);
    try { const r: any = await api.payrollSummary({ date_from: payrollFrom, date_to: payrollTo, unpaid_only: true }); setPayrollData(r || null); }
    catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
    finally { setPayrollLoading(false); }
  }, [payrollFrom, payrollTo]);
  useEffect(() => { if (payrollOpen) loadPayroll(); }, [payrollOpen, loadPayroll]);
  const doMarkPaid = async () => {
    if (!payrollData?.staff?.length) return;
    Alert.alert(
      "Oznaczyć jako wypłacone?",
      `${payrollFrom} — ${payrollTo}\nŁącznie do wypłaty: ${formatPLN(payrollData.total || 0)}\n\nZostanie automatycznie zaksięgowany koszt firmowy w kategorii „Wypłaty pracowników”.`,
      [
        { text: "Anuluj", style: "cancel" },
        { text: "Rozlicz", onPress: async () => {
          setPayrollMarking(true);
          try {
            const r: any = await api.payrollMarkPaid({ date_from: payrollFrom, date_to: payrollTo, create_expense: true });
            Alert.alert("Rozliczono ✓", `${r.affected} wpisów · ${formatPLN(r.total)} · ${r.expenses_created} kosztów.`);
            await loadPayroll();
          } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
          finally { setPayrollMarking(false); }
        }},
      ],
    );
  };
  const now = new Date();
  const [wagesYear, setWagesYear] = useState(now.getFullYear());
  const [wagesMonth, setWagesMonth] = useState(now.getMonth());  // 0-indexed
  const [wagesData, setWagesData] = useState<any | null>(null);
  const [wagesLoading, setWagesLoading] = useState(false);

  const loadWages = useCallback(async () => {
    setWagesLoading(true);
    try {
      const res: any = await api.wages(wagesYear, wagesMonth + 1);
      setWagesData(res);
    } catch {} finally { setWagesLoading(false); }
  }, [wagesYear, wagesMonth]);

  const wagesPrev = () => {
    if (wagesMonth === 0) { setWagesMonth(11); setWagesYear(wagesYear - 1); }
    else setWagesMonth(wagesMonth - 1);
  };
  const wagesNext = () => {
    if (wagesMonth === 11) { setWagesMonth(0); setWagesYear(wagesYear + 1); }
    else setWagesMonth(wagesMonth + 1);
  };
  // Reload wages when the view is active or its filters change
  useFocusEffect(useCallback(() => {
    if (mode === "wages") { loadWages(); }
  }, [mode, loadWages]));

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

  // Reload wages when year/month changes while in wages mode
  useEffect(() => { if (mode === "wages") { loadWages(); } }, [wagesYear, wagesMonth, mode, loadWages]);

  const openNew = () => {
    setEditing(null); setName(""); setRole(""); setRate("");
    setLoginEmail(""); setLoginPassword("");
    setLoginPerms({
      schedule: true, attendance: true, checklist: true, shopping: true, stock: true,
      calendar_view: false, event_status: false, event_create: false, event_org_edit: false,
      send_thanks: false, discounts: false, offer_prices: false, finances: false,
    });
    setModalOpen(true);
  };
  const openEdit = useCallback((it: any) => {
    setEditing(it); setName(it.name); setRole(it.role || ""); setRate(String(it.hourly_rate || ""));
    setLoginEmail(it.login_email || ""); setLoginPassword("");
    // Merge existing permissions with defaults (base: ON, modules & sensitive: OFF)
    const p = it.permissions || {};
    setLoginPerms({
      schedule:   p.schedule   !== false,
      attendance: p.attendance !== false,
      checklist:  p.checklist  !== false,
      shopping:   p.shopping   !== false,
      stock:      p.stock      !== false,
      calendar_view:  p.calendar_view  === true,
      event_status:   p.event_status   === true,
      event_create:   p.event_create   === true,
      event_org_edit: p.event_org_edit === true,
      send_thanks:    p.send_thanks    === true,
      discounts:      p.discounts      === true,
      offer_prices:   p.offer_prices   === true,
      finances:       p.finances       === true,
    });
    setModalOpen(true);
  }, []);

  // ---- Staff email invitations ----
  useEffect(() => {
    if (modalOpen && editing?.id) {
      setInvite(null);
      api.staffInviteGet(editing.id).then((r: any) => setInvite(r?.invitation || null)).catch(() => {});
    } else if (!modalOpen) {
      setInvite(null);
    }
  }, [modalOpen, editing?.id]);

  const inviteStatus =
    editing && !editing.login_email && invite && (invite.status === "pending" || invite.status === "expired")
      ? invite.status
      : null;

  const fmtInviteDate = (iso?: string) => {
    try { return iso ? new Date(iso).toLocaleDateString("pl-PL", { day: "numeric", month: "long" }) : ""; }
    catch { return ""; }
  };

  const sendInvite = async (resend: boolean) => {
    if (!editing?.id) return;
    const em = loginEmail.trim().toLowerCase();
    if (!resend && (!em || !em.includes("@"))) { Alert.alert("Błąd", "Podaj adres e-mail pracownika"); return; }
    setInviteBusy(true);
    try {
      const r: any = resend
        ? await api.staffInviteResend(editing.id)
        : await api.staffInviteSend(editing.id, { email: em, permissions: loginPerms });
      setInvite(r?.invitation || null);
      Alert.alert("Wysłano ✉️", `Zaproszenie wysłane na ${r?.invitation?.email || em}. Link jest ważny 7 dni.`);
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "Nie udało się wysłać zaproszenia");
    } finally {
      setInviteBusy(false);
    }
  };

  const cancelInvite = async () => {
    if (!editing?.id) return;
    const doCancel = async () => {
      try {
        const r: any = await api.staffInviteCancel(editing.id);
        setInvite(r?.invitation || null);
      } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
    };
    if (Platform.OS === "web") {
      if (window.confirm("Anulować zaproszenie? Link z e-maila przestanie działać.")) doCancel();
    } else {
      Alert.alert("Anulować zaproszenie?", "Link z e-maila przestanie działać.", [
        { text: "Nie", style: "cancel" },
        { text: "Anuluj zaproszenie", style: "destructive", onPress: doCancel },
      ]);
    }
  };

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

  const remove = useCallback(async (id: string) => {
    await api.deleteStaff(id);
    await load();
  }, [load]);

  // Memoized renderers for FlatLists (perf: avoid recreating fns on every render)
  const renderStaffItem = useCallback(({ item }: { item: any }) => {
    const col = roleColor(item.role || "");
    const isPartner = item.staff_type === "partner";
    return (
      <Pressable testID={`staff-row-${item.id}`} style={s.row} onPress={() => openEdit(item)}>
        <View style={[s.avatar, { backgroundColor: isPartner ? theme.color.brand + "22" : col.bg }]}>
          <Text style={[s.avatarText, { color: isPartner ? theme.color.brand : col.fg }]}>{initials(item.name)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
            <Text style={s.rowName}>{item.name}</Text>
            {isPartner && (
              <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: theme.color.brand + "22" }}>
                <Text style={{ color: theme.color.brand, fontSize: 9, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase" }}>Wspólnik</Text>
              </View>
            )}
          </View>
          {item.role ? (
            <View style={[s.roleBadge, { backgroundColor: col.bg, marginTop: 3 }]}>
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
  }, [openEdit, remove]);

  const staffKeyExtractor = useCallback((i: any) => i.id, []);

  return (
    <View style={[s.root, { paddingTop: insets.top }]} testID="staff-screen">
      <StatusBar barStyle="light-content" />
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.brand}>ZESPÓŁ</Text>
          <Text style={s.title}>Twój zespół</Text>
        </View>
        <Pressable testID="workspace-btn" onPress={() => setWsModalOpen(true)} hitSlop={10} style={s.headerIcon}>
          <Feather name="users" size={16} color="#fff" />
        </Pressable>
        <Pressable testID="history-btn" onPress={openHistory} hitSlop={10} style={s.headerIcon}>
          <Feather name="clock" size={16} color="#fff" />
        </Pressable>
        <Pressable testID="header-menu-btn" onPress={() => setMenuOpen(true)} hitSlop={10} style={s.headerIcon}>
          <Feather name="more-vertical" size={16} color="#fff" />
        </Pressable>
      </View>

      {/* Header dropdown menu */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={s.menuBackdrop} onPress={() => setMenuOpen(false)}>
          <View style={[s.menuCard, { top: insets.top + 60 }]}>
            <Pressable
              testID="menu-logout-btn"
              onPress={() => { setMenuOpen(false); logout(); }}
              style={s.menuItem}
            >
              <Feather name="log-out" size={16} color={theme.color.onSurface} />
              <Text style={s.menuItemText}>Wyloguj</Text>
            </Pressable>
            <View style={s.menuDivider} />
            <Pressable
              testID="menu-delete-account-btn"
              onPress={() => {
                setMenuOpen(false);
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
              style={s.menuItem}
            >
              <Feather name="trash-2" size={16} color={theme.color.error} />
              <Text style={[s.menuItemText, { color: theme.color.error }]}>Usuń konto</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {loading ? (
        <ActivityIndicator color={theme.color.brand} style={{ marginTop: 40 }} />
      ) : (
        <>
          {/* Mode toggle: Lista | Wypłaty */}
          <View style={s.modeRow}>
            <Pressable
              testID="staff-mode-list"
              onPress={() => setMode("list")}
              style={[s.modeBtn, mode === "list" && s.modeBtnActive]}
            >
              <Feather name="users" size={14} color={mode === "list" ? "#FFFFFF" : theme.color.onSurface} />
              <Text style={[s.modeBtnText, mode === "list" && { color: "#FFFFFF" }]}>Lista</Text>
            </Pressable>
            <Pressable
              testID="staff-mode-wages"
              onPress={() => setMode("wages")}
              style={[s.modeBtn, mode === "wages" && s.modeBtnActive]}
            >
              <Feather name="dollar-sign" size={14} color={mode === "wages" ? "#FFFFFF" : theme.color.onSurface} />
              <Text style={[s.modeBtnText, mode === "wages" && { color: "#FFFFFF" }]}>Wypłaty</Text>
            </Pressable>
          </View>

          {/* Szybkie linki zespołu: grafik, czas pracy, dostępność */}
          <View style={s.quickLinksRow}>
            <Pressable testID="team-link-grafik" onPress={() => router.push("/grafik-pracownikow" as any)} style={s.quickLink}>
              <Feather name="calendar" size={15} color={theme.color.brand} />
              <Text style={s.quickLinkText}>Grafik</Text>
            </Pressable>
            <Pressable testID="team-link-czas" onPress={() => router.push("/czas-zespolu" as any)} style={s.quickLink}>
              <Feather name="clock" size={15} color={theme.color.brand} />
              <Text style={s.quickLinkText}>Czas pracy</Text>
            </Pressable>
            <Pressable testID="team-link-dostepnosc" onPress={() => router.push("/dostepnosc-zespolu" as any)} style={s.quickLink}>
              <Feather name="user-check" size={15} color={theme.color.brand} />
              <Text style={s.quickLinkText}>Dostępność</Text>
            </Pressable>
          </View>

          {mode === "wages" ? (
            <View style={{ flex: 1, paddingHorizontal: 20 }}>
              <View style={s.wagesHeader}>
                <Pressable testID="wages-prev" onPress={wagesPrev} hitSlop={10} style={s.navBtnSm}>
                  <Feather name="chevron-left" size={18} color={theme.color.onSurface} />
                </Pressable>
                <Text style={s.wagesMonthTitle}>Miesiąc: {String(wagesMonth + 1).padStart(2, "0")}.{wagesYear}</Text>
                <Pressable testID="wages-next" onPress={wagesNext} hitSlop={10} style={s.navBtnSm}>
                  <Feather name="chevron-right" size={18} color={theme.color.onSurface} />
                </Pressable>
              </View>

              {wagesLoading ? (
                <ActivityIndicator color={theme.color.brand} style={{ marginTop: 30 }} />
              ) : (
                <>
                  <View style={s.wagesSumCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.wagesSumLabel}>Suma miesiąca — godziny × stawka</Text>
                      <Text style={s.wagesSumValue}>{formatPLN(wagesData?.total_amount || 0)}</Text>
                      <Text style={s.wagesSumSub}>{Number(wagesData?.total_hours || 0).toFixed(1)} godz. łącznie · {wagesData?.staff?.length || 0} osób</Text>
                    </View>
                    <Feather name="dollar-sign" size={22} color={theme.color.brand} />
                  </View>
                  <Pressable onPress={() => setPayrollOpen(true)} style={s.payrollBtn}>
                    <Feather name="check-circle" size={16} color={theme.color.brand} />
                    <Text style={s.payrollBtnText}>Rozlicz tygodniówkę (zapisane godziny)</Text>
                    <Feather name="chevron-right" size={16} color={theme.color.brand} />
                  </Pressable>
                  <FlatList
                    data={wagesData?.staff || []}
                    keyExtractor={(w) => w.staff_id}
                    contentContainerStyle={{ paddingTop: 4, paddingBottom: 140 }}
                    initialNumToRender={10}
                    maxToRenderPerBatch={8}
                    windowSize={5}
                    removeClippedSubviews
                    ListEmptyComponent={
                      <View style={s.emptyBox}>
                        <Feather name="clock" size={40} color={theme.color.onSurfaceSecondary} />
                        <Text style={s.emptyTitle}>Brak zmian w tym miesiącu</Text>
                        <Text style={s.emptySub}>Przydziel pracowników do imprez, żeby zobaczyć ich godziny i zarobki.</Text>
                      </View>
                    }
                    renderItem={({ item }) => {
                      const col = roleColor(item.role || "");
                      return (
                        <View style={s.wageRow} testID={`wage-row-${item.staff_id}`}>
                          <View style={[s.avatar, { backgroundColor: col.bg }]}>
                            <Text style={[s.avatarText, { color: col.fg }]}>{initials(item.name)}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={s.rowName}>{item.name}</Text>
                            <View style={{ flexDirection: "row", gap: 6, alignItems: "center", marginTop: 3 }}>
                              {item.role ? (
                                <View style={[s.roleBadge, { backgroundColor: col.bg }]}>
                                  <Text style={[s.roleBadgeText, { color: col.fg }]}>{item.role}</Text>
                                </View>
                              ) : null}
                              <Text style={s.wageMeta}>{item.shifts} zmian · {formatPLN(item.hourly_rate)}/h</Text>
                            </View>
                          </View>
                          <View style={{ alignItems: "flex-end" }}>
                            <Text style={s.wageAmt}>{formatPLN(item.amount)}</Text>
                            <Text style={s.wageHours}>{Number(item.hours).toFixed(1)} godz.</Text>
                          </View>
                        </View>
                      );
                    }}
                  />
                </>
              )}
            </View>
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
            keyExtractor={staffKeyExtractor}
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 120 }}
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            windowSize={7}
            removeClippedSubviews
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
            renderItem={renderStaffItem}
          />
          </>
          )}
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
              {editing ? (
                <>
                  {/* Rola systemowa: Pracownik vs Wspólnik (Faza 4A) */}
                  <Text style={[s.label, { marginTop: 14 }]}>ROLA</Text>
                  <View style={{ flexDirection: "row", gap: 6, marginBottom: 4 }}>
                    {[
                      { k: "employee", l: "Pracownik", desc: "godzinowe wypłaty jako koszt firmy" },
                      { k: "partner",  l: "Wspólnik",  desc: "wypłaty osobno, nie są kosztem" },
                    ].map(opt => {
                      const active = (editing.staff_type || "employee") === opt.k;
                      return (
                        <Pressable
                          key={opt.k}
                          testID={`staff-type-${opt.k}`}
                          onPress={async () => {
                            if (active) return;
                            try {
                              await api.updateStaffType(editing.id, opt.k as any);
                              await load();
                              Alert.alert(
                                opt.k === "partner" ? "✓ Ustawiono jako Wspólnika" : "✓ Ustawiono jako Pracownika",
                                opt.k === "partner"
                                  ? `Wypłaty ${editing.name} są teraz rejestrowane w sekcji Rozliczenia wspólników i NIE wchodzą do kosztów firmy.`
                                  : `Wypłaty ${editing.name} będą traktowane jako zwykły koszt firmy.`
                              );
                            } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
                          }}
                          style={[
                            { flex: 1, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary, alignItems: "center" },
                            active && { borderColor: theme.color.brand, backgroundColor: theme.color.brand + "22" },
                          ]}
                        >
                          <Text style={{ color: active ? theme.color.brand : theme.color.onSurface, fontSize: 13, fontWeight: "800" }}>{opt.l}</Text>
                          <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 10, textAlign: "center", marginTop: 2 }}>{opt.desc}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={[s.label, { marginTop: 14 }]}>KONTO PRACOWNIKA (login)</Text>
                  {editing.login_email ? (
                    <View style={{ padding: 10, marginBottom: 6, borderRadius: 10, backgroundColor: theme.color.brand + "12", borderWidth: 1, borderColor: theme.color.brand + "44" }}>
                      <Text style={{ color: theme.color.onSurface, fontSize: 12, fontWeight: "700" }}>✓ Aktywne konto · {editing.login_email}</Text>
                      <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 }}>Pracownik może się już zalogować.</Text>
                    </View>
                  ) : inviteStatus ? (
                    <View style={{
                      padding: 10, marginBottom: 6, borderRadius: 10,
                      backgroundColor: inviteStatus === "pending" ? "#1D4ED822" : "#B4530922",
                      borderWidth: 1, borderColor: inviteStatus === "pending" ? "#3B82F666" : "#F59E0B66",
                    }}>
                      <Text style={{ color: theme.color.onSurface, fontSize: 12, fontWeight: "700" }}>
                        {inviteStatus === "pending" ? "✉️ Zaproszenie wysłane" : "⏰ Zaproszenie wygasło"} · {invite.email}
                      </Text>
                      <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 }}>
                        {inviteStatus === "pending"
                          ? `Ważne do ${fmtInviteDate(invite.expires_at)}. Pracownik ustawi hasło po kliknięciu linku z e-maila.`
                          : "Wyślij zaproszenie ponownie, aby wygenerować nowy link."}
                      </Text>
                      <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
                        <Pressable
                          testID="invite-resend-btn"
                          disabled={inviteBusy}
                          onPress={() => sendInvite(true)}
                          style={{ flex: 1, paddingVertical: 9, borderRadius: 8, backgroundColor: theme.color.brand, alignItems: "center", opacity: inviteBusy ? 0.5 : 1 }}
                        >
                          {inviteBusy
                            ? <ActivityIndicator size="small" color={theme.color.onBrand} />
                            : <Text style={{ color: theme.color.onBrand, fontSize: 12, fontWeight: "800" }}>Wyślij ponownie</Text>}
                        </Pressable>
                        <Pressable
                          testID="invite-cancel-btn"
                          disabled={inviteBusy}
                          onPress={cancelInvite}
                          style={{ paddingVertical: 9, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: theme.color.error, alignItems: "center", justifyContent: "center" }}
                        >
                          <Text style={{ color: theme.color.error, fontSize: 12, fontWeight: "800" }}>Anuluj</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 11, marginBottom: 6 }}>Status: Nie zaproszony — ten pracownik nie ma jeszcze konta.</Text>
                  )}
                  <TextInput
                    value={loginEmail}
                    onChangeText={setLoginEmail}
                    placeholder="email pracownika"
                    placeholderTextColor={theme.color.onSurfaceSecondary}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    style={s.input}
                  />
                  <TextInput
                    value={loginPassword}
                    onChangeText={setLoginPassword}
                    placeholder={editing.login_email ? "nowe hasło (opcjonalnie)" : "hasło (min 6 znaków)"}
                    placeholderTextColor={theme.color.onSurfaceSecondary}
                    autoCapitalize="none"
                    secureTextEntry
                    style={s.input}
                  />

                  {/* Uprawnienia */}
                  <Text style={[s.label, { marginTop: 12 }]}>UPRAWNIENIA PRACOWNIKA</Text>
                  <View style={{ gap: 6, marginBottom: 8 }}>
                    {([
                      ["schedule",   "Mój grafik",       "Widzi swój grafik pracy"],
                      ["attendance", "Obecność",         "Start/stop pracy, historia godzin"],
                      ["checklist",  "Checklisty",       "Odhacza zadania na imprezie"],
                      ["shopping",   "Zakupy",           "Widzi listę zakupów"],
                      ["stock",      "Magazyn",          "Widzi stan magazynu"],
                      ["__sep1", "MODUŁY DODATKOWE (domyślnie wyłączone)", ""],
                      ["calendar_view",  "Wgląd do kalendarza",     "Widzi pełny kalendarz imprez (bez cen i finansów)"],
                      ["event_status",   "Zmiana statusu imprezy",  "Może zmieniać status i ważność zapytania"],
                      ["event_create",   "Dodawanie imprez",        "Może dodawać nowe imprezy i edytować dane podstawowe"],
                      ["event_org_edit", "Edycja organizacji",      "Może edytować dane organizacyjne imprezy"],
                      ["send_thanks",    "Wysyłanie podziękowań",   "Może wysłać e-mail z podziękowaniem po imprezie"],
                      ["discounts",      "Nadawanie rabatów",       "Może generować i stosować kody rabatowe"],
                      ["__sep2", "DANE WRAŻLIWE — zawsze osobno, domyślnie OFF", ""],
                      ["offer_prices",   "Ceny ofert 🔒",           "Widzi i zmienia ceny pakietów, ofert i cenę imprezy"],
                      ["finances",       "Finanse 🔒",              "Koszty, zysk, marża, wpłaty, stawki — pełny wgląd"],
                    ] as const).map(([k, label, desc]) =>
                      k.startsWith("__sep") ? (
                        <Text key={k} style={{ color: k === "__sep2" ? theme.color.error : theme.color.onSurfaceSecondary, fontSize: 10, fontWeight: "800", letterSpacing: 0.5, marginTop: 8 }}>
                          {label}
                        </Text>
                      ) : (
                      <Pressable
                        key={k}
                        onPress={() => setLoginPerms({ ...loginPerms, [k]: !loginPerms[k] })}
                        style={{
                          flexDirection: "row", alignItems: "center", gap: 10,
                          paddingHorizontal: 12, paddingVertical: 10,
                          borderRadius: 10, borderWidth: 1,
                          borderColor: loginPerms[k] ? theme.color.brand : theme.color.border,
                          backgroundColor: loginPerms[k] ? theme.color.brand + "12" : theme.color.surface,
                        }}
                      >
                        <View style={{
                          width: 20, height: 20, borderRadius: 4, borderWidth: 2,
                          borderColor: loginPerms[k] ? theme.color.brand : theme.color.borderStrong,
                          backgroundColor: loginPerms[k] ? theme.color.brand : "transparent",
                          alignItems: "center", justifyContent: "center",
                        }}>
                          {loginPerms[k] ? <Feather name="check" size={13} color={theme.color.onBrand} /> : null}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.color.onSurface, fontSize: 13, fontWeight: "800" }}>{label}</Text>
                          <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 11 }}>{desc}</Text>
                        </View>
                      </Pressable>
                    ))}
                  </View>

                  {!editing.login_email && !inviteStatus ? (
                    <>
                      <Pressable
                        testID="invite-send-btn"
                        disabled={inviteBusy}
                        onPress={() => sendInvite(false)}
                        style={[s.saveBtn, { marginTop: 4 }, inviteBusy && { opacity: 0.5 }]}
                      >
                        {inviteBusy ? <ActivityIndicator color={theme.color.onBrand} /> : <Text style={s.saveBtnText}>✉️ Wyślij zaproszenie e-mailem</Text>}
                      </Pressable>
                      <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 10, textAlign: "center", marginVertical: 6 }}>
                        Pracownik sam ustawi swoje hasło (link ważny 7 dni) · lub utwórz login ręcznie:
                      </Text>
                    </>
                  ) : null}
                  <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
                    <Pressable
                      onPress={async () => {
                        if (!loginEmail.trim() || !loginEmail.includes("@")) { Alert.alert("Błąd", "Podaj email"); return; }
                        if (!editing.login_email && (loginPassword || "").length < 6) { Alert.alert("Błąd", "Hasło min. 6 znaków"); return; }
                        try {
                          await api.staffCreateLogin(editing.id, {
                            email: loginEmail.trim(),
                            password: loginPassword || undefined,
                            permissions: loginPerms,
                          });
                          Alert.alert("Zapisano", `${editing.name} może się teraz zalogować mailem ${loginEmail}.`);
                          setLoginPassword("");
                          await load();
                        } catch (e: any) { Alert.alert("Błąd", e?.message || "Nie udało się"); }
                      }}
                      style={[s.saveBtn, { flex: 1, paddingHorizontal: 10 }]}
                    >
                      <Text style={s.saveBtnText}>{editing.login_email ? "Aktualizuj login + uprawnienia" : "Utwórz login"}</Text>
                    </Pressable>
                    {editing.login_email ? (
                      <Pressable
                        onPress={() => {
                          Alert.alert("Usunąć konto?", `Pracownik ${editing.name} straci dostęp.`, [
                            { text: "Anuluj", style: "cancel" },
                            { text: "Usuń", style: "destructive", onPress: async () => {
                              try { await api.staffDeleteLogin(editing.id); await load(); Alert.alert("OK", "Login usunięty"); }
                              catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
                            }},
                          ]);
                        }}
                        style={{ paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.color.error }}
                      >
                        <Feather name="user-x" size={16} color={theme.color.error} />
                      </Pressable>
                    ) : null}
                  </View>
                </>
              ) : null}
              <Pressable testID="staff-save-btn" onPress={save} disabled={saving || !name.trim()} style={[s.saveBtn, { marginTop: 16 }, (saving || !name.trim()) && { opacity: 0.5 }]}>
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

      {/* Payroll (weekly settlement) modal */}
      <Modal visible={payrollOpen} transparent animationType="slide" onRequestClose={() => setPayrollOpen(false)}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
          <Pressable style={{ flex: 1 }} onPress={() => setPayrollOpen(false)} />
          <View style={{ backgroundColor: theme.color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: insets.bottom + 20, maxHeight: "80%" }}>
            <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.color.border, marginBottom: 12 }} />
            <Text style={s.title}>Rozliczenie wypłat</Text>
            <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 }}>
              Wypłaca się tylko godziny z listy obecności (rzeczywiście zaklikane „Rozpoczynam / Kończę pracę”)
            </Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Od</Text>
                <TextInput value={payrollFrom} onChangeText={setPayrollFrom} style={s.input}
                  {...(Platform.OS === "web" ? ({ type: "date" } as any) : {})} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Do</Text>
                <TextInput value={payrollTo} onChangeText={setPayrollTo} style={s.input}
                  {...(Platform.OS === "web" ? ({ type: "date" } as any) : {})} />
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              <Pressable onPress={() => { const now = new Date(); setPayrollFrom(mondayIso(now)); setPayrollTo(sundayIso(now)); }} style={s.quickChip}>
                <Text style={s.quickChipTxt}>Ten tydzień</Text>
              </Pressable>
              <Pressable onPress={() => { const d = new Date(); d.setDate(d.getDate() - 7); setPayrollFrom(mondayIso(d)); setPayrollTo(sundayIso(d)); }} style={s.quickChip}>
                <Text style={s.quickChipTxt}>Poprzedni tydzień</Text>
              </Pressable>
              <Pressable onPress={loadPayroll} style={s.quickChip}>
                <Feather name="refresh-ccw" size={12} color={theme.color.brand} />
                <Text style={s.quickChipTxt}>Odśwież</Text>
              </Pressable>
            </View>

            <ScrollView style={{ marginTop: 12, maxHeight: 380 }}>
              {payrollLoading ? <ActivityIndicator color={theme.color.brand} /> :
               !payrollData?.staff?.length ? (
                <Text style={{ color: theme.color.onSurfaceSecondary, textAlign: "center", padding: 20 }}>
                  Brak nierozliczonych godzin w tym okresie.
                </Text>
               ) : payrollData.staff.map((r: any) => (
                <View key={r.staff_id || r.name} style={s.payrollRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.color.onSurface, fontSize: 14, fontWeight: "700" }}>{r.name}</Text>
                    <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 11 }}>
                      {r.hours.toFixed(2)} godz. × {r.hourly_rate.toFixed(2)} zł
                    </Text>
                  </View>
                  <Text style={{ color: theme.color.brand, fontSize: 15, fontWeight: "800" }}>{formatPLN(r.amount)}</Text>
                </View>
               ))}
            </ScrollView>

            {payrollData?.staff?.length ? (
              <View style={{ marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: theme.color.brand + "12", borderWidth: 1, borderColor: theme.color.brand + "44" }}>
                <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 11, letterSpacing: 1, fontWeight: "700" }}>ŁĄCZNIE DO WYPŁATY</Text>
                <Text style={{ color: theme.color.brand, fontSize: 22, fontWeight: "800", marginTop: 2 }}>{formatPLN(payrollData.total || 0)}</Text>
              </View>
            ) : null}

            <Pressable
              onPress={doMarkPaid}
              disabled={payrollMarking || !payrollData?.staff?.length}
              style={[{ marginTop: 14, backgroundColor: theme.color.brand, borderRadius: 12, paddingVertical: 15, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 },
                     (payrollMarking || !payrollData?.staff?.length) && { opacity: 0.5 }]}
            >
              {payrollMarking ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Feather name="check" size={16} color="#fff" />
                  <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>Oznacz wypłacone</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: v2.color.bg },
  header: { paddingHorizontal: 20, paddingBottom: 14, paddingTop: 8, flexDirection: "row", alignItems: "flex-end", backgroundColor: v2.color.forestDeep, gap: 6 },
  brand: { color: v2.color.moss, letterSpacing: 3, fontSize: 10, fontWeight: "800", marginBottom: 4 },
  title: { color: v2.color.onDark, fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },
  // ---- Mode toggle ----
  quickLinksRow: { flexDirection: "row", gap: 8, paddingHorizontal: 20, marginBottom: 10 },
  quickLink: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 10, borderRadius: 10, borderWidth: 1,
    borderColor: theme.color.border, backgroundColor: theme.color.surface,
  },
  quickLinkText: { color: theme.color.onSurface, fontSize: 12, fontWeight: "700" },
  modeRow: {
    flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingVertical: 8,
  },
  modeBtn: {
    flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center",
    paddingVertical: 10, borderRadius: 10, borderWidth: 1,
    borderColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary,
  },
  modeBtnActive: {
    backgroundColor: theme.color.brand, borderColor: theme.color.brand,
  },
  modeBtnText: { color: theme.color.onSurface, fontWeight: "700", fontSize: 13 },
  // ---- Wages view ----
  wagesHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 8,
  },
  navBtnSm: {
    width: 34, height: 34, borderRadius: 999,
    backgroundColor: theme.color.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: theme.color.border,
  },
  wagesMonthTitle: { color: theme.color.onSurface, fontSize: 15, fontWeight: "700" },
  wagesSumCard: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: theme.color.brand + "10",
    borderWidth: 1, borderColor: theme.color.brand + "44",
    borderRadius: 14, padding: 14, marginBottom: 10,
  },
  wagesSumLabel: { color: theme.color.onSurfaceSecondary, fontSize: 11, letterSpacing: 1 },
  wagesSumValue: { color: theme.color.brand, fontSize: 26, fontWeight: "800", marginTop: 2 },
  wagesSumSub: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  payrollBtn: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, marginBottom: 10, borderRadius: 12, borderWidth: 1, borderColor: theme.color.brand, backgroundColor: theme.color.brand + "0A" },
  payrollBtnText: { flex: 1, color: theme.color.brand, fontSize: 13, fontWeight: "700" },
  payrollRow: { flexDirection: "row", alignItems: "center", padding: 10, borderBottomWidth: 0.5, borderBottomColor: theme.color.divider },
  quickChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: theme.color.brand, backgroundColor: theme.color.brand + "12" },
  quickChipTxt: { color: theme.color.brand, fontWeight: "700", fontSize: 12 },
  wageRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: 12, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: theme.color.border,
  },
  wageAmt: { color: theme.color.onSurface, fontSize: 16, fontWeight: "800" },
  wageHours: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  wageMeta: { color: theme.color.onSurfaceSecondary, fontSize: 11 },
  //
  logoutBtn: { padding: 8, backgroundColor: theme.color.surfaceSecondary, borderRadius: 999 },
  headerIcon: {
    width: 36, height: 36, borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center", marginLeft: 4,
  },
  menuBackdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.2)",
  },
  menuCard: {
    position: "absolute", right: 20, minWidth: 200,
    backgroundColor: theme.color.surface, borderRadius: 14,
    borderWidth: 1, borderColor: theme.color.border,
    padding: 6, shadowColor: "#000", shadowOpacity: 0.25,
    shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  menuItem: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10,
  },
  menuItemText: { color: theme.color.onSurface, fontSize: 14, fontWeight: "600" },
  menuDivider: { height: 1, backgroundColor: theme.color.divider, marginHorizontal: 6, marginVertical: 2 },
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

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl,
  TextInput, ActivityIndicator, Alert, Platform, Modal, KeyboardAvoidingView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { api } from "@/src/api";
import { printStockList } from "@/src/printShopping";

type StockItem = {
  id: string; name: string; category: string; qty: number; unit: string;
  expiry_date?: string | null; expiry_status?: "" | "expired" | "urgent" | "soon" | "ok";
  reserved_qty: number; available_qty: number; notes?: string;
  reservations?: { id: string; event_id: string; event_name: string; qty: number; event_date?: string }[];
};

export const CATS: { id: string; label: string; color: string }[] = [
  { id: "mieso", label: "Mięso", color: "#DC2626" },
  { id: "warzywa", label: "Warzywa", color: "#16A34A" },
  { id: "nabial", label: "Nabiał", color: "#F59E0B" },
  { id: "pieczywo", label: "Pieczywo", color: "#A16207" },
  { id: "spozywcze", label: "Spożywcze", color: "#7C3AED" },
  { id: "napoje", label: "Napoje", color: "#0EA5E9" },
  { id: "kawa", label: "Kawa/Herbata", color: "#8B5CF6" },
  { id: "jednorazowki", label: "Jednorazówki", color: "#10B981" },
  { id: "srodki", label: "Środki czystości", color: "#06B6D4" },
  { id: "dekoracje", label: "Dekoracje", color: "#EC4899" },
  { id: "dodatkowe", label: "Dodatkowe", color: "#6B7280" },
  { id: "inne", label: "Inne", color: "#9CA3AF" },
];
export const catColor = (c: string) => (CATS.find(x => x.id === c)?.color || "#9CA3AF");
export const catLabel = (c: string) => (CATS.find(x => x.id === c)?.label || c);
export const UNITS = ["kg", "g", "l", "ml", "szt", "opak", "sloik", "peczek", "porcja"];

export function expiryColor(status?: string): { bg: string; text: string; label: string; icon: any } {
  switch (status) {
    case "expired": return { bg: "#FEE2E2", text: "#B91C1C", label: "PO TERMINIE", icon: "alert-octagon" };
    case "urgent":  return { bg: "#FFEDD5", text: "#C2410C", label: "1–3 dni", icon: "alert-triangle" };
    case "soon":    return { bg: "#FEF3C7", text: "#B45309", label: "≤7 dni", icon: "clock" };
    case "ok":      return { bg: "#DCFCE7", text: "#15803D", label: "OK", icon: "check" };
    default:        return { bg: "#F3F4F6", text: "#6B7280", label: "bez daty", icon: "help-circle" };
  }
}

// ---------------- Magazyn view ----------------
export default function MagazynView({ onCloseReq }: { onCloseReq?: () => void }) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showKontrola, setShowKontrola] = useState(false);
  const [showSnaps, setShowSnaps] = useState(false);
  const [snaps, setSnaps] = useState<any[]>([]);
  const [editItem, setEditItem] = useState<StockItem | null>(null);
  const [resItem, setResItem] = useState<StockItem | null>(null);

  const load = useCallback(async () => {
    try { const l: any = await api.stockList(); setItems(l || []); } catch {}
  }, []);
  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);

  const stats = useMemo(() => {
    const expired = items.filter(i => i.expiry_status === "expired").length;
    const urgent  = items.filter(i => i.expiry_status === "urgent").length;
    const soon    = items.filter(i => i.expiry_status === "soon").length;
    return { total: items.length, expired, urgent, soon };
  }, [items]);

  const byCat = useMemo(() => {
    const m: Record<string, StockItem[]> = {};
    // Sort by expiry within category (worst first)
    const rank: Record<string, number> = { expired: 0, urgent: 1, soon: 2, ok: 3, "": 4 };
    items.forEach(it => { (m[it.category] = m[it.category] || []).push(it); });
    Object.keys(m).forEach(k => m[k].sort((a, b) => (rank[a.expiry_status || ""] - rank[b.expiry_status || ""]) || a.name.localeCompare(b.name)));
    return m;
  }, [items]);

  const openSnaps = async () => {
    try { const s: any = await api.stockSnapshots(30); setSnaps(s || []); setShowSnaps(true); } catch {}
  };

  if (loading) return <View style={s.rootLoading}><ActivityIndicator color={theme.color.brand} /></View>;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={theme.color.brand} />}>

        {/* Hero card */}
        <View style={s.hero}>
          <Text style={s.heroLabel}>STAN MAGAZYNU</Text>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 6 }}>
            <View style={{ flex: 1 }}>
              <Text style={s.k}>Pozycji</Text>
              <Text style={[s.v, { color: theme.color.brand }]}>{stats.total}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.k}>Po terminie</Text>
              <Text style={[s.v, { color: "#B91C1C" }]}>{stats.expired}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.k}>1–3 dni</Text>
              <Text style={[s.v, { color: "#C2410C" }]}>{stats.urgent}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.k}>≤7 dni</Text>
              <Text style={[s.v, { color: "#B45309" }]}>{stats.soon}</Text>
            </View>
          </View>
        </View>

        {/* Actions */}
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          <Pressable onPress={() => setShowKontrola(true)} style={[s.primaryBtn, { flex: 2 }]}>
            <Feather name="clipboard" size={16} color={theme.color.onBrand} />
            <Text style={s.primaryBtnText}>Sprawdź magazyn</Text>
          </Pressable>
          <Pressable onPress={() => setShowAdd(true)} style={[s.secondaryBtn, { flex: 1 }]}>
            <Feather name="plus" size={16} color={theme.color.brand} />
            <Text style={s.secondaryBtnText}>Dodaj</Text>
          </Pressable>
          <Pressable onPress={() => printStockList(items)} style={[s.secondaryBtn, { flex: 1 }]}>
            <Feather name="printer" size={16} color={theme.color.brand} />
            <Text style={s.secondaryBtnText}>Drukuj</Text>
          </Pressable>
        </View>
        <Pressable onPress={openSnaps} style={s.linkBtn}>
          <Feather name="rotate-cw" size={12} color={theme.color.onSurfaceSecondary} />
          <Text style={s.linkBtnText}>Historia kontroli</Text>
        </Pressable>

        {/* Expiring warnings block */}
        {(stats.expired + stats.urgent) > 0 ? (
          <View style={[s.card, { borderColor: "#EF4444" + "66", backgroundColor: "#FEF2F2" }]}>
            <Text style={[s.section, { color: "#B91C1C" }]}>⚠ Wykorzystaj wkrótce</Text>
            {items.filter(i => i.expiry_status === "expired" || i.expiry_status === "urgent")
              .sort((a, b) => (a.expiry_date || "").localeCompare(b.expiry_date || ""))
              .map(it => {
                const ec = expiryColor(it.expiry_status);
                return (
                  <View key={it.id} style={s.warnRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.warnName}>{it.name}</Text>
                      <Text style={s.warnMeta}>{it.qty} {it.unit} · ważne do {it.expiry_date}</Text>
                    </View>
                    <View style={[s.expBadge, { backgroundColor: ec.bg }]}>
                      <Text style={[s.expBadgeText, { color: ec.text }]}>{ec.label}</Text>
                    </View>
                  </View>
                );
              })}
          </View>
        ) : null}

        {/* Items by category */}
        {items.length === 0 ? (
          <Text style={{ color: theme.color.onSurfaceSecondary, textAlign: "center", padding: 24 }}>
            Magazyn jest pusty. Kliknij „Dodaj” lub „Sprawdź magazyn” żeby wprowadzić pierwsze pozycje.
          </Text>
        ) : null}
        {CATS.filter(c => (byCat[c.id] || []).length > 0).map(c => (
          <View key={c.id} style={s.card}>
            <View style={s.rowBet}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={[s.catDot, { backgroundColor: c.color, width: 10, height: 10 }]} />
                <Text style={s.section}>{c.label} · {byCat[c.id].length}</Text>
              </View>
            </View>
            {byCat[c.id].map(it => {
              const ec = expiryColor(it.expiry_status);
              return (
                <Pressable key={it.id} onPress={() => setEditItem(it)} style={s.itemRow}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Text style={s.itName}>{it.name}</Text>
                      {it.expiry_status ? (
                        <View style={[s.expBadge, { backgroundColor: ec.bg }]}>
                          <Text style={[s.expBadgeText, { color: ec.text }]}>{ec.label}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={s.itMeta}>
                      {it.qty} {it.unit}
                      {it.expiry_date ? `  ·  do ${it.expiry_date}` : ""}
                    </Text>
                    {it.reserved_qty > 0 ? (
                      <Text style={{ color: theme.color.warning, fontSize: 11, marginTop: 2, fontWeight: "600" }}>
                        Zarezerwowane: {it.reserved_qty} {it.unit} · Dostępne: {it.available_qty} {it.unit}
                      </Text>
                    ) : null}
                    {it.reservations && it.reservations.length > 0 ? (
                      <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 10, marginTop: 1 }} numberOfLines={2}>
                        {it.reservations.map(r => `${r.event_name || "?"} (${r.qty} ${it.unit})`).join(" • ")}
                      </Text>
                    ) : null}
                  </View>
                  <Pressable onPress={(e: any) => { e.stopPropagation?.(); setResItem(it); }} hitSlop={10} style={{ padding: 6 }}>
                    <Feather name="bookmark" size={16} color={theme.color.brand} />
                  </Pressable>
                  <Pressable onPress={(e: any) => {
                    e.stopPropagation?.();
                    Alert.alert("Usunąć pozycję?", it.name, [
                      { text: "Anuluj", style: "cancel" },
                      { text: "Usuń", style: "destructive", onPress: async () => { await api.stockDelete(it.id); await load(); } },
                    ]);
                  }} hitSlop={10} style={{ padding: 6 }}>
                    <Feather name="trash-2" size={14} color={theme.color.error} />
                  </Pressable>
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>

      {/* Add / Edit modal */}
      <StockItemModal
        visible={showAdd || !!editItem}
        initial={editItem || null}
        onClose={() => { setShowAdd(false); setEditItem(null); }}
        onSaved={async () => { setShowAdd(false); setEditItem(null); await load(); }}
      />

      {/* Kontrola modal */}
      <KontrolaModal
        visible={showKontrola}
        onClose={() => setShowKontrola(false)}
        onSaved={async () => { setShowKontrola(false); await load(); }}
      />

      {/* Snapshots history */}
      <Modal visible={showSnaps} animationType="slide" onRequestClose={() => setShowSnaps(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: theme.color.surface }}>
          <View style={[s.modalHeader, { paddingTop: insets.top + 12 }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={s.title}>Historia kontroli</Text>
              <Pressable onPress={() => setShowSnaps(false)} style={s.closeBtn}>
                <Feather name="x" size={20} color={theme.color.onSurface} />
              </Pressable>
            </View>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
            {snaps.length === 0 ? (
              <Text style={{ color: theme.color.onSurfaceSecondary, textAlign: "center", padding: 24 }}>Brak zapisów kontroli.</Text>
            ) : snaps.map((sn: any) => (
              <View key={sn.id} style={s.card}>
                <Text style={s.section}>{sn.check_date} · {sn.item_count} pozycji</Text>
                <Text style={s.itMeta}>
                  {new Date(sn.created_at).toLocaleString("pl-PL")}
                  {sn.user_email ? ` · ${sn.user_email}` : ""}
                </Text>
                {sn.notes ? <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 4 }}>„{sn.notes}”</Text> : null}
                <View style={{ marginTop: 6 }}>
                  {(sn.items || []).slice(0, 6).map((it: any, i: number) => (
                    <Text key={i} style={s.itMeta}>· {it.name}: {it.qty} {it.unit}{it.expiry_date ? ` (do ${it.expiry_date})` : ""}</Text>
                  ))}
                  {(sn.items || []).length > 6 ? <Text style={s.itMeta}>...i {sn.items.length - 6} więcej</Text> : null}
                </View>
              </View>
            ))}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Reservations modal */}
      <ReservationsModal
        item={resItem}
        onClose={() => setResItem(null)}
        onChanged={async () => { setResItem(null); await load(); }}
      />
    </View>
  );
}

// ================================================================
// Add/Edit stock item modal
// ================================================================
function StockItemModal({ visible, initial, onClose, onSaved }: { visible: boolean; initial: StockItem | null; onClose: () => void; onSaved: () => void }) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(initial?.name || "");
  const [category, setCategory] = useState(initial?.category || "inne");
  const [qty, setQty] = useState(String(initial?.qty ?? ""));
  const [unit, setUnit] = useState(initial?.unit || "szt");
  const [expiry, setExpiry] = useState(initial?.expiry_date || "");
  const [notes, setNotes] = useState(initial?.notes || "");
  useEffect(() => {
    if (visible) {
      setName(initial?.name || ""); setCategory(initial?.category || "inne");
      setQty(String(initial?.qty ?? "")); setUnit(initial?.unit || "szt");
      setExpiry(initial?.expiry_date || ""); setNotes(initial?.notes || "");
    }
  }, [visible, initial]);

  const save = async () => {
    if (!name.trim()) { Alert.alert("Brak nazwy", "Wpisz nazwę pozycji"); return; }
    const payload: any = { name: name.trim(), category, qty: parseFloat(qty.replace(",", ".")) || 0, unit, expiry_date: expiry || null, notes };
    try {
      if (initial) await api.stockUpdate(initial.id, payload);
      else await api.stockAdd(payload);
      onSaved();
    } catch (e: any) { Alert.alert("Błąd", e?.message || "Nie udało się zapisać"); }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.modalBackdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ maxHeight: "88%" }}>
          <View style={s.sheet}>
            <View style={s.rowBet}>
              <Text style={s.title}>{initial ? "Edycja pozycji" : "Nowa pozycja"}</Text>
              <Pressable onPress={onClose} style={s.closeBtn}><Feather name="x" size={20} color={theme.color.onSurface} /></Pressable>
            </View>
            <ScrollView style={{ maxHeight: 560 }} keyboardShouldPersistTaps="handled">
              <Text style={s.k}>Nazwa</Text>
              <TextInput value={name} onChangeText={setName} placeholder="np. Kiełbasa grillowa" style={s.input} />

              <Text style={[s.k, { marginTop: 8 }]}>Kategoria</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
                {CATS.map(c => (
                  <Pressable key={c.id} onPress={() => setCategory(c.id)}
                    style={[s.catChip, { borderColor: c.color + "88" }, category === c.id && { backgroundColor: c.color + "22", borderColor: c.color }]}>
                    <Text style={[s.catChipTxt, { color: category === c.id ? c.color : theme.color.onSurfaceSecondary }]}>{c.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.k}>Ilość</Text>
                  <TextInput value={qty} onChangeText={setQty} placeholder="0" keyboardType="decimal-pad" style={s.input} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.k}>Jednostka</Text>
                  <View style={[s.input, { padding: 0 }]}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: "center", paddingHorizontal: 4 }}>
                      {UNITS.map(u => (
                        <Pressable key={u} onPress={() => setUnit(u)} style={[s.miniBtn, unit === u && s.miniBtnActive]}>
                          <Text style={[s.miniBtnTxt, unit === u && s.miniBtnTxtActive]}>{u}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                </View>
              </View>

              <Text style={[s.k, { marginTop: 8 }]}>Data ważności (opcjonalnie)</Text>
              <TextInput value={expiry} onChangeText={setExpiry} placeholder="YYYY-MM-DD" style={s.input}
                {...(Platform.OS === "web" ? ({ type: "date" } as any) : {})} />

              <Text style={[s.k, { marginTop: 8 }]}>Notatki</Text>
              <TextInput value={notes} onChangeText={setNotes} placeholder="opcjonalnie" style={[s.input, { minHeight: 40 }]} multiline />
            </ScrollView>
            <Pressable onPress={save} style={[s.primaryBtn, { marginTop: 12 }]}>
              <Text style={s.primaryBtnText}>Zapisz</Text>
            </Pressable>
            <View style={{ height: insets.bottom }} />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ================================================================
// Kontrola magazynu — bulk quick-entry
// ================================================================
function KontrolaModal({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: () => void }) {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<any[]>([]);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    (async () => {
      try {
        const [stock]: any[] = await Promise.all([api.stockList()]);
        // Pre-fill with existing stock
        const merged: any[] = (stock || []).map((it: StockItem) => ({
          id: it.id, name: it.name, category: it.category, unit: it.unit, qty: String(it.qty),
          expiry_date: it.expiry_date || "",
        }));
        setRows(merged);
      } catch {}
      finally { setLoading(false); }
    })();
    setNotes("");
  }, [visible]);

  const updateRow = (idx: number, patch: any) => setRows(r => r.map((x, i) => i === idx ? { ...x, ...patch } : x));
  const removeRow = (idx: number) => setRows(r => r.filter((_, i) => i !== idx));
  const addRow = () => setRows(r => [...r, { name: "", category: "inne", unit: "szt", qty: "", expiry_date: "" }]);

  const save = async () => {
    const items = rows
      .filter(r => (r.name || "").trim().length > 0)
      .map(r => ({
        id: r.id || undefined,
        name: r.name.trim(), category: r.category || "inne", unit: r.unit || "szt",
        qty: parseFloat(String(r.qty || "0").replace(",", ".")) || 0,
        expiry_date: r.expiry_date || null,
      }));
    if (items.length === 0) { onClose(); return; }
    try {
      await api.stockCheck(items, notes);
      onSaved();
    } catch (e: any) { Alert.alert("Błąd", e?.message || "Nie udało się"); }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: theme.color.surface }}>
        <View style={[s.modalHeader, { paddingTop: insets.top + 12 }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View>
              <Text style={s.brand}>Kontrola magazynu</Text>
              <Text style={s.title}>{new Date().toLocaleDateString("pl-PL")}</Text>
            </View>
            <Pressable onPress={onClose} style={s.closeBtn}><Feather name="x" size={20} color={theme.color.onSurface} /></Pressable>
          </View>
        </View>
        {loading ? <ActivityIndicator color={theme.color.brand} style={{ marginTop: 40 }} /> : null}
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
          <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 12, marginBottom: 8 }}>
            Wpisz aktualny stan każdej pozycji i (opcjonalnie) datę ważności. Zapis stworzy migawkę w historii.
          </Text>
          {rows.map((r, idx) => (
            <View key={idx} style={s.kontrolaRow}>
              <TextInput value={r.name} onChangeText={t => updateRow(idx, { name: t })} placeholder="Nazwa" style={[s.input, { marginBottom: 4 }]} />
              <View style={{ flexDirection: "row", gap: 4 }}>
                <TextInput value={String(r.qty ?? "")} onChangeText={t => updateRow(idx, { qty: t })} placeholder="Ilość" keyboardType="decimal-pad" style={[s.input, { flex: 1 }]} />
                <View style={[s.input, { flex: 1.2, padding: 0 }]}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: "center", paddingHorizontal: 4 }}>
                    {UNITS.map(u => (
                      <Pressable key={u} onPress={() => updateRow(idx, { unit: u })} style={[s.miniBtn, r.unit === u && s.miniBtnActive]}>
                        <Text style={[s.miniBtnTxt, r.unit === u && s.miniBtnTxtActive]}>{u}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
                <TextInput value={r.expiry_date} onChangeText={t => updateRow(idx, { expiry_date: t })} placeholder="Ważne do YYYY-MM-DD" style={[s.input, { flex: 1.2 }]}
                  {...(Platform.OS === "web" ? ({ type: "date" } as any) : {})} />
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
                {CATS.map(c => (
                  <Pressable key={c.id} onPress={() => updateRow(idx, { category: c.id })}
                    style={[s.catChip, { borderColor: c.color + "88" }, r.category === c.id && { backgroundColor: c.color + "22", borderColor: c.color }]}>
                    <Text style={[s.catChipTxt, { color: r.category === c.id ? c.color : theme.color.onSurfaceSecondary }]}>{c.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Pressable onPress={() => removeRow(idx)} style={{ position: "absolute", right: 6, top: 6 }} hitSlop={10}>
                <Feather name="trash-2" size={14} color={theme.color.error} />
              </Pressable>
            </View>
          ))}
          <Pressable onPress={addRow} style={[s.secondaryBtn, { alignSelf: "flex-start", marginTop: 6 }]}>
            <Feather name="plus" size={14} color={theme.color.brand} />
            <Text style={s.secondaryBtnText}>Dodaj pozycję</Text>
          </Pressable>

          <Text style={[s.k, { marginTop: 12 }]}>Notatka (opcjonalnie)</Text>
          <TextInput value={notes} onChangeText={setNotes} placeholder="np. Sobota rano — po dostawie" style={s.input} />
        </ScrollView>
        <View style={{ padding: 12, borderTopWidth: 1, borderColor: theme.color.divider, paddingBottom: insets.bottom + 12 }}>
          <Pressable onPress={save} style={s.primaryBtn}>
            <Feather name="check" size={16} color={theme.color.onBrand} />
            <Text style={s.primaryBtnText}>Zapisz kontrolę</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ================================================================
// Reservations modal
// ================================================================
function ReservationsModal({ item, onClose, onChanged }: { item: StockItem | null; onClose: () => void; onChanged: () => void }) {
  const insets = useSafeAreaInsets();
  const [events, setEvents] = useState<any[]>([]);
  const [selEv, setSelEv] = useState<string>("");
  const [qty, setQty] = useState("");

  useEffect(() => {
    if (!item) return;
    (async () => {
      try {
        const evs: any = await api.listEvents();
        const today = new Date().toISOString().slice(0, 10);
        const upcoming = (evs || []).filter((e: any) => (e.date || "") >= today).slice(0, 40);
        setEvents(upcoming);
        setSelEv(upcoming[0]?.id || "");
        setQty("");
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  if (!item) return null;
  const addRes = async () => {
    const q = parseFloat(qty.replace(",", ".")) || 0;
    if (q <= 0 || !selEv) return;
    const ev = events.find(e => e.id === selEv);
    try {
      await api.reservationsAdd({
        stock_id: item.id, name: item.name, unit: item.unit, qty: q,
        event_id: selEv, event_name: ev?.name || "",
      });
      onChanged();
    } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
  };
  const delRes = async (rid: string) => {
    try { await api.reservationsDelete(rid); onChanged(); } catch {}
  };

  return (
    <Modal visible={!!item} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.modalBackdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={s.sheet}>
            <View style={s.rowBet}>
              <View>
                <Text style={s.brand}>Rezerwacje</Text>
                <Text style={s.title}>{item.name}</Text>
              </View>
              <Pressable onPress={onClose} style={s.closeBtn}><Feather name="x" size={20} color={theme.color.onSurface} /></Pressable>
            </View>

            <Text style={s.itMeta}>
              W magazynie: {item.qty} {item.unit} · Zarezerwowane: {item.reserved_qty} {item.unit} · Dostępne: {item.available_qty} {item.unit}
            </Text>

            <ScrollView style={{ maxHeight: 260, marginTop: 8 }}>
              {(item.reservations || []).length === 0 ? (
                <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 12, paddingVertical: 8 }}>Brak aktywnych rezerwacji.</Text>
              ) : (item.reservations || []).map(r => (
                <View key={r.id} style={s.resRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.itName}>{r.event_name || "?"}</Text>
                    <Text style={s.itMeta}>{r.qty} {item.unit}{r.event_date ? ` · ${r.event_date}` : ""}</Text>
                  </View>
                  <Pressable onPress={() => delRes(r.id)} hitSlop={10}>
                    <Feather name="trash-2" size={14} color={theme.color.error} />
                  </Pressable>
                </View>
              ))}
            </ScrollView>

            <Text style={[s.k, { marginTop: 12 }]}>Zarezerwuj pod imprezę</Text>
            <View style={s.input}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: "center", paddingHorizontal: 4 }}>
                {events.length === 0 ? (
                  <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 12 }}>Brak przyszłych imprez</Text>
                ) : events.map(e => (
                  <Pressable key={e.id} onPress={() => setSelEv(e.id)} style={[s.miniBtn, selEv === e.id && s.miniBtnActive]}>
                    <Text style={[s.miniBtnTxt, selEv === e.id && s.miniBtnTxtActive]} numberOfLines={1}>{e.date} · {e.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
            <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
              <TextInput value={qty} onChangeText={setQty} placeholder={`Ilość (${item.unit})`} keyboardType="decimal-pad" style={[s.input, { flex: 1 }]} />
              <Pressable onPress={addRes} style={[s.primaryBtn]}>
                <Text style={s.primaryBtnText}>Zarezerwuj</Text>
              </Pressable>
            </View>
            <View style={{ height: insets.bottom }} />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  rootLoading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.surface },
  hero: { marginTop: 6, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: theme.color.brand + "44", backgroundColor: theme.color.brand + "0A" },
  heroLabel: { color: theme.color.onSurfaceSecondary, letterSpacing: 1, fontSize: 10, fontWeight: "700" },
  k: { color: theme.color.onSurfaceSecondary, fontSize: 10, fontWeight: "600" },
  v: { fontSize: 18, fontWeight: "800" },
  brand: { color: theme.color.onSurfaceSecondary, letterSpacing: 3, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  title: { color: theme.color.onSurface, fontSize: 22, fontWeight: "700" },
  modalHeader: { paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderColor: theme.color.divider },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: theme.color.brand },
  primaryBtnText: { color: theme.color.onBrand, fontWeight: "700", fontSize: 13 },
  secondaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: theme.color.brand, backgroundColor: theme.color.brand + "12" },
  secondaryBtnText: { color: theme.color.brand, fontWeight: "700", fontSize: 12 },
  linkBtn: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 4, paddingVertical: 6, marginTop: 4 },
  linkBtnText: { color: theme.color.onSurfaceSecondary, fontSize: 11, fontWeight: "600" },
  card: { marginTop: 12, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface },
  rowBet: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  section: { color: theme.color.onSurface, fontSize: 13, fontWeight: "700" },
  catDot: { width: 8, height: 8, borderRadius: 999 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: theme.color.divider },
  itName: { color: theme.color.onSurface, fontSize: 13, fontWeight: "700" },
  itMeta: { color: theme.color.onSurfaceSecondary, fontSize: 11 },
  expBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  expBadgeText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  warnRow: { flexDirection: "row", alignItems: "center", paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: "#FEE2E2" },
  warnName: { color: "#7F1D1D", fontSize: 13, fontWeight: "700" },
  warnMeta: { color: "#B91C1C", fontSize: 11 },
  closeBtn: { width: 36, height: 36, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.border },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: theme.color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, gap: 6 },
  input: { paddingHorizontal: 10, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface, color: theme.color.onSurface, fontSize: 13 },
  miniBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, marginRight: 4 },
  miniBtnActive: { backgroundColor: theme.color.brand + "22" },
  miniBtnTxt: { fontSize: 11, color: theme.color.onSurfaceSecondary, fontWeight: "600" },
  miniBtnTxtActive: { color: theme.color.brand },
  catChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1, marginRight: 4 },
  catChipTxt: { fontSize: 10, fontWeight: "700" },
  kontrolaRow: { position: "relative", padding: 8, marginBottom: 6, borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface },
  resRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: theme.color.divider },
});

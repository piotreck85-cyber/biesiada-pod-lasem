import { useCallback, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl,
  TextInput, ActivityIndicator, Alert, Platform, Modal, KeyboardAvoidingView, StatusBar,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { theme, formatPLN } from "@/src/theme";
import { v2 } from "@/src/designTokensV2";
import { api } from "@/src/api";
import MagazynView from "@/src/components/MagazynView";
import { printShoppingList } from "@/src/printShopping";

type Item = {
  id: string; name: string; category: string; qty: number; unit: string;
  stock_qty: number; unit_price: number; actual_price?: number | null;
  status: "todo" | "bought" | "ready"; event_ids: string[]; event_names?: string[]; notes?: string;
};

type Ingredient = { name: string; category: string; unit: string; qty: number; price: number };
type Recipes = Record<string, Ingredient[]>;

const CATS: { id: string; label: string; color: string; icon: any }[] = [
  { id: "mieso", label: "Mięso", color: "#DC2626", icon: "target" },
  { id: "warzywa", label: "Warzywa", color: "#16A34A", icon: "feather" },
  { id: "nabial", label: "Nabiał", color: "#F59E0B", icon: "droplet" },
  { id: "pieczywo", label: "Pieczywo", color: "#A16207", icon: "square" },
  { id: "spozywcze", label: "Spożywcze", color: "#7C3AED", icon: "package" },
  { id: "napoje", label: "Napoje", color: "#0EA5E9", icon: "coffee" },
  { id: "kawa", label: "Kawa/Herbata", color: "#8B5CF6", icon: "coffee" },
  { id: "jednorazowki", label: "Jednorazówki", color: "#10B981", icon: "layers" },
  { id: "srodki", label: "Środki czystości", color: "#06B6D4", icon: "shield" },
  { id: "dekoracje", label: "Dekoracje", color: "#EC4899", icon: "star" },
  { id: "catering", label: "Catering", color: "#F97316", icon: "clipboard" },
  { id: "grill", label: "Grill", color: "#EF4444", icon: "zap" },
  { id: "dodatkowe", label: "Dodatkowe", color: "#6B7280", icon: "plus-circle" },
  { id: "inne", label: "Inne", color: "#9CA3AF", icon: "help-circle" },
];
// helper (kept for potential future use)


const UNITS = ["kg", "g", "l", "ml", "szt", "opak", "sloik", "peczek", "porcja"];

export default function Zakupy() {
  const insets = useSafeAreaInsets();
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(iso(today));
  const [dateTo, setDateTo] = useState(iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7)));
  const [items, setItems] = useState<Item[]>([]);
  const [gen, setGen] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expand, setExpand] = useState(true);
  const [showRecipes, setShowRecipes] = useState(false);

  // Recipes editor state
  const [recipes, setRecipes] = useState<Recipes>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editRows, setEditRows] = useState<Ingredient[]>([]);

  const load = useCallback(async () => {
    try {
      const [list, g]: any[] = await Promise.all([
        api.shoppingList(),
        api.shoppingGenerate(dateFrom, dateTo, expand),
      ]);
      setItems(list || []);
      setGen(g);
    } catch {}
  }, [dateFrom, dateTo, expand]);
  useFocusEffect(useCallback(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]));

  const openRecipes = async () => {
    try {
      const d: any = await api.shoppingRecipes();
      setRecipes(d.recipes || {});
      setLabels(d.labels || {});
      setShowRecipes(true);
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "Nie udało się pobrać przepisów");
    }
  };
  const startEdit = (key: string) => {
    setEditKey(key);
    setEditRows((recipes[key] || []).map(x => ({ ...x })));
  };
  const cancelEdit = () => { setEditKey(null); setEditRows([]); };
  const saveEdit = async () => {
    if (!editKey) return;
    try {
      await api.shoppingUpdateRecipe(editKey, editRows.filter(r => r.name.trim().length > 0));
      const d: any = await api.shoppingRecipes();
      setRecipes(d.recipes || {});
      setEditKey(null); setEditRows([]);
    } catch (e: any) { Alert.alert("Błąd", e?.message || "Nie udało się zapisać"); }
  };
  const resetToDefault = async () => {
    if (!editKey) return;
    Alert.alert("Reset do domyślnych", "Cofnąć zmiany do wartości domyślnych?", [
      { text: "Anuluj", style: "cancel" },
      { text: "Reset", style: "destructive", onPress: async () => {
        try {
          await api.shoppingResetRecipe(editKey);
          const d: any = await api.shoppingRecipes();
          setRecipes(d.recipes || {});
          setEditRows((d.recipes?.[editKey] || []).map((x: any) => ({ ...x })));
        } catch (e: any) { Alert.alert("Błąd", e?.message || "Nie udało się"); }
      }},
    ]);
  };
  const addIngRow = () => setEditRows(r => [...r, { name: "", category: "spozywcze", unit: "szt", qty: 0, price: 0 }]);
  const removeIngRow = (i: number) => setEditRows(r => r.filter((_, idx) => idx !== i));

  const setQuick = (m: "today" | "tom" | "wknd" | "7d" | "30d") => {
    const now = new Date();
    if (m === "today") { const t = iso(now); setDateFrom(t); setDateTo(t); }
    else if (m === "tom") { const t = new Date(now); t.setDate(now.getDate() + 1); const s = iso(t); setDateFrom(s); setDateTo(s); }
    else if (m === "wknd") {
      const d = new Date(now);
      const dow = d.getDay();
      const daysToSat = (6 - dow + 7) % 7;
      const sat = new Date(now); sat.setDate(now.getDate() + daysToSat);
      const sun = new Date(sat); sun.setDate(sat.getDate() + 1);
      setDateFrom(iso(sat)); setDateTo(iso(sun));
    }
    else if (m === "7d") { const t = new Date(now); t.setDate(now.getDate() + 7); setDateFrom(iso(now)); setDateTo(iso(t)); }
    else if (m === "30d") { const t = new Date(now); t.setDate(now.getDate() + 30); setDateFrom(iso(now)); setDateTo(iso(t)); }
  };

  const acceptSuggestion = async (sg: any) => {
    try {
      const qty = sg.to_buy != null ? sg.to_buy : sg.qty;
      if (qty <= 0) return;
      await api.shoppingAdd({
        name: sg.name, category: sg.category, qty, unit: sg.unit,
        unit_price: sg.unit_price, event_ids: sg.event_ids, event_names: sg.event_names,
        stock_qty: sg.stock_qty || 0,
      });
      await load();
    } catch {}
  };
  const acceptAll = async () => {
    if (!gen?.suggestions?.length) return;
    Alert.alert("Dodaj wszystkie", `Dodać ${gen.suggestions.length} pozycji do listy?`, [
      { text: "Anuluj", style: "cancel" },
      { text: "Dodaj", onPress: async () => {
        for (const s of gen.suggestions) { try { await acceptSuggestion(s); } catch {} }
      }},
    ]);
  };
  const toggleStatus = async (it: Item) => {
    const next = it.status === "todo" ? "bought" : it.status === "bought" ? "ready" : "todo";
    if (next === "bought" && (it.actual_price == null || it.actual_price === 0)) {
      const val = (it.unit_price * it.qty) || 0;
      Alert.prompt?.(
        "Kupione — wpisz rzeczywistą cenę",
        `Pozycja: ${it.name}`,
        [
          { text: "Anuluj", style: "cancel" },
          { text: "Zapisz", onPress: async (v?: string) => {
            const p = parseFloat(String(v || val).replace(",", ".")) || 0;
            await api.shoppingUpdate(it.id, { status: next, actual_price: p });
            await load();
          }},
        ],
        "plain-text", String(val),
      ) || await (async () => {
        await api.shoppingUpdate(it.id, { status: next, actual_price: val });
        await load();
      })();
    } else {
      await api.shoppingUpdate(it.id, { status: next });
      await load();
    }
  };

  const byCat = useMemo(() => {
    const m: Record<string, Item[]> = {};
    items.forEach(it => { (m[it.category] = m[it.category] || []).push(it); });
    return m;
  }, [items]);
  const stats = useMemo(() => {
    const todo = items.filter(x => x.status === "todo");
    const bought = items.filter(x => x.status === "bought" || x.status === "ready");
    const estTodo = todo.reduce((s, x) => s + Math.max(0, (x.qty - x.stock_qty)) * (x.unit_price || 0), 0);
    const spentBought = bought.reduce((s, x) => s + (x.actual_price || 0), 0);
    return { todo: todo.length, bought: bought.length, estTodo, spentBought };
  }, [items]);

  // Group suggestions by category (only rows that still need buying)
  const sugByCat = useMemo(() => {
    const m: Record<string, any[]> = {};
    (gen?.suggestions || []).forEach((s: any) => {
      const toBuy = s.to_buy != null ? s.to_buy : s.qty;
      if ((toBuy || 0) <= 0) return;
      (m[s.category] = m[s.category] || []).push(s);
    });
    return m;
  }, [gen]);

  const toBuyCount = useMemo(
    () => (gen?.suggestions || []).filter((sg: any) => (sg.to_buy ?? sg.qty ?? 0) > 0).length,
    [gen],
  );

  // Inline edit state
  const [editSug, setEditSug] = useState<any | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const openEdit = (sg: any) => {
    setEditSug(sg);
    setEditQty(String(sg.qty ?? ""));
    setEditPrice(String(sg.unit_price ?? ""));
  };
  const saveOverride = async () => {
    if (!editSug) return;
    const q = parseFloat(editQty.replace(",", ".")) || 0;
    const p = parseFloat(editPrice.replace(",", ".")) || 0;
    try {
      await api.shoppingSaveOverride({
        name: editSug.name,
        category: editSug.category,
        unit: editSug.unit || "szt",
        qty_override: q,
        price_override: p,
      });
      setEditSug(null);
      await load();
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "Nie udało się zapisać");
    }
  };
  const resetOverride = async () => {
    if (!editSug) return;
    try {
      await api.shoppingClearOverride(editSug.name, editSug.category, editSug.unit || "szt");
      setEditSug(null);
      await load();
    } catch {}
  };

  const catTotals = gen?.category_totals || {};

  const [view, setView] = useState<"buy" | "stock">("buy");

  if (loading) return <View style={s.rootLoading}><ActivityIndicator color={v2.color.forest} /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: v2.color.bg }}>
      <StatusBar barStyle="light-content" />
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
          <View style={{ flex: 1 }}>
            <Text style={s.brand}>ZAKUPY</Text>
            <Text style={s.title}>{view === "buy" ? "Automatyczna lista" : "Magazyn"}</Text>
          </View>
          {view === "buy" ? (
            <View style={{ flexDirection: "row", gap: 6 }}>
              <Pressable
                onPress={() => printShoppingList(gen || {}, items, dateFrom, dateTo)}
                style={s.headerBtn} hitSlop={8}>
                <Feather name="printer" size={16} color="#fff" />
              </Pressable>
              <Pressable onPress={openRecipes} style={s.headerBtn} hitSlop={8}>
                <Feather name="book-open" size={16} color="#fff" />
              </Pressable>
            </View>
          ) : null}
        </View>
        {/* Segment switch */}
        <View style={s.segRow}>
          <Pressable onPress={() => setView("buy")} style={[s.segBtn, view === "buy" && s.segBtnActive]}>
            <Feather name="shopping-cart" size={14} color={view === "buy" ? v2.color.forest : "#fff"} />
            <Text style={[s.segBtnTxt, view === "buy" && s.segBtnTxtActive]}>Do kupienia</Text>
          </Pressable>
          <Pressable onPress={() => setView("stock")} style={[s.segBtn, view === "stock" && s.segBtnActive]}>
            <Feather name="archive" size={14} color={view === "stock" ? v2.color.forest : "#fff"} />
            <Text style={[s.segBtnTxt, view === "stock" && s.segBtnTxtActive]}>Magazyn</Text>
          </Pressable>
        </View>
      </View>

      {view === "stock" ? (
        <MagazynView />
      ) : (
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={theme.color.brand} />}>
        {/* Quick ranges */}
        <View style={s.quickRow}>
          <Pressable onPress={() => setQuick("today")} style={s.qBtn}><Text style={s.qText}>Dzisiaj</Text></Pressable>
          <Pressable onPress={() => setQuick("tom")} style={s.qBtn}><Text style={s.qText}>Jutro</Text></Pressable>
          <Pressable onPress={() => setQuick("wknd")} style={s.qBtn}><Text style={s.qText}>Weekend</Text></Pressable>
          <Pressable onPress={() => setQuick("7d")} style={s.qBtn}><Text style={s.qText}>7 dni</Text></Pressable>
          <Pressable onPress={() => setQuick("30d")} style={s.qBtn}><Text style={s.qText}>30 dni</Text></Pressable>
        </View>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
          <TextInput value={dateFrom} onChangeText={setDateFrom} style={[s.input, { flex: 1 }]}
            {...(Platform.OS === "web" ? ({ type: "date" } as any) : {})} placeholder="od" />
          <TextInput value={dateTo} onChangeText={setDateTo} style={[s.input, { flex: 1 }]}
            {...(Platform.OS === "web" ? ({ type: "date" } as any) : {})} placeholder="do" />
        </View>

        {/* Expand toggle */}
        <Pressable onPress={() => setExpand(v => !v)} style={s.toggleRow}>
          <Feather name={expand ? "check-square" : "square"} size={16} color={expand ? theme.color.brand : theme.color.onSurfaceSecondary} />
          <Text style={s.toggleText}>Rozbij pakiety na surowce (feta, kiełbasa, ketchup...)</Text>
        </Pressable>

        {/* Summary hero */}
        <View style={s.hero}>
          <Text style={s.heroLabel}>ZAKUPY NA {dateFrom.slice(5)}–{dateTo.slice(5)}</Text>
          <View style={{ flexDirection: "row", gap: 12, marginTop: 6 }}>
            <View style={{ flex: 1 }}>
              <Text style={s.k}>Do kupienia</Text>
              <Text style={[s.v, { color: theme.color.brand }]}>{gen?.unique_to_buy ?? (gen?.suggestions?.filter((s: any) => (s.to_buy ?? s.qty) > 0).length || 0)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.k}>Szac. koszt</Text>
              <Text style={[s.v, { color: theme.color.brand }]}>{formatPLN(gen?.estimated_total || 0)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.k}>Kupione</Text>
              <Text style={[s.v, { color: theme.color.success }]}>{stats.bought}</Text>
            </View>
          </View>
          <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 6 }}>
            {gen?.event_count || 0} imprez · {gen?.total_people || 0} osób
            {gen?.expanded ? " · rozbicie na surowce ✓" : " · pakiety zbiorczo"}
          </Text>

          {/* Category totals chips */}
          {Object.keys(catTotals).length ? (
            <View style={s.chipsRow}>
              {CATS.filter(c => catTotals[c.id]).map(c => (
                <View key={c.id} style={[s.chip, { borderColor: c.color + "88", backgroundColor: c.color + "12" }]}>
                  <View style={[s.chipDot, { backgroundColor: c.color }]} />
                  <Text style={[s.chipTxt, { color: c.color }]}>{c.label}</Text>
                  <Text style={s.chipCnt}>{catTotals[c.id].count} · {formatPLN(catTotals[c.id].cost)}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {/* Auto-generated suggestions grouped by category */}
        {gen?.suggestions?.length ? (
          <View style={s.card}>
            <View style={s.rowBet}>
              <Text style={s.section}>🛒 Do kupienia ({toBuyCount})</Text>
              <Pressable onPress={acceptAll} style={s.accBtn}>
                <Text style={s.accBtnText}>Dodaj wszystkie</Text>
              </Pressable>
            </View>
            {CATS.filter(c => (sugByCat[c.id] || []).length > 0).map(c => (
              <View key={c.id} style={{ marginTop: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <View style={[s.catDot, { backgroundColor: c.color, width: 8, height: 8 }]} />
                  <Text style={s.subSection}>{c.label}</Text>
                </View>
                {sugByCat[c.id].map((sg: any, i: number) => {
                  const hasStock = (sg.stock_qty || 0) > 0;
                  const hasReserved = (sg.reserved_qty || 0) > 0;
                  const toBuy = sg.to_buy != null ? sg.to_buy : sg.qty;
                  const isCovered = toBuy <= 0;
                  const expBadge = sg.stock_expiry ? (
                    <Text style={{ color: "#B91C1C", fontSize: 10, fontWeight: "700" }}>  · 🔴 ważne do {sg.stock_expiry}</Text>
                  ) : null;
                  return (
                    <View key={i} style={[s.sugRow, isCovered && { opacity: 0.5 }]}>
                      <Pressable onPress={() => openEdit(sg)} style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                          <Text style={s.sugName}>{sg.name}</Text>
                          {sg.overridden ? (
                            <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, backgroundColor: "#F59E0B22" }}>
                              <Text style={{ color: "#B45309", fontSize: 9, fontWeight: "800" }}>RĘCZNIE</Text>
                            </View>
                          ) : null}
                        </View>
                        {(hasStock || hasReserved) ? (
                          <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 10 }}>
                            potrzeba {sg.needed} {sg.unit}
                            {hasStock ? ` · magazyn ${sg.stock_qty}` : ""}
                            {hasReserved ? ` · zarezerwowane ${sg.reserved_qty}` : ""}
                          </Text>
                        ) : null}
                        <Text style={[s.sugMeta, { color: isCovered ? theme.color.success : theme.color.onSurface, fontWeight: "700" }]}>
                          Do kupienia: {toBuy} {sg.unit}
                          {sg.unit_price ? ` · ${sg.unit_price.toFixed(2)}zł/${sg.unit} = ${formatPLN(sg.estimated_cost)}` : ""}
                          {isCovered ? " ✓" : ""}
                          {expBadge}
                        </Text>
                        {sg.event_names?.length ? (
                          <Text style={s.sugEv} numberOfLines={1}>{sg.event_names.join(" • ")}</Text>
                        ) : null}
                      </Pressable>
                      <Pressable onPress={() => openEdit(sg)} style={{ padding: 6 }} hitSlop={10}>
                        <Feather name="edit-2" size={14} color={theme.color.onSurfaceSecondary} />
                      </Pressable>
                      {!isCovered ? (
                        <Pressable onPress={() => acceptSuggestion(sg)} style={s.addBtn} hitSlop={10}>
                          <Feather name="plus" size={16} color={theme.color.brand} />
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        ) : (
          <Text style={{ color: theme.color.onSurfaceSecondary, textAlign: "center", padding: 16 }}>
            Brak imprez w wybranym zakresie dat lub brak pozycji do zakupu.
          </Text>
        )}

        {/* Items by category */}
        {items.length > 0 ? (
          <>
            <View style={{ marginTop: 18, marginBottom: 4 }}>
              <Text style={s.sectionTitle}>Moja lista zakupów</Text>
            </View>
            {CATS.filter(c => (byCat[c.id] || []).length > 0).map(c => (
              <View key={c.id} style={s.card}>
                <View style={s.rowBet}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <View style={[s.catDot, { backgroundColor: c.color, width: 10, height: 10 }]} />
                    <Text style={s.section}>{c.label} · {byCat[c.id].length}</Text>
                  </View>
                </View>
                {byCat[c.id].map(it => {
                  const missing = Math.max(0, it.qty - it.stock_qty);
                  return (
                    <View key={it.id} style={[s.itemRow, it.status !== "todo" && { opacity: 0.55 }]}>
                      <Pressable onPress={() => toggleStatus(it)} style={s.checkbox}>
                        <Feather
                          name={it.status === "todo" ? "square" : it.status === "bought" ? "check-square" : "check-circle"}
                          size={20}
                          color={it.status === "todo" ? theme.color.onSurfaceSecondary : theme.color.brand}
                        />
                      </Pressable>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.itName, it.status !== "todo" && { textDecorationLine: "line-through" }]}>{it.name}</Text>
                        <Text style={s.itMeta}>
                          {it.qty} {it.unit}{it.stock_qty ? ` (magazyn: ${it.stock_qty}, brak: ${missing})` : ""}
                          {it.unit_price ? ` · ~${formatPLN(missing * it.unit_price)}` : ""}
                        </Text>
                        {it.actual_price ? (
                          <Text style={{ color: theme.color.brand, fontSize: 11, fontWeight: "700" }}>
                            Zapłacone: {formatPLN(it.actual_price)}
                          </Text>
                        ) : null}
                      </View>
                      <Pressable onPress={() => api.shoppingDelete(it.id).then(load)} hitSlop={10}>
                        <Feather name="trash-2" size={14} color={theme.color.error} />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
      )}

      {/* === Inline edit sheet (qty / unit_price override) === */}
      <Modal visible={!!editSug} transparent animationType="slide" onRequestClose={() => setEditSug(null)}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
          <Pressable style={{ flex: 1 }} onPress={() => setEditSug(null)} />
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={{ backgroundColor: theme.color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: insets.bottom + 20 }}>
              <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.color.border, marginBottom: 12 }} />
              <Text style={{ fontSize: 18, fontWeight: "700", color: theme.color.onSurface }}>Edytuj: {editSug?.name}</Text>
              <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 4 }}>
                Auto wyliczyło: {editSug?.needed} {editSug?.unit}
                {editSug?.stock_qty ? ` · magazyn ${editSug.stock_qty}` : ""}
                {editSug?.reserved_qty ? ` · zarezerwowane ${editSug.reserved_qty}` : ""}
              </Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.k}>Ilość ({editSug?.unit})</Text>
                  <TextInput
                    value={editQty}
                    onChangeText={setEditQty}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={theme.color.onSurfaceSecondary}
                    style={s.input}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.k}>Cena jedn. (zł/{editSug?.unit})</Text>
                  <TextInput
                    value={editPrice}
                    onChangeText={setEditPrice}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={theme.color.onSurfaceSecondary}
                    style={s.input}
                  />
                </View>
              </View>
              <View style={{ marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: theme.color.brand + "10", borderWidth: 1, borderColor: theme.color.brand + "44" }}>
                <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 11, letterSpacing: 0.5, fontWeight: "700", textTransform: "uppercase" }}>Podgląd</Text>
                <Text style={{ color: theme.color.brand, fontSize: 16, fontWeight: "800", marginTop: 4 }}>
                  {editQty || 0} {editSug?.unit} × {parseFloat(editPrice.replace(",", ".")) || 0} zł = {formatPLN((parseFloat(editQty.replace(",", ".")) || 0) * (parseFloat(editPrice.replace(",", ".")) || 0))}
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
                {editSug?.overridden ? (
                  <Pressable onPress={resetOverride} style={{ paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.color.error }}>
                    <Text style={{ color: theme.color.error, fontWeight: "700", fontSize: 13 }}>Cofnij ręczne</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={saveOverride} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: theme.color.brand, alignItems: "center" }}>
                  <Text style={{ color: theme.color.onBrand, fontWeight: "800", fontSize: 14 }}>Zapisz</Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* === Recipes editor modal === */}
      <Modal visible={showRecipes} animationType="slide" onRequestClose={() => setShowRecipes(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: theme.color.surface }}>
          <View style={[s.header, { paddingTop: insets.top + 12 }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View>
                <Text style={s.brand}>Przepisy</Text>
                <Text style={s.title}>{editKey ? (labels[editKey] || editKey) : "Wszystkie pozycje"}</Text>
              </View>
              <Pressable onPress={() => { if (editKey) cancelEdit(); else setShowRecipes(false); }} style={s.closeBtn}>
                <Feather name="x" size={20} color={theme.color.onSurface} />
              </Pressable>
            </View>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
            {editKey ? (
              <View>
                <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 12, marginBottom: 8 }}>
                  Ilości podane <Text style={{ fontWeight: "700" }}>na 1 osobę</Text> — system pomnoży je przez liczbę osób każdej imprezy.
                </Text>
                {editRows.map((row, idx) => (
                  <View key={idx} style={s.editRow}>
                    <TextInput
                      value={row.name}
                      onChangeText={t => setEditRows(r => r.map((x, i) => i === idx ? { ...x, name: t } : x))}
                      placeholder="Nazwa składnika"
                      placeholderTextColor={theme.color.onSurfaceSecondary}
                      style={[s.input, { marginBottom: 4 }]}
                    />
                    <View style={{ flexDirection: "row", gap: 6 }}>
                      <TextInput
                        value={String(row.qty ?? "")}
                        onChangeText={t => setEditRows(r => r.map((x, i) => i === idx ? { ...x, qty: parseFloat(t.replace(",", ".")) || 0 } : x))}
                        placeholder="Ilość / os"
                        placeholderTextColor={theme.color.onSurfaceSecondary}
                        keyboardType="decimal-pad"
                        style={[s.input, { flex: 1 }]}
                      />
                      <View style={[s.input, { flex: 1, padding: 0, justifyContent: "center", overflow: "hidden" }]}>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: "center", paddingHorizontal: 4 }}>
                          {UNITS.map(u => (
                            <Pressable key={u} onPress={() => setEditRows(r => r.map((x, i) => i === idx ? { ...x, unit: u } : x))} style={[s.miniBtn, row.unit === u && s.miniBtnActive]}>
                              <Text style={[s.miniBtnTxt, row.unit === u && s.miniBtnTxtActive]}>{u}</Text>
                            </Pressable>
                          ))}
                        </ScrollView>
                      </View>
                      <TextInput
                        value={String(row.price ?? "")}
                        onChangeText={t => setEditRows(r => r.map((x, i) => i === idx ? { ...x, price: parseFloat(t.replace(",", ".")) || 0 } : x))}
                        placeholder="Cena / jedn."
                        placeholderTextColor={theme.color.onSurfaceSecondary}
                        keyboardType="decimal-pad"
                        style={[s.input, { flex: 1 }]}
                      />
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
                      {CATS.filter(c => !["catering","grill","dodatkowe","inne"].includes(c.id)).map(c => (
                        <Pressable key={c.id}
                          onPress={() => setEditRows(r => r.map((x, i) => i === idx ? { ...x, category: c.id } : x))}
                          style={[s.catChip, { borderColor: c.color + "88" }, row.category === c.id && { backgroundColor: c.color + "22", borderColor: c.color }]}>
                          <Text style={[s.catChipTxt, { color: row.category === c.id ? c.color : theme.color.onSurfaceSecondary }]}>{c.label}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                    <Pressable onPress={() => removeIngRow(idx)} style={{ position: "absolute", right: 6, top: 6 }} hitSlop={10}>
                      <Feather name="trash-2" size={14} color={theme.color.error} />
                    </Pressable>
                  </View>
                ))}
                <Pressable onPress={addIngRow} style={[s.accBtn, { marginTop: 12, alignSelf: "flex-start" }]}>
                  <Text style={s.accBtnText}>+ Dodaj składnik</Text>
                </Pressable>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
                  <Pressable onPress={saveEdit} style={[s.saveBtn, { flex: 1 }]}>
                    <Text style={s.saveBtnTxt}>Zapisz</Text>
                  </Pressable>
                  <Pressable onPress={resetToDefault} style={[s.resetBtn]}>
                    <Text style={s.resetBtnTxt}>Reset</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View>
                <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 12, marginBottom: 8 }}>
                  Kliknij pozycję żeby edytować rozbicie na surowce (ilości podane na 1 osobę).
                </Text>
                {Object.keys(labels).sort().map(k => (
                  <Pressable key={k} onPress={() => startEdit(k)} style={s.recipeRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.recipeName}>{labels[k]}</Text>
                      <Text style={s.recipeMeta}>{(recipes[k] || []).length} składników</Text>
                    </View>
                    <Feather name="chevron-right" size={18} color={theme.color.onSurfaceSecondary} />
                  </Pressable>
                ))}
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  rootLoading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: v2.color.bg },
  header: { paddingHorizontal: 20, paddingBottom: 14, backgroundColor: v2.color.forestDeep },
  brand: { color: v2.color.moss, letterSpacing: 3, fontSize: 10, fontWeight: "800", marginBottom: 4 },
  title: { color: v2.color.onDark, fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },
  headerBtn: { width: 38, height: 38, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  recipesBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: v2.color.forest, backgroundColor: v2.color.forest + "12" },
  recipesBtnText: { color: v2.color.forest, fontWeight: "700", fontSize: 12 },
  segRow: { flexDirection: "row", gap: 6, marginTop: 12, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: v2.radius.md, padding: 3 },
  segBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 9, borderRadius: v2.radius.sm },
  segBtnActive: { backgroundColor: v2.color.card },
  segBtnTxt: { color: "#fff", fontWeight: "800", fontSize: 12 },
  segBtnTxtActive: { color: v2.color.forest },
  quickRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  qBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: v2.color.forest + "44", backgroundColor: v2.color.mint },
  qText: { color: v2.color.forest, fontSize: 12, fontWeight: "700" },
  input: { paddingHorizontal: 10, paddingVertical: 9, borderRadius: v2.radius.md, borderWidth: 1, borderColor: v2.color.border, backgroundColor: v2.color.card, color: v2.color.text, fontSize: 13 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  toggleText: { color: v2.color.text, fontSize: 13 },
  hero: { marginTop: 8, borderRadius: v2.radius.xl, padding: 14, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, ...v2.shadow.sm },
  heroLabel: { color: v2.color.textSubtle, letterSpacing: 1, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  k: { color: v2.color.textSubtle, fontSize: 10, fontWeight: "700", letterSpacing: 0.3, textTransform: "uppercase" },
  v: { fontSize: 18, fontWeight: "800", marginTop: 2, color: v2.color.text },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  chipDot: { width: 6, height: 6, borderRadius: 999 },
  chipTxt: { fontSize: 11, fontWeight: "700" },
  chipCnt: { fontSize: 10, color: v2.color.textMuted },
  sectionTitle: { color: v2.color.text, fontSize: 16, fontWeight: "800" },
  card: { marginTop: 12, borderRadius: v2.radius.lg, padding: 14, borderWidth: 1, borderColor: v2.color.border, backgroundColor: v2.color.card, ...v2.shadow.sm },
  rowBet: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  section: { color: v2.color.text, fontSize: 14, fontWeight: "800" },
  subSection: { color: v2.color.textSubtle, fontSize: 11, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  accBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: v2.color.forest },
  accBtnText: { color: "#fff", fontWeight: "800", fontSize: 11 },
  sugRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: v2.color.divider },
  catDot: { width: 8, height: 8, borderRadius: 999 },
  sugName: { color: v2.color.text, fontSize: 13, fontWeight: "800" },
  sugMeta: { color: v2.color.textMuted, fontSize: 11 },
  sugEv: { color: v2.color.textSubtle, fontSize: 10, fontStyle: "italic", marginTop: 2 },
  addBtn: { width: 32, height: 32, borderRadius: 999, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: v2.color.forest, backgroundColor: v2.color.mint },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  checkbox: { padding: 2 },
  itName: { color: v2.color.text, fontSize: 13, fontWeight: "700" },
  itMeta: { color: v2.color.textMuted, fontSize: 11 },
  // Recipes editor
  closeBtn: { width: 36, height: 36, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: v2.color.cardMuted },
  recipeRow: { flexDirection: "row", alignItems: "center", padding: 12, marginBottom: 6, borderRadius: v2.radius.md, borderWidth: 1, borderColor: v2.color.border, backgroundColor: v2.color.card },
  recipeName: { color: v2.color.text, fontSize: 14, fontWeight: "800" },
  recipeMeta: { color: v2.color.textMuted, fontSize: 11, marginTop: 2 },
  editRow: { position: "relative", padding: 8, marginBottom: 6, borderRadius: v2.radius.md, borderWidth: 1, borderColor: v2.color.border, backgroundColor: v2.color.card },
  miniBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, marginRight: 4 },
  miniBtnActive: { backgroundColor: v2.color.forest + "22" },
  miniBtnTxt: { fontSize: 11, color: v2.color.textMuted, fontWeight: "600" },
  miniBtnTxtActive: { color: v2.color.forest },
  catChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1, marginRight: 4 },
  catChipTxt: { fontSize: 10, fontWeight: "700" },
  saveBtn: { padding: 12, borderRadius: v2.radius.md, backgroundColor: v2.color.forest, alignItems: "center" },
  saveBtnTxt: { color: "#fff", fontWeight: "800", fontSize: 14 },
  resetBtn: { padding: 12, borderRadius: v2.radius.md, borderWidth: 1, borderColor: v2.color.error, alignItems: "center", paddingHorizontal: 20 },
  resetBtnTxt: { color: v2.color.error, fontWeight: "700", fontSize: 14 },
});

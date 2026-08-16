import { useCallback, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl,
  TextInput, ActivityIndicator, Alert, Platform,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { theme, formatPLN } from "@/src/theme";
import { api } from "@/src/api";

type Item = {
  id: string; name: string; category: string; qty: number; unit: string;
  stock_qty: number; unit_price: number; actual_price?: number | null;
  status: "todo" | "bought" | "ready"; event_ids: string[]; event_names?: string[]; notes?: string;
};

const CATS: Array<{ id: string; label: string; color: string }> = [
  { id: "catering", label: "Catering", color: "#F59E0B" },
  { id: "grill", label: "Grill", color: "#EF4444" },
  { id: "napoje", label: "Napoje", color: "#3B82F6" },
  { id: "kawa", label: "Kawa/Herbata", color: "#8B5CF6" },
  { id: "jednorazowki", label: "Jednorazówki", color: "#10B981" },
  { id: "dekoracje", label: "Dekoracje", color: "#EC4899" },
  { id: "srodki", label: "Środki czystości", color: "#06B6D4" },
  { id: "dodatkowe", label: "Dodatkowe", color: "#6B7280" },
  { id: "inne", label: "Inne", color: "#9CA3AF" },
];
const catColor = (c: string) => (CATS.find(x => x.id === c)?.color || "#9CA3AF");
const catLabel = (c: string) => (CATS.find(x => x.id === c)?.label || c);

export default function Zakupy() {
  const insets = useSafeAreaInsets();
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(iso(today));
  const [dateTo, setDateTo] = useState(iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7)));
  const [items, setItems] = useState<Item[]>([]);
  const [gen, setGen] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [list, g]: any[] = await Promise.all([
        api.shoppingList(),
        api.shoppingGenerate(dateFrom, dateTo),
      ]);
      setItems(list || []);
      setGen(g);
    } catch {}
  }, [dateFrom, dateTo]);
  useFocusEffect(useCallback(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]));

  const setQuick = (m: "today" | "tom" | "wknd" | "7d") => {
    const now = new Date();
    if (m === "today") { const t = iso(now); setDateFrom(t); setDateTo(t); }
    else if (m === "tom") { const t = new Date(now); t.setDate(now.getDate() + 1); const s = iso(t); setDateFrom(s); setDateTo(s); }
    else if (m === "wknd") {
      const d = new Date(now);
      const dow = d.getDay(); // 0=nd, 6=sob
      const daysToSat = (6 - dow + 7) % 7;
      const sat = new Date(now); sat.setDate(now.getDate() + daysToSat);
      const sun = new Date(sat); sun.setDate(sat.getDate() + 1);
      setDateFrom(iso(sat)); setDateTo(iso(sun));
    }
    else if (m === "7d") { const t = new Date(now); t.setDate(now.getDate() + 7); setDateFrom(iso(now)); setDateTo(iso(t)); }
  };

  const acceptSuggestion = async (s: any) => {
    try {
      await api.shoppingAdd({
        name: s.name, category: s.category, qty: s.qty, unit: s.unit,
        unit_price: s.unit_price, event_ids: s.event_ids, event_names: s.event_names,
      });
      await load();
    } catch {}
  };
  const acceptAll = async () => {
    if (!gen?.suggestions?.length) return;
    for (const s of gen.suggestions) { try { await acceptSuggestion(s); } catch {} }
  };
  const toggleStatus = async (it: Item) => {
    const next = it.status === "todo" ? "bought" : it.status === "bought" ? "ready" : "todo";
    if (next === "bought" && (it.actual_price == null || it.actual_price === 0)) {
      // ask for actual price
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

  const filtered = useMemo(() => items, [items]);
  const byCat = useMemo(() => {
    const m: Record<string, Item[]> = {};
    filtered.forEach(it => { (m[it.category] = m[it.category] || []).push(it); });
    return m;
  }, [filtered]);
  const stats = useMemo(() => {
    const todo = filtered.filter(x => x.status === "todo");
    const bought = filtered.filter(x => x.status === "bought" || x.status === "ready");
    const estTodo = todo.reduce((s, x) => s + Math.max(0, (x.qty - x.stock_qty)) * (x.unit_price || 0), 0);
    const spentBought = bought.reduce((s, x) => s + (x.actual_price || 0), 0);
    return { todo: todo.length, bought: bought.length, estTodo, spentBought };
  }, [filtered]);

  if (loading) return <View style={s.rootLoading}><ActivityIndicator color={theme.color.brand} /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Text style={s.brand}>Zakupy</Text>
        <Text style={s.title}>Automatyczna lista</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={theme.color.brand} />}>
        {/* Quick ranges */}
        <View style={s.quickRow}>
          <Pressable onPress={() => setQuick("today")} style={s.qBtn}><Text style={s.qText}>Dzisiaj</Text></Pressable>
          <Pressable onPress={() => setQuick("tom")} style={s.qBtn}><Text style={s.qText}>Jutro</Text></Pressable>
          <Pressable onPress={() => setQuick("wknd")} style={s.qBtn}><Text style={s.qText}>Weekend</Text></Pressable>
          <Pressable onPress={() => setQuick("7d")} style={s.qBtn}><Text style={s.qText}>7 dni</Text></Pressable>
        </View>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
          <TextInput value={dateFrom} onChangeText={setDateFrom} style={[s.input, { flex: 1 }]}
            {...(Platform.OS === "web" ? ({ type: "date" } as any) : {})} placeholder="od" />
          <TextInput value={dateTo} onChangeText={setDateTo} style={[s.input, { flex: 1 }]}
            {...(Platform.OS === "web" ? ({ type: "date" } as any) : {})} placeholder="do" />
        </View>

        {/* Summary hero */}
        <View style={s.hero}>
          <Text style={s.heroLabel}>ZAKUPY NA {dateFrom.slice(5)}–{dateTo.slice(5)}</Text>
          <View style={{ flexDirection: "row", gap: 12, marginTop: 6 }}>
            <View style={{ flex: 1 }}>
              <Text style={s.k}>Do kupienia</Text>
              <Text style={[s.v, { color: theme.color.warning }]}>{stats.todo}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.k}>Szacowany koszt</Text>
              <Text style={[s.v, { color: theme.color.brand }]}>{formatPLN(stats.estTodo)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.k}>Kupione</Text>
              <Text style={[s.v, { color: theme.color.success }]}>{stats.bought}</Text>
            </View>
          </View>
          <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 6 }}>
            {gen?.event_count || 0} imprez · {gen?.total_people || 0} osób w tym zakresie
          </Text>
        </View>

        {/* Auto-generated suggestions */}
        {gen?.suggestions?.length ? (
          <View style={s.card}>
            <View style={s.rowBet}>
              <Text style={s.section}>🤖 Automatyczne sugestie ({gen.suggestions.length})</Text>
              <Pressable onPress={acceptAll} style={s.accBtn}>
                <Text style={s.accBtnText}>Dodaj wszystkie</Text>
              </Pressable>
            </View>
            {gen.suggestions.slice(0, 20).map((sg: any, i: number) => (
              <View key={i} style={s.sugRow}>
                <View style={[s.catDot, { backgroundColor: catColor(sg.category) }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.sugName}>{sg.name}</Text>
                  <Text style={s.sugMeta}>{sg.qty} {sg.unit} · {catLabel(sg.category)} · ~{formatPLN(sg.estimated_cost)}</Text>
                  {sg.event_names?.length ? (
                    <Text style={s.sugEv} numberOfLines={2}>{sg.event_names.join(" • ")}</Text>
                  ) : null}
                </View>
                <Pressable onPress={() => acceptSuggestion(sg)} style={s.addBtn} hitSlop={10}>
                  <Feather name="plus" size={16} color={theme.color.brand} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        {/* Items by category */}
        {Object.keys(byCat).length === 0 ? (
          <Text style={{ color: theme.color.onSurfaceSecondary, textAlign: "center", padding: 16 }}>
            Lista pusta — dodaj sugestie powyżej lub wpisz ręcznie.
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
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  rootLoading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.surface },
  header: { paddingHorizontal: 20, paddingBottom: 8 },
  brand: { color: theme.color.onSurfaceSecondary, letterSpacing: 3, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  title: { color: theme.color.onSurface, fontSize: 24, fontWeight: "700" },
  quickRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  qBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: theme.color.brand, backgroundColor: theme.color.brand + "12" },
  qText: { color: theme.color.brand, fontSize: 12, fontWeight: "700" },
  input: { paddingHorizontal: 10, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface, color: theme.color.onSurface, fontSize: 13 },
  hero: { marginTop: 10, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: theme.color.brand + "44", backgroundColor: theme.color.brand + "0A" },
  heroLabel: { color: theme.color.onSurfaceSecondary, letterSpacing: 1, fontSize: 10, fontWeight: "700" },
  k: { color: theme.color.onSurfaceSecondary, fontSize: 10 },
  v: { fontSize: 18, fontWeight: "800" },
  card: { marginTop: 12, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface },
  rowBet: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  section: { color: theme.color.onSurface, fontSize: 13, fontWeight: "700" },
  accBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: theme.color.brand },
  accBtnText: { color: theme.color.onBrand, fontWeight: "700", fontSize: 11 },
  sugRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: theme.color.divider },
  catDot: { width: 8, height: 8, borderRadius: 999 },
  sugName: { color: theme.color.onSurface, fontSize: 13, fontWeight: "700" },
  sugMeta: { color: theme.color.onSurfaceSecondary, fontSize: 11 },
  sugEv: { color: theme.color.onSurfaceSecondary, fontSize: 10, fontStyle: "italic", marginTop: 2 },
  addBtn: { width: 32, height: 32, borderRadius: 999, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.color.brand, backgroundColor: theme.color.brand + "12" },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  checkbox: { padding: 2 },
  itName: { color: theme.color.onSurface, fontSize: 13, fontWeight: "700" },
  itMeta: { color: theme.color.onSurfaceSecondary, fontSize: 11 },
});

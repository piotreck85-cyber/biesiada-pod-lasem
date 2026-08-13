import { useCallback, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, FlatList, ActivityIndicator,
  RefreshControl, TextInput,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme, formatPLN } from "@/src/theme";
import { api } from "@/src/api";
import { categoryLabel, categoryTopGroup } from "@/src/categories";
import { findAdultSet } from "@/src/offers";

type FilterKey = "all" | "Dorośli" | "Dzieci" | "Warsztaty" | "upcoming" | "past" | "profitable" | "loss" | "none";
type SortKey = "created" | "date" | "name" | "revenue" | "profit";
type SortDir = "asc" | "desc";

const FILTER_CHIPS: { id: FilterKey; label: string; icon: string }[] = [
  { id: "all",         label: "Wszystkie",     icon: "list" },
  { id: "upcoming",    label: "Nadchodzące",   icon: "clock" },
  { id: "past",        label: "Odbyte",        icon: "check-circle" },
  { id: "Dorośli",     label: "Dorośli",       icon: "users" },
  { id: "Dzieci",      label: "Dzieci",        icon: "smile" },
  { id: "Warsztaty",   label: "Warsztaty",     icon: "feather" },
  { id: "profitable",  label: "Zyskowne",      icon: "trending-up" },
  { id: "loss",        label: "Ze stratą",     icon: "trending-down" },
  { id: "none",        label: "Bez kategorii", icon: "help-circle" },
];

function formatTimeRange(start?: string, end?: string, legacy?: string): string {
  const compact = (t?: string) => {
    if (!t) return "";
    const [h, m] = t.split(":");
    return m && m !== "00" ? `${parseInt(h, 10)}:${m}` : `${parseInt(h, 10)}`;
  };
  if (start && end) return `${compact(start)}–${compact(end)}`;
  if (start) return compact(start);
  return legacy || "—";
}

function relativeTime(iso?: string) {
  if (!iso) return "";
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diff = Math.max(0, now - then);
    const min = Math.floor(diff / 60000);
    if (min < 1) return "przed chwilą";
    if (min < 60) return `${min} min temu`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} godz. temu`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d} dni temu`;
    const w = Math.floor(d / 7);
    if (w < 5) return `${w} tyg. temu`;
    return new Date(iso).toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
  } catch { return ""; }
}

export default function Ostatnie() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sortKey, setSortKey] = useState<SortKey>("created");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try { setEvents(await api.listEvents()); } catch {}
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]));

  const visible = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    let arr = [...events];

    // Search (name, category, venue, notes)
    const q = search.trim().toLowerCase();
    if (q) {
      arr = arr.filter(e =>
        (e.name || "").toLowerCase().includes(q) ||
        (categoryLabel(e.category) || "").toLowerCase().includes(q) ||
        (e.venue || "").toLowerCase().includes(q) ||
        (e.notes || "").toLowerCase().includes(q)
      );
    }
    // Filter chip
    if (filter === "upcoming") arr = arr.filter(e => (e.date || "") >= todayStr);
    else if (filter === "past") arr = arr.filter(e => (e.date || "") < todayStr);
    else if (filter === "profitable") arr = arr.filter(e => (e.profit || 0) > 0);
    else if (filter === "loss") arr = arr.filter(e => (e.profit || 0) < 0);
    else if (filter === "none") arr = arr.filter(e => !e.category);
    else if (filter === "Dorośli" || filter === "Dzieci" || filter === "Warsztaty") {
      arr = arr.filter(e => categoryTopGroup(e.category) === filter);
    }

    // Sort
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "created") {
        cmp = new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
      } else if (sortKey === "date") {
        cmp = (a.date || "").localeCompare(b.date || "");
      } else if (sortKey === "name") {
        cmp = (a.name || "").localeCompare(b.name || "", "pl");
      } else if (sortKey === "revenue") {
        cmp = (a.revenue || 0) - (b.revenue || 0);
      } else if (sortKey === "profit") {
        cmp = (a.profit || 0) - (b.profit || 0);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [events, filter, sortKey, sortDir, search]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "created" || key === "date" ? "desc" : "desc"); }
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]} testID="events-screen">
      <View style={s.header}>
        <Text style={s.brand}>Ostatnie</Text>
        <Text style={s.title}>Najnowsze wpisy</Text>
      </View>

      {/* Search */}
      <View style={s.searchWrap}>
        <View style={s.searchBox}>
          <Feather name="search" size={14} color={theme.color.onSurfaceSecondary} />
          <TextInput
            testID="events-search"
            value={search}
            onChangeText={setSearch}
            placeholder="Szukaj imprezy, kategorii, miejsca..."
            placeholderTextColor={theme.color.onSurfaceSecondary}
            style={s.searchInput}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")} hitSlop={10}>
              <Feather name="x" size={14} color={theme.color.onSurfaceSecondary} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Sort chips */}
      <View style={s.chipGrid}>
        {([
          { k: "created", label: "Dodano", icon: "plus-square" },
          { k: "date",    label: "Data",   icon: "calendar" },
          { k: "name",    label: "Nazwa",  icon: "type" },
          { k: "revenue", label: "Przychód", icon: "dollar-sign" },
          { k: "profit",  label: "Zysk",   icon: "trending-up" },
        ] as const).map(o => {
          const active = sortKey === o.k;
          return (
            <Pressable
              key={o.k}
              testID={`events-sort-${o.k}`}
              onPress={() => toggleSort(o.k)}
              style={[s.sortChip, active && s.sortChipActive]}
            >
              <Feather name={o.icon as any} size={11} color={active ? theme.color.onBrand : theme.color.onSurfaceSecondary} />
              <Text style={[s.sortChipText, active && s.sortChipTextActive]}>{o.label}</Text>
              {active && (
                <Feather name={sortDir === "asc" ? "arrow-up" : "arrow-down"} size={11} color={theme.color.onBrand} />
              )}
            </Pressable>
          );
        })}
      </View>

      {/* Filter chips */}
      <View style={s.chipGrid}>
        {FILTER_CHIPS.map(c => {
          const active = filter === c.id;
          return (
            <Pressable
              key={c.id}
              testID={`filter-chip-${c.id}`}
              onPress={() => setFilter(c.id)}
              style={[s.chip, active && s.chipActive]}
            >
              <Feather name={c.icon as any} size={11} color={active ? theme.color.onBrand : theme.color.onSurfaceSecondary} />
              <Text style={[s.chipText, active && s.chipTextActive]}>{c.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <ActivityIndicator color={theme.color.brand} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={theme.color.brand} />}
          ListHeaderComponent={
            visible.length > 0 ? (
              <Text style={s.countHint}>{visible.length} z {events.length} wpisów</Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={s.emptyBox}>
              <Feather name="inbox" size={40} color={theme.color.onSurfaceSecondary} />
              <Text style={s.emptyTitle}>
                {events.length === 0 ? "Brak imprez" : "Brak wyników"}
              </Text>
              <Text style={s.emptySub}>
                {events.length === 0
                  ? "Dotknij przycisk +, aby dodać pierwszą imprezę."
                  : "Zmień kryteria wyszukiwania lub filtr."}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`event-card-${item.id}`}
              style={s.row}
              onPress={() => router.push({ pathname: "/event/[id]", params: { id: item.id } })}
            >
              <View style={s.rowDate}>
                <Text style={s.rowDateDay}>
                  {(() => { try { return new Date(item.date).getDate(); } catch { return "?"; } })()}
                </Text>
                <Text style={s.rowDateMonth}>
                  {(() => { try { return new Date(item.date).toLocaleDateString("pl-PL", { month: "short" }).replace(".", ""); } catch { return ""; } })()}
                </Text>
                <Text style={s.rowDateYear}>
                  {(() => { try { return String(new Date(item.date).getFullYear()); } catch { return ""; } })()}
                </Text>
              </View>

              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.rowName} numberOfLines={1}>{item.name || "Bez nazwy"}</Text>
                <View style={s.rowMeta}>
                  {item.category ? (
                    <View style={s.metaChip}>
                      <Text style={s.metaChipText}>{categoryLabel(item.category)}</Text>
                    </View>
                  ) : null}
                  {item.package_set && findAdultSet(item.package_set) ? (
                    <View style={[s.metaChip, { borderColor: theme.color.brand }]}>
                      <Text style={[s.metaChipText, { color: theme.color.brand }]}>
                        {findAdultSet(item.package_set)!.name}{item.people ? ` · ${item.people}os.` : ""}
                      </Text>
                    </View>
                  ) : null}
                  {(item.time_start || item.time) ? (
                    <Text style={s.rowSub}>{formatTimeRange(item.time_start, item.time_end, item.time)}</Text>
                  ) : null}
                  {item.created_by_name ? (
                    <Text style={s.rowSubMuted}>· {item.created_by_name}</Text>
                  ) : null}
                </View>
                {sortKey === "created" && item.created_at ? (
                  <Text style={s.rowAdded}>Dodano {relativeTime(item.created_at)}</Text>
                ) : null}
              </View>

              <View style={{ alignItems: "flex-end", marginLeft: 8 }}>
                <Text
                  style={[
                    s.rowProfit,
                    { color: (item.profit ?? 0) > 0 ? theme.color.brand : (item.profit ?? 0) < 0 ? theme.color.error : theme.color.onSurfaceSecondary },
                  ]}
                >
                  {formatPLN(item.profit || 0)}
                </Text>
                <Text style={s.rowProfitSub}>zysk</Text>
              </View>
              <Feather name="chevron-right" size={18} color={theme.color.onSurfaceSecondary} style={{ marginLeft: 6 }} />
            </Pressable>
          )}
        />
      )}

      <Pressable
        testID="fab-new-event"
        style={[s.fab, { bottom: insets.bottom + 80 }]}
        onPress={() => router.push({ pathname: "/event/[id]", params: { id: "new" } })}
      >
        <Feather name="plus" size={24} color={theme.color.onBrand} />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: 20, paddingBottom: 8, paddingTop: 8 },
  brand: { color: theme.color.onSurfaceSecondary, letterSpacing: 3, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  title: { color: theme.color.onSurface, fontSize: 24, fontWeight: "700" },
  searchWrap: { paddingHorizontal: 20, paddingBottom: 8 },
  searchBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: theme.color.surfaceTertiary,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: theme.color.border,
  },
  searchInput: { flex: 1, color: theme.color.onSurface, fontSize: 14, padding: 0 },
  sortChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    backgroundColor: theme.color.surfaceTertiary,
    borderWidth: 1, borderColor: theme.color.border,
  },
  sortChipActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  sortChipText: { color: theme.color.onSurfaceSecondary, fontSize: 11, fontWeight: "700" },
  sortChipTextActive: { color: theme.color.onBrand },
  chipsRow: { height: 44, marginBottom: 4, flexGrow: 0 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    borderWidth: 1, borderColor: theme.color.border,
    backgroundColor: theme.color.surfaceSecondary,
    flexShrink: 0,
  },
  chipActive: { borderColor: theme.color.brand, backgroundColor: theme.color.brand },
  chipText: { color: theme.color.onSurfaceSecondary, fontSize: 11, fontWeight: "600" },
  chipTextActive: { color: theme.color.onBrand },
  countHint: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginBottom: 10, marginLeft: 4, letterSpacing: 0.5 },

  // ---- Chip grid (wraps into rows so ALL chips fit without horizontal scroll) ----
  chipGrid: {
    paddingHorizontal: 20,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 8,
  },

  // ---- Compact row list ----
  row: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: 14, borderWidth: 1, borderColor: theme.color.border,
    paddingVertical: 12, paddingHorizontal: 12, marginBottom: 8,
    gap: 12,
  },
  rowDate: {
    width: 52, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(212,175,55,0.10)",
    borderRadius: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: "rgba(212,175,55,0.35)",
  },
  rowDateDay: { color: theme.color.brand, fontSize: 20, fontWeight: "800", lineHeight: 22 },
  rowDateMonth: { color: theme.color.brand, fontSize: 10, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
  rowDateYear: { color: theme.color.onSurfaceSecondary, fontSize: 9, fontWeight: "600", marginTop: 1 },
  rowName: { color: theme.color.onSurface, fontSize: 15, fontWeight: "700", marginBottom: 4 },
  rowMeta: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  metaChip: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999,
    borderWidth: 1, borderColor: theme.color.borderStrong,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  metaChipText: { color: theme.color.onSurface, fontSize: 10, fontWeight: "700", letterSpacing: 0.3 },
  rowSub: { color: theme.color.onSurfaceSecondary, fontSize: 11, fontWeight: "600" },
  rowSubMuted: { color: theme.color.onSurfaceSecondary, fontSize: 10, fontWeight: "500", opacity: 0.7 },
  rowAdded: { color: theme.color.brand, fontSize: 10, fontWeight: "600", marginTop: 3, letterSpacing: 0.3, fontStyle: "italic" },
  rowProfit: { fontSize: 14, fontWeight: "800" },
  rowProfitSub: { color: theme.color.onSurfaceSecondary, fontSize: 9, letterSpacing: 0.5, textTransform: "uppercase" },

  authorChip: {
    alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
  },
  authorText: { color: theme.color.onSurfaceSecondary, fontSize: 10, fontWeight: "600" },
  emptyBox: { marginTop: 60, alignItems: "center", paddingHorizontal: 40 },
  emptyTitle: { color: theme.color.onSurface, fontSize: 17, fontWeight: "700", marginTop: 16, textAlign: "center" },
  emptySub: { color: theme.color.onSurfaceSecondary, marginTop: 8, textAlign: "center", lineHeight: 20 },
  fab: {
    position: "absolute", right: 20, width: 56, height: 56, borderRadius: 28,
    backgroundColor: theme.color.brand, alignItems: "center", justifyContent: "center",
    shadowColor: theme.color.brand, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.5, shadowRadius: 12,
    elevation: 8,
  },
});

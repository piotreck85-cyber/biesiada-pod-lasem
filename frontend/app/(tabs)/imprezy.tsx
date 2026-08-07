import { useCallback, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, FlatList, ActivityIndicator, RefreshControl, ScrollView,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme, formatPLN } from "@/src/theme";
import { api } from "@/src/api";
import { categoryLabel, categoryTopGroup } from "@/src/categories";

const FILTER_CHIPS: { id: string; label: string }[] = [
  { id: "all",       label: "Wszystkie" },
  { id: "Dorośli",   label: "Dorośli" },
  { id: "Dzieci",    label: "Dzieci" },
  { id: "none",      label: "Bez kategorii" },
];

const FALLBACK_IMG = "https://images.unsplash.com/photo-1576514129883-2f1d47a65da6?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxOTF8MHwxfHNlYXJjaHwxfHxtb2Rlcm4lMjBldmVudCUyMHN0YWdlJTIwbGlnaHRpbmclMjBkYXJrfGVufDB8fHx8MTc4NjExOTQ3NXww&ixlib=rb-4.1.0&q=85";

function fmtDate(d: string) {
  try {
    return new Date(d).toLocaleDateString("pl-PL", { day: "numeric", month: "long", year: "numeric" });
  } catch { return d; }
}

export default function Imprezy() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  const load = useCallback(async () => {
    try { setEvents(await api.listEvents()); } catch {}
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]));

  const filtered = useMemo(() => {
    if (filter === "all") return events;
    if (filter === "none") return events.filter(e => !e.category);
    return events.filter(e => categoryTopGroup(e.category) === filter);
  }, [events, filter]);

  return (
    <View style={[s.root, { paddingTop: insets.top }]} testID="events-screen">
      <View style={s.header}>
        <Text style={s.brand}>Imprezy</Text>
        <Text style={s.title}>Wszystkie wydarzenia</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.chipsRow}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 8, alignItems: "center" }}
      >
        {FILTER_CHIPS.map(c => {
          const active = filter === c.id;
          return (
            <Pressable
              key={c.id}
              testID={`filter-chip-${c.id}`}
              onPress={() => setFilter(c.id)}
              style={[s.chip, active && s.chipActive]}
            >
              <Text style={[s.chipText, active && s.chipTextActive]}>{c.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <ActivityIndicator color={theme.color.brand} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={theme.color.brand} />}
          ListEmptyComponent={
            <View style={s.emptyBox}>
              <Feather name="calendar" size={40} color={theme.color.onSurfaceSecondary} />
              <Text style={s.emptyTitle}>{filter === "all" ? "Nie masz jeszcze żadnych imprez" : "Brak imprez w tej kategorii"}</Text>
              <Text style={s.emptySub}>Dotknij przycisk poniżej, aby dodać pierwszą imprezę.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`event-card-${item.id}`}
              style={s.card}
              onPress={() => router.push({ pathname: "/event/[id]", params: { id: item.id } })}
            >
              <Image source={item.image_url || FALLBACK_IMG} style={StyleSheet.absoluteFill} contentFit="cover" />
              <LinearGradient
                colors={["rgba(12,12,14,0.05)", "rgba(12,12,14,0.85)", "rgba(12,12,14,0.98)"]}
                locations={[0, 0.55, 1]}
                style={StyleSheet.absoluteFill}
              />
              <View style={s.cardContent}>
                <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  <View style={s.dateChip}>
                    <Text style={s.dateChipText}>{fmtDate(item.date)}</Text>
                  </View>
                  {item.category ? (
                    <View style={s.catChip}>
                      <Text style={s.catChipText}>{categoryLabel(item.category)}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={s.cardName} numberOfLines={2}>{item.name}</Text>
                <Text style={s.cardVenue} numberOfLines={1}>{item.venue || "Bez lokalizacji"}  ·  {item.time || "—"}</Text>
                <View style={s.finRow}>
                  <View>
                    <Text style={s.finLabel}>Przychód</Text>
                    <Text style={s.finVal}>{formatPLN(item.revenue)}</Text>
                  </View>
                  <View>
                    <Text style={s.finLabel}>Koszty</Text>
                    <Text style={[s.finVal, { color: theme.color.error }]}>{formatPLN(item.total_cost)}</Text>
                  </View>
                  <View>
                    <Text style={s.finLabel}>Zysk</Text>
                    <Text style={[s.finVal, { color: item.profit >= 0 ? theme.color.brand : theme.color.error }]}>{formatPLN(item.profit)}</Text>
                  </View>
                </View>
              </View>
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
  card: {
    height: 200, borderRadius: 20, overflow: "hidden", marginBottom: 14,
    backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border,
  },
  cardContent: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 16 },
  dateChip: {
    alignSelf: "flex-start", backgroundColor: "rgba(212,175,55,0.15)",
    borderColor: theme.color.brand, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
  },
  dateChipText: { color: theme.color.brand, fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  catChip: {
    alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.08)",
    borderColor: theme.color.borderStrong, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
  },
  catChipText: { color: theme.color.onSurface, fontSize: 11, fontWeight: "600" },
  chipsRow: { height: 56, marginBottom: 4, flexGrow: 0 },
  chip: {
    height: 36, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1,
    borderColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  chipActive: { borderColor: theme.color.brand, backgroundColor: theme.color.brand },
  chipText: { color: theme.color.onSurfaceSecondary, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: theme.color.onBrand },
  cardName: { color: theme.color.onSurface, fontSize: 20, fontWeight: "700", marginBottom: 4 },
  cardVenue: { color: theme.color.onSurfaceTertiary, fontSize: 12, marginBottom: 12 },
  finRow: { flexDirection: "row", justifyContent: "space-between" },
  finLabel: { color: theme.color.onSurfaceSecondary, fontSize: 10, letterSpacing: 1, marginBottom: 2 },
  finVal: { color: theme.color.onSurface, fontSize: 14, fontWeight: "700" },
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

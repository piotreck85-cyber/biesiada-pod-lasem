import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { api } from "@/src/api";
import { theme } from "@/src/theme";

type EventRow = {
  id: string;
  name: string;
  date: string;
  time_start?: string;
  time_end?: string;
  status?: string;
  category?: string;
  location?: string;
  tasks_total: number;
  tasks_done: number;
};

const MS_DAY = 86400 * 1000;

function dateChip(iso: string): { label: string; tone: "today" | "tomorrow" | "soon" | "later" } {
  if (!iso) return { label: "", tone: "later" };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(iso + "T00:00:00");
  const diff = Math.round((d.getTime() - today.getTime()) / MS_DAY);
  if (diff <= 0) return { label: "Dziś", tone: "today" };
  if (diff === 1) return { label: "Jutro", tone: "tomorrow" };
  if (diff <= 3) return { label: `Za ${diff} dni`, tone: "soon" };
  return { label: d.toLocaleDateString("pl-PL", { weekday: "short", day: "numeric", month: "short" }), tone: "later" };
}

const toneColor = (t: string) => t === "today" ? theme.color.error :
                                  t === "tomorrow" ? theme.color.warning :
                                  t === "soon" ? theme.color.brand :
                                  theme.color.onSurfaceSecondary;

export default function ZadaniaScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [rows, setRows] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const r: any = await api.myChecklists(14);
      setRows(Array.isArray(r) ? r : []);
    } catch (e: any) {
      setError(e?.message || "Błąd ładowania");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Text style={s.brand}>Zadania</Text>
        <Text style={s.title}>Checklisty imprez</Text>
        <Text style={s.sub}>Nadchodzące imprezy · najbliższe 14 dni</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.color.brand} />}
      >
        {loading ? (
          <ActivityIndicator color={theme.color.brand} style={{ marginTop: 40 }} />
        ) : error ? (
          <View style={s.emptyCard}>
            <Feather name="alert-triangle" size={36} color={theme.color.error} />
            <Text style={s.emptyTitle}>Błąd</Text>
            <Text style={s.emptyText}>{error}</Text>
            <Pressable onPress={load} style={s.retryBtn}>
              <Text style={s.retryText}>Spróbuj ponownie</Text>
            </Pressable>
          </View>
        ) : rows.length === 0 ? (
          <View style={s.emptyCard}>
            <Feather name="check-square" size={44} color={theme.color.onSurfaceSecondary} />
            <Text style={s.emptyTitle}>Brak nadchodzących imprez</Text>
            <Text style={s.emptyText}>
              Kiedy administrator przypisze Cię do imprezy, tu pojawi się jej checklista.
            </Text>
          </View>
        ) : (
          rows.map(ev => {
            const chip = dateChip(ev.date);
            const pct = ev.tasks_total > 0 ? Math.round(ev.tasks_done * 100 / ev.tasks_total) : 0;
            const complete = ev.tasks_total > 0 && ev.tasks_done >= ev.tasks_total;
            return (
              <Pressable
                key={ev.id}
                onPress={() => router.push({ pathname: "/checklist/[id]", params: { id: ev.id } } as any)}
                style={({ pressed }) => [s.card, complete && s.cardComplete, pressed && { opacity: 0.7 }]}
                testID={`checklist-event-${ev.id}`}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", gap: 6, alignItems: "center", marginBottom: 4 }}>
                      <View style={[s.chip, { backgroundColor: toneColor(chip.tone) + "18" }]}>
                        <Text style={[s.chipText, { color: toneColor(chip.tone) }]}>{chip.label}</Text>
                      </View>
                      {ev.time_start ? (
                        <Text style={s.timeText}>{ev.time_start}{ev.time_end ? `–${ev.time_end}` : ""}</Text>
                      ) : null}
                    </View>
                    <Text style={s.eventName} numberOfLines={1}>{ev.name || "Impreza"}</Text>
                    {ev.location ? (
                      <Text style={s.locText} numberOfLines={1}>
                        <Feather name="map-pin" size={10} color={theme.color.onSurfaceSecondary} /> {ev.location}
                      </Text>
                    ) : null}
                  </View>
                  <View style={s.badge}>
                    {complete ? <Feather name="check-circle" size={16} color={theme.color.brand} /> : null}
                    <Text style={[s.badgeText, complete && { color: theme.color.brand }]}>{ev.tasks_done}/{ev.tasks_total}</Text>
                  </View>
                </View>
                {ev.tasks_total > 0 && (
                  <View style={s.barBg}>
                    <View style={[s.barFill, { width: `${pct}%`, backgroundColor: complete ? theme.color.brand : theme.color.brand + "AA" }]} />
                  </View>
                )}
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  brand: { color: theme.color.onSurfaceSecondary, letterSpacing: 3, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  title: { color: theme.color.onSurface, fontSize: 24, fontWeight: "800" },
  sub: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  emptyCard: {
    alignItems: "center", padding: 30, marginTop: 40, borderRadius: 16,
    borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary, gap: 6,
  },
  emptyTitle: { color: theme.color.onSurface, fontSize: 16, fontWeight: "700", marginTop: 6 },
  emptyText: { color: theme.color.onSurfaceSecondary, fontSize: 12, textAlign: "center", lineHeight: 18, maxWidth: 300 },
  retryBtn: { marginTop: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: theme.color.brand + "18" },
  retryText: { color: theme.color.brand, fontWeight: "700", fontSize: 12 },

  card: {
    padding: 14, marginBottom: 10, borderRadius: 14,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: 1, borderColor: theme.color.border,
  },
  cardComplete: { borderColor: theme.color.brand + "55", backgroundColor: theme.color.brand + "08" },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  chipText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  timeText: { color: theme.color.onSurfaceSecondary, fontSize: 11, fontWeight: "600" },
  eventName: { color: theme.color.onSurface, fontSize: 15, fontWeight: "700" },
  locText: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    backgroundColor: theme.color.divider,
  },
  badgeText: { color: theme.color.onSurface, fontSize: 12, fontWeight: "800" },
  barBg: { height: 6, borderRadius: 3, backgroundColor: theme.color.divider, marginTop: 10, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3 },
});

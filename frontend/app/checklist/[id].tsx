import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import EventChecklist from "@/src/components/EventChecklist";

export default function EventChecklistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [meta, setMeta] = useState<{ name?: string; date?: string; time_start?: string; time_end?: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const r: any = await api.getEventChecklist(String(id));
        setMeta(r?.event || null);
      } catch {}
    })();
  }, [id]);

  const dateLabel = meta?.date
    ? new Date(meta.date + "T00:00:00").toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" })
    : "";

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.brand}>Zadania</Text>
          <Text style={s.title} numberOfLines={1}>{meta?.name || "Impreza"}</Text>
          {(dateLabel || meta?.time_start) && (
            <Text style={s.sub}>
              {dateLabel}{meta?.time_start ? ` · ${meta.time_start}${meta?.time_end ? `–${meta.time_end}` : ""}` : ""}
            </Text>
          )}
        </View>
      </View>

      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 12 }}>
        {id ? <EventChecklist eventId={String(id)} /> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 12, paddingBottom: 8, flexDirection: "row", alignItems: "center", gap: 6 },
  backBtn: { padding: 6, marginTop: 6 },
  brand: { color: theme.color.onSurfaceSecondary, letterSpacing: 3, fontSize: 10, fontWeight: "700", marginBottom: 2 },
  title: { color: theme.color.onSurface, fontSize: 20, fontWeight: "800" },
  sub: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
});

import { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { v2 } from "@/src/designTokensV2";

type Entry = { id: string; at: string; user_id: string; user_name: string; action: string; summary?: string; entity_id?: string; entity_type?: string; section?: string };
const actions: Record<string, string> = { visit: "Wejście do sekcji", view_event: "Otwarcie imprezy", login: "Logowanie", create: "Dodanie", update: "Zmiana", delete: "Usunięcie" };
export default function TeamActivity() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const owner = !!user && user.role !== "staff" && user.id === (user.workspace_id || user.id);
  const [days, setDays] = useState(7);
  const [kind, setKind] = useState<"all" | "login" | "browsing">("all");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Entry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (!owner || authLoading) return;
    const current = ++generation.current;
    setLoading(true); setError(""); setRows([]);
    try {
      const result: any = await api.activity(days, "", kind);
      if (current === generation.current) { setRows(result.items || []); setTruncated(!!result.truncated); }
    } catch { if (current === generation.current) setError("Nie udało się pobrać aktywności. Spróbuj ponownie."); }
    finally { if (current === generation.current) setLoading(false); }
  }, [owner, authLoading, days, kind, user?.id]);
  useFocusEffect(useCallback(() => { void refresh(); return () => { generation.current++; }; }, [refresh]));
  const filtered = rows.filter(row => `${row.user_name} ${row.summary || ""} ${actions[row.action] || row.action}`.toLocaleLowerCase("pl").includes(query.toLocaleLowerCase("pl")));
  return <View style={[s.root, { paddingTop: insets.top + 12 }]}>
    <View style={s.header}>
      <Pressable accessibilityLabel="Wróć" onPress={() => router.back()} style={s.button}><Feather name="chevron-left" size={24} color={v2.color.forest} /></Pressable>
      <Text style={s.title}>Aktywność zespołu</Text>
    </View>
    {authLoading ? <ActivityIndicator /> : !owner ? <Text style={s.message}>Ten panel jest dostępny tylko dla właściciela.</Text> : <>
      <View style={s.filters}>
        <Text style={s.help}>Historia logowań i przeglądania Biesiady · dostęp tylko dla właściciela. Dane zbierane od wdrożenia rejestrowania aktywności.</Text>
        <View style={s.row}>{([{ value: "all", label: "Wszystko" }, { value: "login", label: "Logowania" }, { value: "browsing", label: "Przeglądanie" }] as const).map(item => <Pressable key={item.value} accessibilityRole="button" accessibilityState={{ selected: kind === item.value }} onPress={() => setKind(item.value)} style={[s.button, kind === item.value && s.selected]}><Text style={{ color: kind === item.value ? "white" : v2.color.forest }}>{item.label}</Text></Pressable>)}</View>
        <View style={s.row}>{[1, 7, 30].map(n => <Pressable key={n} accessibilityRole="button" accessibilityState={{ selected: days === n }} onPress={() => setDays(n)} style={[s.button, days === n && s.selected]}><Text style={{ color: days === n ? "white" : v2.color.forest }}>{n === 1 ? "24 godziny" : `${n} dni`}</Text></Pressable>)}
          <Pressable accessibilityLabel="Odśwież aktywność" onPress={refresh} style={s.button}><Feather name="refresh-cw" size={18} color={v2.color.forest} /></Pressable>
        </View>
        <TextInput accessibilityLabel="Szukaj osoby lub sekcji" placeholder="Szukaj osoby lub sekcji" value={query} onChangeText={setQuery} style={s.search} placeholderTextColor={v2.color.textMuted} />
        <Text style={s.help}>Najnowsze wpisy jako pierwsze. Wejście do sekcji nie oznacza czasu pracy ani obecności online.</Text>
      </View>
      {loading ? <ActivityIndicator color={v2.color.forest} /> : error ? <Text accessibilityRole="alert" style={s.message}>{error}</Text> : <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 30 }}>
        {truncated && <Text style={s.help}>Pokazano 200 najnowszych wpisów. Wybierz krótszy okres, aby zawęzić listę.</Text>}
        {!filtered.length && <Text style={s.message}>{query ? "Brak pasujących wpisów." : "Brak zarejestrowanej aktywności w tym okresie."}</Text>}
        {filtered.map(row => <View key={row.id} style={s.card}>
          <Text style={s.person}>{row.user_name || "Użytkownik"}</Text>
          <Text style={s.help}>{new Date(row.at).toLocaleString("pl-PL")}</Text>
          <Text style={s.description}>{row.summary || actions[row.action] || "Zmiana w aplikacji"}</Text>
          {(row.action === "view_event" || row.entity_type === "event") && !!row.entity_id && <Pressable onPress={() => router.push({ pathname: "/event/[id]", params: { id: row.entity_id! } } as any)}><Text style={s.link}>Impreza: {row.entity_id} →</Text></Pressable>}
        </View>)}
      </ScrollView>}
    </>}
  </View>;
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: v2.color.bg }, header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16 },
  title: { fontSize: 21, fontWeight: "800", color: v2.color.forest }, filters: { padding: 16, gap: 12 },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" }, button: { padding: 12, borderRadius: 12, backgroundColor: v2.color.cardMuted }, selected: { backgroundColor: v2.color.forest },
  search: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: v2.color.border, color: v2.color.text, backgroundColor: v2.color.card },
  help: { color: v2.color.textMuted, fontSize: 12, lineHeight: 18 }, message: { padding: 20, color: v2.color.text },
  card: { backgroundColor: v2.color.card, borderRadius: 14, padding: 16, marginBottom: 10, gap: 6 }, person: { color: v2.color.forest, fontWeight: "800", fontSize: 15 },
  description: { color: v2.color.text, fontSize: 14 }, link: { color: v2.color.forest, marginTop: 6, fontSize: 12 },
});

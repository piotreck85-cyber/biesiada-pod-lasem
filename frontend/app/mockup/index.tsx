import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { v2 } from "@/src/designTokensV2";

export default function MockupIndex() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const screens = [
    { key: "start",    title: "Start · Centrum Dowodzenia", desc: "KPI, alerty, weekend, najbliższe imprezy", icon: "home",         route: "/mockup/start" },
    { key: "weekend",  title: "Plan Weekendowy",            desc: "Szczegóły dnia: obsada, gości, problemy",  icon: "sun",          route: "/mockup/weekend" },
    { key: "cal",      title: "Kalendarz",                  desc: "Miesiąc + oznaczenia + agenda dnia",       icon: "calendar",     route: "/mockup/kalendarz" },
    { key: "event",    title: "Centrum Imprezy",            desc: "Zakładki: Info · Zespół · Logistyka · Finanse", icon: "grid",    route: "/mockup/event" },
    { key: "edit",     title: "Dodawanie / Edycja imprezy", desc: "Formularz krokowy z sticky Save",          icon: "edit-3",       route: "/mockup/edit-event" },
    { key: "zakupy",   title: "Zakupy i Magazyn",           desc: "Do kupienia · Magazyn · Kategorie",        icon: "shopping-bag", route: "/mockup/zakupy" },
    { key: "zespol",   title: "Zespół / Grafik",            desc: "Pracownicy + tygodniowy grafik",           icon: "users",        route: "/mockup/zespol" },
    { key: "finanse",  title: "Finanse",                    desc: "Wynik · Wpłaty · Koszty · Należności",     icon: "dollar-sign",  route: "/mockup/finanse" },
    { key: "dzisiaj",  title: "Panel pracownika · Dzisiaj", desc: "Uproszczony widok bez finansów",           icon: "check-square", route: "/mockup/dzisiaj" },
  ];
  return (
    <View style={{ flex: 1, backgroundColor: v2.color.bg }}>
      <View style={[s.header, { paddingTop: insets.top + 20 }]}>
        <Text style={s.brand}>MOCKUP · WERSJA 2.0</Text>
        <Text style={s.title}>Biesiada Pod Lasem</Text>
        <Text style={s.sub}>9 ekranów do przeglądu — spójność mobilna</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
        {screens.map(x => (
          <Pressable key={x.key} onPress={() => router.push(x.route as any)} style={s.card}>
            <View style={s.iconBox}><Feather name={x.icon as any} size={20} color={v2.color.forest} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>{x.title}</Text>
              <Text style={s.cardDesc}>{x.desc}</Text>
            </View>
            <Feather name="chevron-right" size={20} color={v2.color.textSubtle} />
          </Pressable>
        ))}
        <Pressable onPress={() => router.push("/kalendarz" as any)} style={s.backBtn}>
          <Feather name="arrow-left" size={16} color={v2.color.forest} />
          <Text style={s.backText}>Wróć do obecnej wersji</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 16, backgroundColor: v2.color.forestDeep },
  brand: { color: v2.color.moss, letterSpacing: 3, fontSize: 10, fontWeight: "800" },
  title: { color: v2.color.onDark, fontSize: 26, fontWeight: "800", marginTop: 6, letterSpacing: -0.5 },
  sub: { color: v2.color.sage, fontSize: 12, marginTop: 4 },
  card: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: v2.radius.xl, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, ...v2.shadow.sm },
  iconBox: { width: 42, height: 42, borderRadius: v2.radius.md, backgroundColor: v2.color.mint, alignItems: "center", justifyContent: "center" },
  cardTitle: { color: v2.color.text, fontSize: 15, fontWeight: "800" },
  cardDesc: { color: v2.color.textMuted, fontSize: 12, marginTop: 2 },
  backBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, marginTop: 8 },
  backText: { color: v2.color.forest, fontWeight: "700" },
});

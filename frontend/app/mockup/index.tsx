import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { v2 } from "@/src/designTokensV2";

export default function MockupIndex() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const screens = [
    { key: "start",   title: "Centrum Dowodzenia",  desc: "Nowy Start dla właściciela", icon: "home", route: "/mockup/start" },
    { key: "event",   title: "Centrum Imprezy",     desc: "Zakładki: Info · Zespół · Logistyka · Finanse", icon: "grid", route: "/mockup/event" },
    { key: "dzisiaj", title: "Panel pracownika",    desc: "Uproszczony ekran „Dzisiaj\"", icon: "sun", route: "/mockup/dzisiaj" },
  ];
  return (
    <View style={{ flex: 1, backgroundColor: v2.color.bg }}>
      <View style={[s.header, { paddingTop: insets.top + 20 }]}>
        <Text style={s.brand}>MOCKUP · WERSJA 2.0</Text>
        <Text style={s.title}>Biesiada Pod Lasem</Text>
        <Text style={s.sub}>Podgląd 3 nowych ekranów z Twoimi prawdziwymi danymi</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {screens.map(x => (
          <Pressable key={x.key} onPress={() => router.push(x.route as any)} style={s.card}>
            <View style={s.iconBox}>
              <Feather name={x.icon as any} size={22} color={v2.color.forest} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>{x.title}</Text>
              <Text style={s.cardDesc}>{x.desc}</Text>
            </View>
            <Feather name="chevron-right" size={22} color={v2.color.textSubtle} />
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
  title: { color: v2.color.onDark, fontSize: 28, fontWeight: "800", marginTop: 6, letterSpacing: -0.5 },
  sub: { color: v2.color.sage, fontSize: 13, marginTop: 4 },
  card: {
    flexDirection: "row", alignItems: "center", gap: 14,
    padding: 18, borderRadius: v2.radius.xl,
    backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border,
    ...v2.shadow.sm,
  },
  iconBox: { width: 48, height: 48, borderRadius: v2.radius.md, backgroundColor: v2.color.mint, alignItems: "center", justifyContent: "center" },
  cardTitle: { color: v2.color.text, fontSize: 16, fontWeight: "800" },
  cardDesc: { color: v2.color.textMuted, fontSize: 12, marginTop: 3, lineHeight: 17 },
  backBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, marginTop: 12 },
  backText: { color: v2.color.forest, fontWeight: "700" },
});

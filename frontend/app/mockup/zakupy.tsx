import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { v2 } from "@/src/designTokensV2";

const CATEGORIES = ["Wszystko", "Napoje", "Mięso", "Warzywa", "Nabiał", "Suche", "Chemia"];

// Real data will come from API — tu tylko struktura
const ITEMS_TO_BUY: any[] = [];
const STOCK_ITEMS: any[] = [];

export default function ZakupyMockup() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState<"buy" | "stock">("buy");
  const [cat, setCat] = useState("Wszystko");

  return (
    <View style={{ flex: 1, backgroundColor: v2.color.bg }}>
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={s.iconBtn}><Feather name="chevron-left" size={22} color="#fff" /></Pressable>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={s.brand}>ZAKUPY I MAGAZYN</Text>
          <Text style={s.title}>Lista i stan</Text>
        </View>
        <Pressable style={s.iconBtn}><Feather name="printer" size={18} color="#fff" /></Pressable>
      </View>

      <View style={s.segRow}>
        {[["buy","Do kupienia",0],["stock","Magazyn",0]].map(([k, lbl, cnt]: any) => (
          <Pressable key={k} onPress={() => setTab(k)} style={[s.seg, tab === k && s.segActive]}>
            <Text style={[s.segText, tab === k && s.segTextActive]}>{lbl}</Text>
            <View style={[s.segCount, tab === k && s.segCountActive]}><Text style={[s.segCountText, tab === k && { color: v2.color.card }]}>{cnt}</Text></View>
          </Pressable>
        ))}
      </View>

      <View style={s.searchBox}>
        <Feather name="search" size={16} color={v2.color.textSubtle} />
        <TextInput placeholder={tab === "buy" ? "Szukaj produktów…" : "Szukaj w magazynie…"} placeholderTextColor={v2.color.textSubtle} style={s.search} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 6 }} style={{ maxHeight: 44 }}>
        {CATEGORIES.map(c => (
          <Pressable key={c} onPress={() => setCat(c)} style={[s.catChip, cat === c && s.catChipActive]}>
            <Text style={[s.catChipText, cat === c && s.catChipTextActive]}>{c}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 130 }}>
        {tab === "buy" ? (
          ITEMS_TO_BUY.length === 0 ? (
            <View style={s.emptyBox}>
              <Feather name="shopping-bag" size={40} color={v2.color.textSubtle} />
              <Text style={s.emptyTitle}>Lista pusta</Text>
              <Text style={s.emptyText}>Wygeneruj listę z nadchodzących imprez</Text>
              <Pressable style={s.primaryBtn}>
                <Feather name="refresh-cw" size={14} color="#fff" />
                <Text style={s.primaryBtnText}>Wygeneruj</Text>
              </Pressable>
            </View>
          ) : null
        ) : (
          STOCK_ITEMS.length === 0 ? (
            <View style={s.emptyBox}>
              <Feather name="package" size={40} color={v2.color.textSubtle} />
              <Text style={s.emptyTitle}>Magazyn pusty</Text>
              <Text style={s.emptyText}>Dodaj pierwsze pozycje magazynowe</Text>
              <Pressable style={s.primaryBtn}>
                <Feather name="plus" size={14} color="#fff" />
                <Text style={s.primaryBtnText}>Dodaj pozycję</Text>
              </Pressable>
            </View>
          ) : null
        )}

        {/* Sample structure — jak wygląda pozycja */}
        <Text style={[s.sectionLabel, { marginTop: 10 }]}>PODGLĄD STRUKTURY (przykłady)</Text>
        <View style={s.itemCard}>
          <View style={s.qtyBox}><Text style={s.qtyText}>12</Text><Text style={s.qtyUnit}>szt.</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={s.itemName}>Woda mineralna Cisowianka 1,5L</Text>
            <View style={{ flexDirection: "row", gap: 6, marginTop: 4, alignItems: "center" }}>
              <View style={[s.tag, { backgroundColor: v2.color.infoBg }]}><Text style={[s.tagText, { color: v2.color.info }]}>Napoje</Text></View>
              <Text style={s.itemMeta}>≈ 24,00 zł</Text>
            </View>
          </View>
          <View style={s.check} />
        </View>

        <View style={[s.itemCard, s.itemCardDone]}>
          <View style={[s.qtyBox, { backgroundColor: v2.color.successBg }]}><Text style={[s.qtyText, { color: v2.color.success }]}>3</Text><Text style={[s.qtyUnit, { color: v2.color.success }]}>kg</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={[s.itemName, { textDecorationLine: "line-through", color: v2.color.textMuted }]}>Kiełbasa biała</Text>
            <Text style={[s.itemMeta, { color: v2.color.success }]}>✓ Kupione</Text>
          </View>
          <View style={[s.check, s.checkOn]}><Feather name="check" size={14} color="#fff" /></View>
        </View>

        <View style={s.totalCard}>
          <Text style={s.totalLabel}>Szacowany koszt zakupów</Text>
          <Text style={s.totalValue}>—</Text>
          <Text style={s.totalHint}>Ceny z ostatnich zakupów · aktualizuj po zakupie</Text>
        </View>
      </ScrollView>

      <View style={[s.tabBar, { paddingBottom: insets.bottom + 6 }]}>
        {[["home","Start",false],["calendar","Kalendarz",false],["shopping-bag","Zakupy",true],["users","Zespół",false],["dollar-sign","Finanse",false]].map(([i,l,a]: any, k) => (
          <View key={k} style={s.tab}><Feather name={i} size={22} color={a ? v2.color.forest : v2.color.textSubtle} /><Text style={[s.tabLabel, { color: a ? v2.color.forest : v2.color.textSubtle }]}>{l}</Text></View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 14, backgroundColor: v2.color.forestDeep },
  iconBtn: { width: 36, height: 36, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  brand: { color: v2.color.moss, letterSpacing: 3, fontSize: 10, fontWeight: "800" },
  title: { color: "#fff", fontSize: 18, fontWeight: "800" },
  segRow: { flexDirection: "row", padding: 12, gap: 8, backgroundColor: v2.color.forestDeep },
  seg: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: v2.radius.md, backgroundColor: "rgba(255,255,255,0.1)" },
  segActive: { backgroundColor: v2.color.card },
  segText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  segTextActive: { color: v2.color.forest },
  segCount: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.2)" },
  segCountActive: { backgroundColor: v2.color.forest },
  segCountText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, margin: 12, paddingHorizontal: 12, backgroundColor: v2.color.card, borderRadius: v2.radius.md, borderWidth: 1, borderColor: v2.color.border, height: 40 },
  search: { flex: 1, color: v2.color.text, fontSize: 14 },
  catChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, marginBottom: 4 },
  catChipActive: { backgroundColor: v2.color.forest, borderColor: v2.color.forest },
  catChipText: { color: v2.color.text, fontSize: 12, fontWeight: "700" },
  catChipTextActive: { color: "#fff" },
  sectionLabel: { color: v2.color.textSubtle, fontSize: 10, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 },
  emptyBox: { padding: 30, alignItems: "center", gap: 6, borderRadius: v2.radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: v2.color.border, backgroundColor: v2.color.card },
  emptyTitle: { color: v2.color.text, fontSize: 15, fontWeight: "800", marginTop: 6 },
  emptyText: { color: v2.color.textMuted, fontSize: 12 },
  primaryBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: v2.radius.md, backgroundColor: v2.color.forest, marginTop: 8 },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  itemCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, marginBottom: 8, borderRadius: v2.radius.md, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border },
  itemCardDone: { backgroundColor: v2.color.mint + "40" },
  qtyBox: { width: 52, height: 52, borderRadius: v2.radius.sm, backgroundColor: v2.color.mint, alignItems: "center", justifyContent: "center" },
  qtyText: { color: v2.color.forest, fontSize: 15, fontWeight: "800" },
  qtyUnit: { color: v2.color.forest, fontSize: 10, fontWeight: "700" },
  itemName: { color: v2.color.text, fontSize: 14, fontWeight: "700" },
  itemMeta: { color: v2.color.textMuted, fontSize: 11 },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  tagText: { fontSize: 9, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },
  check: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: v2.color.borderStrong },
  checkOn: { backgroundColor: v2.color.forest, borderColor: v2.color.forest, alignItems: "center", justifyContent: "center" },
  totalCard: { marginTop: 14, padding: 14, borderRadius: v2.radius.md, backgroundColor: v2.color.forest },
  totalLabel: { color: v2.color.sage, fontSize: 11, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  totalValue: { color: "#fff", fontSize: 24, fontWeight: "800", marginTop: 4 },
  totalHint: { color: v2.color.sage, fontSize: 10, marginTop: 4 },
  tabBar: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: v2.color.card, borderTopWidth: 1, borderTopColor: v2.color.border, flexDirection: "row", justifyContent: "space-around", paddingTop: 8 },
  tab: { alignItems: "center", gap: 3 },
  tabLabel: { fontSize: 10, fontWeight: "700" },
});

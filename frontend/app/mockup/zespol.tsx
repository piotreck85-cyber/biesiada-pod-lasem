import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { v2 } from "@/src/designTokensV2";

const DAYS = ["Pon","Wt","Śr","Cz","Pt","Sob","Nd"];

export default function ZespolMockup() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState<"grafik" | "lista">("grafik");
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));

  return (
    <View style={{ flex: 1, backgroundColor: v2.color.bg }}>
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={s.iconBtn}><Feather name="chevron-left" size={22} color="#fff" /></Pressable>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={s.brand}>ZESPÓŁ</Text>
          <Text style={s.title}>Pracownicy i grafik</Text>
        </View>
        <Pressable style={s.primaryIcon}><Feather name="plus" size={18} color="#fff" /></Pressable>
      </View>

      <View style={s.segRow}>
        {[["grafik","Grafik"],["lista","Pracownicy"]].map(([k, l]: any) => (
          <Pressable key={k} onPress={() => setTab(k)} style={[s.seg, tab === k && s.segActive]}>
            <Text style={[s.segText, tab === k && s.segTextActive]}>{l}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 130 }}>
        {tab === "grafik" && (
          <>
            {/* Week strip */}
            <View style={s.weekStrip}>
              {DAYS.map((d, i) => {
                const day = new Date(monday); day.setDate(monday.getDate() + i);
                const isToday = day.toDateString() === today.toDateString();
                return (
                  <View key={d} style={[s.dayCol, isToday && s.dayColToday]}>
                    <Text style={[s.dowLabel, isToday && { color: "#fff" }]}>{d}</Text>
                    <Text style={[s.dayNum, isToday && { color: "#fff" }]}>{day.getDate()}</Text>
                  </View>
                );
              })}
            </View>

            {/* Sample staff rows with weekly assignments */}
            <View style={{ paddingHorizontal: 16 }}>
              <Text style={s.sectionLabel}>PODGLĄD STRUKTURY (przykłady)</Text>

              {[
                { name: "Zuzia S.", role: "Kelnerka",   type: "employee", days: [null, null, null, null, "6h", "10h", null] },
                { name: "Marek W.", role: "Grill",      type: "employee", days: [null, null, null, null, null, "8h", "6h"] },
                { name: "Piotr K.", role: "Wspólnik",   type: "partner",  days: ["12h", "12h", "12h", "12h", "12h", "14h", "10h"] },
              ].map(p => (
                <View key={p.name} style={s.staffRow}>
                  <View style={[s.avatar, { backgroundColor: p.type === "partner" ? v2.color.forest : v2.color.moss }]}>
                    <Text style={s.avatarTxt}>{p.name.split(" ").map(x => x[0]).join("")}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
                      <Text style={s.staffName}>{p.name}</Text>
                      {p.type === "partner" && (
                        <View style={s.partnerPill}><Text style={s.partnerPillText}>Wspólnik</Text></View>
                      )}
                    </View>
                    <Text style={s.staffRole}>{p.role}</Text>
                    <View style={s.shiftRow}>
                      {p.days.map((d, i) => (
                        <View key={i} style={[s.shiftCell, d ? s.shiftCellFilled : null]}>
                          {d && <Text style={s.shiftText}>{d}</Text>}
                        </View>
                      ))}
                    </View>
                  </View>
                </View>
              ))}
            </View>

            {/* Footer summary */}
            <View style={s.summaryBox}>
              <View style={s.sumItem}><Text style={s.sumLabel}>Zaplanowanych godzin</Text><Text style={s.sumValue}>—</Text></View>
              <View style={s.sumDiv} />
              <View style={s.sumItem}><Text style={s.sumLabel}>Do wypłaty (tygodniowo)</Text><Text style={[s.sumValue, { color: v2.color.forest }]}>—</Text></View>
            </View>
          </>
        )}

        {tab === "lista" && (
          <View style={{ padding: 16 }}>
            <Text style={s.sectionLabel}>PODGLĄD STRUKTURY (przykłady)</Text>
            {[
              { name: "Zuzia S.", role: "Kelnerka", rate: 40, type: "employee" },
              { name: "Piotr K.", role: "Właściciel", rate: 0, type: "partner" },
            ].map(p => (
              <View key={p.name} style={s.staffListRow}>
                <View style={[s.avatar, { backgroundColor: p.type === "partner" ? v2.color.forest : v2.color.moss }]}>
                  <Text style={s.avatarTxt}>{p.name.split(" ").map(x => x[0]).join("")}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
                    <Text style={s.staffName}>{p.name}</Text>
                    {p.type === "partner" && <View style={s.partnerPill}><Text style={s.partnerPillText}>Wspólnik</Text></View>}
                  </View>
                  <Text style={s.staffRole}>{p.role}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={s.rate}>{p.rate || "—"}</Text>
                  <Text style={s.rateUnit}>zł/godz.</Text>
                </View>
                <Feather name="chevron-right" size={16} color={v2.color.textMuted} />
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={[s.tabBar, { paddingBottom: insets.bottom + 6 }]}>
        {[["home","Start",false],["calendar","Kalendarz",false],["shopping-bag","Zakupy",false],["users","Zespół",true],["dollar-sign","Finanse",false]].map(([i,l,a]: any, k) => (
          <View key={k} style={s.tab}><Feather name={i} size={22} color={a ? v2.color.forest : v2.color.textSubtle} /><Text style={[s.tabLabel, { color: a ? v2.color.forest : v2.color.textSubtle }]}>{l}</Text></View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 14, backgroundColor: v2.color.forestDeep },
  iconBtn: { width: 36, height: 36, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  primaryIcon: { width: 36, height: 36, borderRadius: 999, backgroundColor: v2.color.moss, alignItems: "center", justifyContent: "center" },
  brand: { color: v2.color.moss, letterSpacing: 3, fontSize: 10, fontWeight: "800" },
  title: { color: "#fff", fontSize: 18, fontWeight: "800" },

  segRow: { flexDirection: "row", padding: 12, gap: 8, backgroundColor: v2.color.forestDeep },
  seg: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: v2.radius.md, backgroundColor: "rgba(255,255,255,0.1)" },
  segActive: { backgroundColor: v2.color.card },
  segText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  segTextActive: { color: v2.color.forest },

  weekStrip: { flexDirection: "row", padding: 12, gap: 4 },
  dayCol: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: v2.radius.sm, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border },
  dayColToday: { backgroundColor: v2.color.forest, borderColor: v2.color.forest },
  dowLabel: { color: v2.color.textSubtle, fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  dayNum: { color: v2.color.text, fontSize: 16, fontWeight: "800", marginTop: 2 },

  sectionLabel: { color: v2.color.textSubtle, fontSize: 10, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 },

  staffRow: { padding: 12, marginBottom: 10, borderRadius: v2.radius.md, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, flexDirection: "row", gap: 12 },
  avatar: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: "#fff", fontWeight: "800", fontSize: 13 },
  staffName: { color: v2.color.text, fontSize: 14, fontWeight: "800" },
  staffRole: { color: v2.color.textMuted, fontSize: 11, marginTop: 1 },
  partnerPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: v2.color.mint },
  partnerPillText: { color: v2.color.forest, fontSize: 9, fontWeight: "800", letterSpacing: 0.3, textTransform: "uppercase" },
  shiftRow: { flexDirection: "row", gap: 3, marginTop: 8 },
  shiftCell: { flex: 1, aspectRatio: 1.4, borderRadius: 4, backgroundColor: v2.color.divider, alignItems: "center", justifyContent: "center" },
  shiftCellFilled: { backgroundColor: v2.color.mint },
  shiftText: { color: v2.color.forest, fontSize: 10, fontWeight: "800" },

  staffListRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, marginBottom: 8, borderRadius: v2.radius.md, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border },
  rate: { color: v2.color.text, fontSize: 15, fontWeight: "800" },
  rateUnit: { color: v2.color.textMuted, fontSize: 10 },

  summaryBox: { flexDirection: "row", marginHorizontal: 16, marginTop: 8, padding: 14, borderRadius: v2.radius.md, backgroundColor: v2.color.forest },
  sumItem: { flex: 1 },
  sumLabel: { color: v2.color.sage, fontSize: 10, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  sumValue: { color: "#fff", fontSize: 18, fontWeight: "800", marginTop: 4 },
  sumDiv: { width: 1, backgroundColor: v2.color.moss, marginHorizontal: 12 },

  tabBar: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: v2.color.card, borderTopWidth: 1, borderTopColor: v2.color.border, flexDirection: "row", justifyContent: "space-around", paddingTop: 8 },
  tab: { alignItems: "center", gap: 3 },
  tabLabel: { fontSize: 10, fontWeight: "700" },
});

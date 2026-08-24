import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ImageBackground } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { v2 } from "@/src/designTokensV2";
import { formatPLN } from "@/src/theme";

const HERO = "https://images.unsplash.com/photo-1586058584825-c1e87ed735b4?q=80&w=800";

const TABS = [
  { key: "info",     label: "Info",      icon: "info" },
  { key: "team",     label: "Zespół",    icon: "users" },
  { key: "log",      label: "Logistyka", icon: "shopping-bag" },
  { key: "finance",  label: "Finanse",   icon: "dollar-sign" },
] as const;

type TabKey = typeof TABS[number]["key"];

export default function EventMockup() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  useLocalSearchParams<{ id?: string }>();
  const [tab, setTab] = useState<TabKey>("info");

  // Sample data
  const evt = {
    name: "Wesele Nowak", date: "30 sierpnia 2026", day: "sobota",
    time: "14:00 – 22:00", guests: 80, package: "Biesiada Premium",
    client: "Anna Nowak", phone: "+48 500 123 456",
    price: 12500, deposit: 500, remaining: 12000,
    payments: 500, costs_est: 4200, profit_est: 8300,
    staff: [
      { name: "Piotr K.",  role: "Szef",       initials: "PK", color: "#437A56" },
      { name: "Zuzia S.",  role: "Kelnerka",   initials: "ZS", color: "#8BAA92" },
      { name: "Marek W.",  role: "Grill",      initials: "MW", color: "#285338" },
    ],
    checklist_done: 14, checklist_total: 18,
    weather: { icon: "sun", temp: "24°C", desc: "Słonecznie" },
  };

  return (
    <View style={{ flex: 1, backgroundColor: v2.color.bg }}>
      {/* Hero */}
      <ImageBackground source={{ uri: HERO }} style={[s.hero, { paddingTop: insets.top + 12 }]}>
        <View style={s.heroScrim}>
          <View style={s.heroTop}>
            <Pressable onPress={() => router.back()} style={s.iconBtn}>
              <Feather name="chevron-left" size={22} color="#fff" />
            </Pressable>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable style={s.iconBtn}><Feather name="share-2" size={18} color="#fff" /></Pressable>
              <Pressable style={s.iconBtn}><Feather name="more-vertical" size={18} color="#fff" /></Pressable>
            </View>
          </View>
          <View style={{ marginTop: 40 }}>
            <View style={s.warnPill}>
              <View style={[s.dot, { backgroundColor: v2.color.warning }]} />
              <Text style={s.warnText}>Wymaga uwagi — brak zaliczki</Text>
            </View>
            <Text style={s.heroTitle}>{evt.name}</Text>
            <Text style={s.heroSub}>{evt.date} · {evt.day} · {evt.time}</Text>
          </View>
        </View>
      </ImageBackground>

      {/* Sticky tabs */}
      <View style={s.tabsBar}>
        {TABS.map(t => {
          const active = tab === t.key;
          return (
            <Pressable key={t.key} onPress={() => setTab(t.key as TabKey)} style={s.tab}>
              <Feather name={t.icon as any} size={16} color={active ? v2.color.forest : v2.color.textMuted} />
              <Text style={[s.tabLabel, active && { color: v2.color.forest, fontWeight: "800" }]}>{t.label}</Text>
              {active && <View style={s.tabUnderline} />}
            </Pressable>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 12 }}>
        {tab === "info" && (
          <>
            <InfoRow icon="user"       label="Klient"       value={evt.client} />
            <InfoRow icon="phone"      label="Telefon"      value={evt.phone} action="Zadzwoń" />
            <InfoRow icon="users"      label="Liczba osób"  value={String(evt.guests)} />
            <InfoRow icon="package"    label="Pakiet"       value={evt.package} />
            <InfoRow icon="file-text"  label="Uwagi"        value="Alergia na orzechy · zamówiony tort" multi />

            <View style={s.weatherCard}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={s.weatherIcon}><Feather name="sun" size={24} color={v2.color.warning} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.sectionLabel}>Prognoza pogody</Text>
                  <Text style={s.weatherTemp}>{evt.weather.temp} · {evt.weather.desc}</Text>
                </View>
              </View>
            </View>
          </>
        )}

        {tab === "team" && (
          <>
            {/* Checklist progress */}
            <View style={s.checklistCard}>
              <View style={{ flex: 1 }}>
                <Text style={s.sectionLabel}>POSTĘP CHECKLISTY</Text>
                <Text style={s.progressText}>{evt.checklist_done} / {evt.checklist_total} zadań</Text>
                <View style={s.progressBg}>
                  <View style={[s.progressFill, { width: `${evt.checklist_done * 100 / evt.checklist_total}%` }]} />
                </View>
              </View>
              <View style={s.circleProgress}>
                <Text style={s.circleTxt}>{Math.round(evt.checklist_done * 100 / evt.checklist_total)}%</Text>
              </View>
            </View>

            <Text style={s.sectionLabel}>PRZYPISANI PRACOWNICY ({evt.staff.length})</Text>
            {evt.staff.map((p, i) => (
              <View key={i} style={s.staffRow}>
                <View style={[s.avatar, { backgroundColor: p.color }]}>
                  <Text style={s.avatarTxt}>{p.initials}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.staffName}>{p.name}</Text>
                  <Text style={s.staffRole}>{p.role}</Text>
                </View>
                <View style={s.confirmedPill}>
                  <Feather name="check" size={11} color={v2.color.success} />
                  <Text style={s.confirmedTxt}>Potwierdzony</Text>
                </View>
              </View>
            ))}
          </>
        )}

        {tab === "log" && (
          <>
            <Text style={s.sectionLabel}>MENU</Text>
            <View style={[s.card, { flexDirection: "row", alignItems: "center", gap: 12 }]}>
              <View style={[s.statusIconBox, { backgroundColor: v2.color.successBg }]}>
                <Feather name="check" size={16} color={v2.color.success} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>Menu potwierdzone</Text>
                <Text style={s.rowSub}>Biesiada Premium · zaakceptowane 22.08</Text>
              </View>
              <Feather name="chevron-right" size={16} color={v2.color.textMuted} />
            </View>

            <Text style={[s.sectionLabel, { marginTop: 8 }]}>ZAKUPY I MAGAZYN</Text>
            <Pressable style={[s.card, { flexDirection: "row", alignItems: "center", gap: 12 }]}>
              <View style={[s.statusIconBox, { backgroundColor: v2.color.warningBg }]}>
                <Feather name="shopping-bag" size={16} color={v2.color.warning} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>18 produktów do kupienia</Text>
                <Text style={s.rowSub}>Wygenerowane · niski stan wody</Text>
              </View>
              <Feather name="chevron-right" size={16} color={v2.color.textMuted} />
            </Pressable>

            <Text style={[s.sectionLabel, { marginTop: 8 }]}>ZDJĘCIA</Text>
            <View style={s.photoGrid}>
              {[1, 2, 3, 4].map(i => (
                <View key={i} style={s.photoTile}>
                  <Feather name="image" size={20} color={v2.color.textSubtle} />
                </View>
              ))}
            </View>
          </>
        )}

        {tab === "finance" && (
          <>
            <View style={s.priceCard}>
              <Text style={s.sectionLabel}>CENA IMPREZY</Text>
              <Text style={s.bigPrice}>{formatPLN(evt.price)}</Text>
              <View style={s.divider} />
              <View style={s.finRow}>
                <Text style={s.finLabel}>Wpłacono</Text>
                <Text style={[s.finValue, { color: v2.color.success }]}>{formatPLN(evt.payments)}</Text>
              </View>
              <View style={s.finRow}>
                <Text style={s.finLabel}>Pozostało do zapłaty</Text>
                <Text style={[s.finValue, { color: v2.color.warning }]}>{formatPLN(evt.remaining)}</Text>
              </View>
              <View style={s.finRow}>
                <Text style={s.finLabel}>Przewidywany koszt</Text>
                <Text style={s.finValue}>{formatPLN(evt.costs_est)}</Text>
              </View>
              <View style={s.divider} />
              <View style={s.finRow}>
                <Text style={[s.finLabel, { fontWeight: "800", color: v2.color.text }]}>Przewidywany zysk</Text>
                <Text style={s.bigProfit}>{formatPLN(evt.profit_est)}</Text>
              </View>
            </View>

            <Pressable style={s.cta}>
              <Feather name="plus-circle" size={18} color="#fff" />
              <Text style={s.ctaText}>Dodaj wpłatę</Text>
            </Pressable>
            <Pressable style={[s.cta, { backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.borderStrong }]}>
              <Feather name="check-circle" size={18} color={v2.color.forest} />
              <Text style={[s.ctaText, { color: v2.color.forest }]}>Rozlicz końcowo</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function InfoRow({ icon, label, value, action, multi }: any) {
  return (
    <View style={[s.infoRow, multi && { alignItems: "flex-start" }]}>
      <View style={s.infoIconBox}>
        <Feather name={icon} size={16} color={v2.color.forest} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.infoLabel}>{label}</Text>
        <Text style={s.infoValue}>{value}</Text>
      </View>
      {action ? (
        <Pressable style={s.infoAction}>
          <Text style={s.infoActionText}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  hero: { height: 240, justifyContent: "flex-start" },
  heroScrim: { flex: 1, backgroundColor: "rgba(11,25,15,0.55)", padding: 16 },
  heroTop: { flexDirection: "row", justifyContent: "space-between" },
  iconBtn: { width: 40, height: 40, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  warnPill: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.4)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, marginBottom: 10 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  warnText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  heroTitle: { color: "#fff", fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  heroSub: { color: "#E2EFE7", fontSize: 13, marginTop: 4 },

  tabsBar: {
    flexDirection: "row", backgroundColor: v2.color.card,
    borderBottomWidth: 1, borderBottomColor: v2.color.border,
  },
  tab: { flex: 1, alignItems: "center", paddingVertical: 12, gap: 4 },
  tabLabel: { color: v2.color.textMuted, fontSize: 11, fontWeight: "700" },
  tabUnderline: { position: "absolute", bottom: 0, left: 16, right: 16, height: 2, backgroundColor: v2.color.forest, borderRadius: 999 },

  sectionLabel: { color: v2.color.textMuted, fontSize: 10, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },

  card: { padding: 14, borderRadius: v2.radius.md, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border },
  rowTitle: { color: v2.color.text, fontSize: 14, fontWeight: "700" },
  rowSub: { color: v2.color.textMuted, fontSize: 12, marginTop: 3 },

  infoRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderRadius: v2.radius.md,
    backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border,
  },
  infoIconBox: { width: 36, height: 36, borderRadius: v2.radius.sm, backgroundColor: v2.color.mint, alignItems: "center", justifyContent: "center" },
  infoLabel: { color: v2.color.textSubtle, fontSize: 10, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  infoValue: { color: v2.color.text, fontSize: 14, fontWeight: "700", marginTop: 2 },
  infoAction: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: v2.color.mint },
  infoActionText: { color: v2.color.forest, fontSize: 11, fontWeight: "800" },

  weatherCard: { padding: 14, borderRadius: v2.radius.md, backgroundColor: v2.color.warningBg + "40", borderWidth: 1, borderColor: v2.color.warning + "30" },
  weatherIcon: { width: 44, height: 44, borderRadius: v2.radius.md, backgroundColor: v2.color.card, alignItems: "center", justifyContent: "center" },
  weatherTemp: { color: v2.color.text, fontSize: 15, fontWeight: "800", marginTop: 3 },

  checklistCard: {
    flexDirection: "row", padding: 16, borderRadius: v2.radius.lg,
    backgroundColor: v2.color.mint, gap: 14, alignItems: "center",
  },
  progressText: { color: v2.color.forest, fontSize: 16, fontWeight: "800", marginTop: 3 },
  progressBg: { height: 8, borderRadius: 4, backgroundColor: v2.color.card, marginTop: 8, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 4, backgroundColor: v2.color.forest },
  circleProgress: { width: 60, height: 60, borderRadius: 30, borderWidth: 4, borderColor: v2.color.forest, alignItems: "center", justifyContent: "center", backgroundColor: v2.color.card },
  circleTxt: { color: v2.color.forest, fontSize: 15, fontWeight: "800" },

  staffRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: v2.radius.md, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border },
  avatar: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: "#fff", fontSize: 12, fontWeight: "800" },
  staffName: { color: v2.color.text, fontSize: 14, fontWeight: "700" },
  staffRole: { color: v2.color.textMuted, fontSize: 11, marginTop: 2 },
  confirmedPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: v2.color.successBg },
  confirmedTxt: { color: v2.color.success, fontSize: 10, fontWeight: "800" },

  statusIconBox: { width: 36, height: 36, borderRadius: v2.radius.sm, alignItems: "center", justifyContent: "center" },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  photoTile: { width: 78, height: 78, borderRadius: v2.radius.sm, backgroundColor: v2.color.cardMuted, alignItems: "center", justifyContent: "center" },

  priceCard: { padding: 20, borderRadius: v2.radius.lg, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border },
  bigPrice: { color: v2.color.forest, fontSize: 30, fontWeight: "800", letterSpacing: -1, marginTop: 4 },
  divider: { height: 1, backgroundColor: v2.color.divider, marginVertical: 12 },
  finRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  finLabel: { color: v2.color.textMuted, fontSize: 13 },
  finValue: { color: v2.color.text, fontSize: 14, fontWeight: "700" },
  bigProfit: { color: v2.color.forest, fontSize: 20, fontWeight: "800" },

  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: v2.radius.md, backgroundColor: v2.color.forest },
  ctaText: { color: "#fff", fontSize: 14, fontWeight: "800" },
});

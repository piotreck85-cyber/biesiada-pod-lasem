import { useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, Linking,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme, formatPLN } from "@/src/theme";
import { BIRTHDAY_PACKAGES, WORKSHOPS, WORKSHOP_INFO, SOURCE_URL, BirthdayPackage, Workshop } from "@/src/offers";

type Tab = "urodziny" | "warsztaty";

export default function Oferta() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("urodziny");
  const [seasonFilter, setSeasonFilter] = useState<string>("Wszystkie");

  const seasons = useMemo(() => {
    const set = new Set(WORKSHOPS.map(w => w.season));
    return ["Wszystkie", ...Array.from(set)];
  }, []);
  const filteredWorkshops = useMemo(
    () => (seasonFilter === "Wszystkie" ? WORKSHOPS : WORKSHOPS.filter(w => w.season === seasonFilter)),
    [seasonFilter],
  );

  const createFromPackage = (p: BirthdayPackage) => {
    const desc = [
      `${p.duration} · ${p.capacity}`,
      "",
      "W pakiecie:",
      ...p.features.map(f => `• ${f}`),
      "",
      p.above_limit_note,
    ].join("\n");
    router.push({
      pathname: "/event/[id]",
      params: {
        id: "new",
        name: `Urodziny ${p.name}`,
        category: p.category,
        notes: desc,
        revenue: String(p.price_weekday ?? p.price_weekend ?? 0),
        image_url: p.image,
      } as any,
    });
  };
  const createFromWorkshop = (w: Workshop) => {
    const desc = [
      "Warsztaty",
      "",
      "Zawiera:",
      ...w.features.map(f => `• ${f}`),
      "",
      `${WORKSHOP_INFO}`,
      `Cena: ${formatPLN(w.price_per_child)}/dziecko (opiekunowie gratis)`,
    ].join("\n");
    router.push({
      pathname: "/event/[id]",
      params: {
        id: "new",
        name: `Warsztaty: ${w.name}`,
        category: "dzieci/wycieczki",
        notes: desc,
        image_url: w.image,
      } as any,
    });
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]} testID="oferta-screen">
      <View style={s.header}>
        <Text style={s.brand}>Oferta</Text>
        <Text style={s.title}>Dolina Przygód</Text>
        <Pressable testID="source-link" onPress={() => Linking.openURL(SOURCE_URL)} style={s.sourceRow}>
          <Feather name="external-link" size={12} color={theme.color.brand} />
          <Text style={s.sourceText}>dolinaprzygod.pl</Text>
        </Pressable>
      </View>

      <View style={s.tabBar}>
        <Pressable
          testID="tab-urodziny"
          onPress={() => setTab("urodziny")}
          style={[s.tabBtn, tab === "urodziny" && s.tabBtnActive]}
        >
          <Feather name="gift" size={14} color={tab === "urodziny" ? theme.color.onBrand : theme.color.onSurfaceSecondary} />
          <Text style={[s.tabText, tab === "urodziny" && s.tabTextActive]}>Urodziny (5)</Text>
        </Pressable>
        <Pressable
          testID="tab-warsztaty"
          onPress={() => setTab("warsztaty")}
          style={[s.tabBtn, tab === "warsztaty" && s.tabBtnActive]}
        >
          <Feather name="feather" size={14} color={tab === "warsztaty" ? theme.color.onBrand : theme.color.onSurfaceSecondary} />
          <Text style={[s.tabText, tab === "warsztaty" && s.tabTextActive]}>Warsztaty ({WORKSHOPS.length})</Text>
        </Pressable>
      </View>

      {tab === "warsztaty" && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.chipsRow}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 8, alignItems: "center" }}
        >
          {seasons.map(sname => {
            const active = seasonFilter === sname;
            return (
              <Pressable
                key={sname}
                testID={`season-chip-${sname}`}
                onPress={() => setSeasonFilter(sname)}
                style={[s.chip, active && s.chipActive]}
              >
                <Text style={[s.chipText, active && s.chipTextActive]}>{sname}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120, paddingTop: 4 }}
        showsVerticalScrollIndicator={false}
      >
        {tab === "urodziny" ? (
          BIRTHDAY_PACKAGES.map(p => (
            <View key={p.id} style={s.card} testID={`bday-card-${p.id}`}>
              <View style={s.cardHero}>
                <Image source={p.image} style={StyleSheet.absoluteFill} contentFit="cover" />
                <LinearGradient
                  colors={["rgba(12,12,14,0.15)", "rgba(12,12,14,0.85)", "rgba(12,12,14,0.98)"]}
                  locations={[0, 0.55, 1]}
                  style={StyleSheet.absoluteFill}
                />
                <View style={s.badgeRow}>
                  <View style={s.badge}><Feather name="clock" size={11} color={theme.color.brand} /><Text style={s.badgeText}>{p.duration}</Text></View>
                  <View style={s.badge}><Feather name="users" size={11} color={theme.color.brand} /><Text style={s.badgeText}>{p.capacity}</Text></View>
                </View>
                <Text style={s.cardName}>{p.name}</Text>
              </View>
              <View style={s.cardBody}>
                <Text style={s.sectionLabel}>W pakiecie</Text>
                {p.features.map((f, i) => (
                  <View key={i} style={s.featureRow}>
                    <Feather name="check" size={14} color={theme.color.brand} />
                    <Text style={s.featureText}>{f}</Text>
                  </View>
                ))}
                <View style={s.priceRow}>
                  {p.price_weekday !== null && (
                    <View style={s.priceBlock}>
                      <Text style={s.priceLabel}>Pon–Czw</Text>
                      <Text style={s.priceValue}>{formatPLN(p.price_weekday)}</Text>
                    </View>
                  )}
                  {p.price_weekend !== null && (
                    <View style={[s.priceBlock, { borderLeftWidth: 1, borderLeftColor: theme.color.divider, paddingLeft: 16, marginLeft: 8 }]}>
                      <Text style={s.priceLabel}>Pt–Nd</Text>
                      <Text style={[s.priceValue, { color: theme.color.brand }]}>{formatPLN(p.price_weekend)}</Text>
                    </View>
                  )}
                </View>
                <Text style={s.noteText}>{p.above_limit_note}</Text>
                <Pressable
                  testID={`bday-create-${p.id}`}
                  style={s.actionBtn}
                  onPress={() => createFromPackage(p)}
                >
                  <Feather name="plus" size={14} color={theme.color.onBrand} />
                  <Text style={s.actionBtnText}>Utwórz imprezę z tego pakietu</Text>
                </Pressable>
              </View>
            </View>
          ))
        ) : (
          <>
            <View style={s.infoBox}>
              <Feather name="info" size={14} color={theme.color.brand} />
              <Text style={s.infoText}>{WORKSHOP_INFO}</Text>
            </View>
            {filteredWorkshops.map(w => (
              <View key={w.id} style={s.card} testID={`workshop-card-${w.id}`}>
                <View style={s.cardHero}>
                  <Image source={w.image} style={StyleSheet.absoluteFill} contentFit="cover" />
                  <LinearGradient
                    colors={["rgba(12,12,14,0.15)", "rgba(12,12,14,0.85)", "rgba(12,12,14,0.98)"]}
                    locations={[0, 0.55, 1]}
                    style={StyleSheet.absoluteFill}
                  />
                  <View style={s.badgeRow}>
                    <View style={s.badge}><Feather name="tag" size={11} color={theme.color.brand} /><Text style={s.badgeText}>{w.season}</Text></View>
                  </View>
                  <Text style={s.cardName}>{w.name}</Text>
                </View>
                <View style={s.cardBody}>
                  {w.features.map((f, i) => (
                    <View key={i} style={s.featureRow}>
                      <Feather name="check" size={14} color={theme.color.brand} />
                      <Text style={s.featureText}>{f}</Text>
                    </View>
                  ))}
                  <View style={s.priceRow}>
                    <View style={s.priceBlock}>
                      <Text style={s.priceLabel}>Cena</Text>
                      <Text style={[s.priceValue, { color: theme.color.brand }]}>{formatPLN(w.price_per_child)}<Text style={{ fontSize: 13, color: theme.color.onSurfaceSecondary }}> /dziecko</Text></Text>
                    </View>
                  </View>
                  <Text style={s.noteText}>Opiekunowie gratis · Kiełbaska i napoje w cenie</Text>
                  <Pressable
                    testID={`workshop-create-${w.id}`}
                    style={s.actionBtn}
                    onPress={() => createFromWorkshop(w)}
                  >
                    <Feather name="plus" size={14} color={theme.color.onBrand} />
                    <Text style={s.actionBtnText}>Utwórz imprezę z tego pakietu</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: 20, paddingBottom: 12, paddingTop: 8 },
  brand: { color: theme.color.onSurfaceSecondary, letterSpacing: 3, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  title: { color: theme.color.onSurface, fontSize: 24, fontWeight: "700" },
  sourceRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  sourceText: { color: theme.color.brand, fontSize: 12, fontWeight: "600" },
  tabBar: {
    flexDirection: "row", marginHorizontal: 20, backgroundColor: theme.color.surfaceSecondary,
    borderRadius: 999, padding: 4, borderWidth: 1, borderColor: theme.color.border,
  },
  tabBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 10, borderRadius: 999,
  },
  tabBtnActive: { backgroundColor: theme.color.brand },
  tabText: { color: theme.color.onSurfaceSecondary, fontSize: 13, fontWeight: "700" },
  tabTextActive: { color: theme.color.onBrand },
  chipsRow: { height: 56, marginTop: 8, flexGrow: 0 },
  chip: {
    height: 36, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1,
    borderColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  chipActive: { borderColor: theme.color.brand, backgroundColor: theme.color.brand },
  chipText: { color: theme.color.onSurfaceSecondary, fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: theme.color.onBrand },
  infoBox: {
    flexDirection: "row", alignItems: "center", gap: 8, padding: 12, marginTop: 12, marginBottom: 8,
    backgroundColor: "rgba(212,175,55,0.06)", borderRadius: 12,
    borderWidth: 1, borderColor: theme.color.brandTertiary,
  },
  infoText: { color: theme.color.onSurfaceSecondary, fontSize: 12, flex: 1 },
  card: {
    marginTop: 14, backgroundColor: theme.color.surfaceSecondary, borderRadius: 20,
    overflow: "hidden", borderWidth: 1, borderColor: theme.color.border,
  },
  cardHero: { height: 160, justifyContent: "flex-end", padding: 14 },
  badgeRow: { flexDirection: "row", gap: 6, marginBottom: 8, flexWrap: "wrap" },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(212,175,55,0.15)",
    borderColor: theme.color.brand, borderWidth: 1,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
  },
  badgeText: { color: theme.color.brand, fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },
  cardName: { color: theme.color.onSurface, fontSize: 24, fontWeight: "800", letterSpacing: -0.5 },
  cardBody: { padding: 16 },
  sectionLabel: { color: theme.color.brand, fontSize: 11, letterSpacing: 2, fontWeight: "800", marginBottom: 10 },
  featureRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 6 },
  featureText: { color: theme.color.onSurface, fontSize: 13, flex: 1, lineHeight: 18 },
  priceRow: { flexDirection: "row", marginTop: 14, alignItems: "center" },
  priceBlock: {},
  priceLabel: { color: theme.color.onSurfaceSecondary, fontSize: 11, letterSpacing: 1, marginBottom: 2 },
  priceValue: { color: theme.color.onSurface, fontSize: 20, fontWeight: "800" },
  noteText: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 10, fontStyle: "italic" },
  actionBtn: {
    marginTop: 14, backgroundColor: theme.color.brand, borderRadius: 12, paddingVertical: 12,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
  },
  actionBtnText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 14, letterSpacing: 0.3 },
});

import { useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, Linking,
  Modal, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme, formatPLN } from "@/src/theme";
import { BIRTHDAY_PACKAGES, WORKSHOPS, ADULT_SETS, ADULT_EXTRAS, DINNER_EXTRAS, WORKSHOP_INFO, SOURCE_URL, BirthdayPackage, Workshop } from "@/src/offers";
import { DINNER_MENU, DINNER_SECTIONS, DINNER_DISCOUNT, discountedPrice, grillProfitForecast } from "@/src/dinnerMenu";
import { CATERING_PRESET_TEMPLATES, buildPresetOfferExtras } from "@/src/cateringPresets";
import { api } from "@/src/api";
import { useMenuSettings } from "@/src/menuSettings";

type Tab = "urodziny" | "warsztaty" | "grill" | "obiad";

export default function Oferta() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("warsztaty");
  const [seasonFilter, setSeasonFilter] = useState<string>("Wszystkie");

  // Editable menu prices + custom items (per-workspace)
  const menu = useMenuSettings();
  const adultSetsLive = menu.adultSets;      // grill sets with overrides applied
  const dinnerMenuLive = menu.dinnerMenu;    // dinner items with overrides + custom

  // Cennik editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorPrices, setEditorPrices] = useState<Record<string, string>>({});
  const [editorCosts, setEditorCosts] = useState<Record<string, string>>({});
  const [editorGrill, setEditorGrill] = useState<Record<string, string>>({});
  const [editorCustom, setEditorCustom] = useState<Array<{ id: string; section: string; name: string; unit: string; base_price: string; cost_price: string }>>([]);
  const openEditor = () => {
    // Seed editor with current effective prices
    const pr: Record<string, string> = {};
    const co: Record<string, string> = {};
    dinnerMenuLive.forEach(it => {
      pr[it.id] = String(it.base_price);
      co[it.id] = String(it.cost_price);
    });
    const gr: Record<string, string> = {};
    adultSetsLive.forEach(zs => { gr[zs.id] = String(zs.price_per_person); });
    setEditorPrices(pr);
    setEditorCosts(co);
    setEditorGrill(gr);
    setEditorCustom((menu.settings.dinner_custom_items || []).map(it => ({
      id: it.id, section: it.section, name: it.name, unit: it.unit,
      base_price: String(it.base_price), cost_price: String(it.cost_price),
    })));
    setEditorOpen(true);
  };
  const saveEditor = async () => {
    // Split into overrides (only diffs from defaults) — but easier: save absolute values as overrides for all items.
    const parseNum = (v: string) => parseFloat(String(v || "").replace(",", ".")) || 0;
    const priceOv: Record<string, number> = {};
    const costOv: Record<string, number> = {};
    // Take custom item ids out — those go into dinner_custom_items
    const customIds = new Set(editorCustom.map(c => c.id));
    Object.entries(editorPrices).forEach(([id, v]) => {
      if (customIds.has(id)) return;
      const val = parseNum(v);
      if (val > 0) priceOv[id] = val;
    });
    Object.entries(editorCosts).forEach(([id, v]) => {
      if (customIds.has(id)) return;
      const val = parseNum(v);
      if (val > 0) costOv[id] = val;
    });
    const grillOv: Record<string, number> = {};
    Object.entries(editorGrill).forEach(([id, v]) => { const val = parseNum(v); if (val > 0) grillOv[id] = val; });

    const customPayload = editorCustom
      .filter(c => c.name.trim())
      .map(c => ({
        id: c.id, section: c.section, name: c.name.trim(),
        unit: c.unit || "os",
        base_price: parseNum(c.base_price),
        cost_price: parseNum(c.cost_price),
      }));

    await menu.save({
      dinner_price_overrides: priceOv,
      dinner_cost_overrides: costOv,
      dinner_custom_items: customPayload,
      grill_price_overrides: grillOv,
    });
    setEditorOpen(false);
  };
  const addCustomItem = () => {
    const id = "custom_" + Date.now();
    setEditorCustom(prev => [...prev, { id, section: "dania", name: "", unit: "os", base_price: "0", cost_price: "0" }]);
  };

  // ------ Send offer email state ------
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailMode, setEmailMode] = useState<"general" | "personalized">("general");
  const [emailType, setEmailType] = useState<"okolicznosciowe" | "firmowe" | "urodziny" | "warsztaty" | "wycieczki_szkolne" | "wycieczki_rodzice">("okolicznosciowe");
  const [emailAtt, setEmailAtt] = useState<"grill" | "dinner" | "both">("both");
  const [emailTo, setEmailTo] = useState("");
  const [emailClient, setEmailClient] = useState("");
  const [emailDate, setEmailDate] = useState("");
  const [emailPeople, setEmailPeople] = useState("");
  const [emailSet, setEmailSet] = useState<"set1" | "set2" | "set3">("set1");
  const [emailNote, setEmailNote] = useState("");
  const [emailExtras, setEmailExtras] = useState<Record<string, { qty?: string; amount?: string }>>({});
  const [emailSending, setEmailSending] = useState(false);
  const [emailDinnerExpanded, setEmailDinnerExpanded] = useState(false);

  const currentSet = adultSetsLive.find(x => x.id === emailSet);
  const emailPreviewTotal = useMemo(() => {
    const ppl = parseInt(emailPeople, 10) || 0;
    let total = (currentSet?.price_per_person || 0) * ppl;
    for (const ex of ADULT_EXTRAS) {
      const row = emailExtras[ex.id];
      if (!row) continue;
      if (ex.id === "ciasto") {
        total += parseFloat((row.amount || "").replace(",", ".")) || 0;
      } else {
        total += (parseFloat((row.qty || "").replace(",", ".")) || 0) * ex.price;
      }
    }
    // Dinner items — same qty × price rule
    for (const di of DINNER_EXTRAS) {
      const row = emailExtras[di.id];
      if (!row) continue;
      total += (parseFloat((row.qty || "").replace(",", ".")) || 0) * di.price;
    }
    return total;
  }, [currentSet, emailPeople, emailExtras]);

  const openEmailModal = () => {
    // Auto-select mode + type based on the currently active tab
    if (tab === "urodziny") {
      setEmailType("urodziny");
      setEmailMode("general");
    } else if (tab === "warsztaty") {
      setEmailType("warsztaty");
      setEmailMode("general");
    } else {
      setEmailType("okolicznosciowe");
      setEmailMode("general");
    }
    setEmailTo("");
    setEmailClient("");
    setEmailDate("");
    setEmailPeople("");
    setEmailSet("set1");
    setEmailNote("");
    setEmailExtras({});
    setEmailAtt("both");
    setEmailDinnerExpanded(false);
    setEmailOpen(true);
  };

  const isAdultType = emailType === "okolicznosciowe" || emailType === "firmowe";

  const sendEmail = async () => {
    if (!emailTo.trim() || !emailTo.includes("@")) {
      Alert.alert("Błąd", "Podaj poprawny adres e-mail klienta.");
      return;
    }
    setEmailSending(true);
    try {
      // Personalization only meaningful for adult grill events
      const isPersonalized = emailMode === "personalized" && isAdultType;
      const extrasPayload: any[] = isPersonalized
        ? (Object.entries(emailExtras)
            .map(([id, v]) => {
              if (id === "ciasto") {
                const amount = parseFloat((v.amount || "").replace(",", ".")) || 0;
                return amount > 0 ? { id, amount } : null;
              }
              const qty = parseFloat((v.qty || "").replace(",", ".")) || 0;
              return qty > 0 ? { id, qty } : null;
            })
            .filter(Boolean) as any[])
        : [];
      const people = isPersonalized ? (parseInt(emailPeople, 10) || undefined) : undefined;
      await api.sendOfferEmail({
        to_email: emailTo.trim(),
        client_name: emailClient.trim() || undefined,
        event_date: emailDate.trim() || undefined,
        people_count: people,
        package_set_id: isPersonalized ? emailSet : undefined,
        extras: extrasPayload,
        custom_note: emailNote.trim() || undefined,
        event_type: emailType,
        attachments_mode: isAdultType ? emailAtt : undefined,
      });
      setEmailOpen(false);
      Alert.alert("Wysłano ✓", `Oferta poszła na ${emailTo.trim()}.`);
    } catch (e: any) {
      Alert.alert("Nie udało się wysłać", e?.message || "Spróbuj ponownie.");
    } finally {
      setEmailSending(false);
    }
  };

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
        <View style={{ flex: 1 }}>
          <Text style={s.brand}>Oferta</Text>
          <Text style={s.title}>Jesienne Warsztaty 2026</Text>
          <Pressable testID="source-link" onPress={() => Linking.openURL(SOURCE_URL)} style={s.sourceRow}>
            <Feather name="external-link" size={12} color={theme.color.brand} />
            <Text style={s.sourceText}>Biesiada pod Lasem</Text>
          </Pressable>
        </View>
        <Pressable testID="send-offer-btn" onPress={openEmailModal} style={s.sendBtn} hitSlop={8}>
          <Feather name="mail" size={16} color={theme.color.onBrand} />
          <Text style={s.sendBtnText}>Wyślij</Text>
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
        <Pressable
          testID="tab-grill"
          onPress={() => setTab("grill")}
          style={[s.tabBtn, tab === "grill" && s.tabBtnActive]}
        >
          <Feather name="disc" size={14} color={tab === "grill" ? theme.color.onBrand : theme.color.onSurfaceSecondary} />
          <Text style={[s.tabText, tab === "grill" && s.tabTextActive]}>Grill ({adultSetsLive.length})</Text>
        </Pressable>
        <Pressable
          testID="tab-obiad"
          onPress={() => setTab("obiad")}
          style={[s.tabBtn, tab === "obiad" && s.tabBtnActive]}
        >
          <Feather name="coffee" size={14} color={tab === "obiad" ? theme.color.onBrand : theme.color.onSurfaceSecondary} />
          <Text style={[s.tabText, tab === "obiad" && s.tabTextActive]}>Obiad ({dinnerMenuLive.length})</Text>
        </Pressable>
      </View>

      {/* Edit prices button — visible only for grill/obiad tabs */}
      {(tab === "grill" || tab === "obiad") && (
        <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 6 }}>
          <Pressable testID="edit-menu-prices" onPress={openEditor} style={s.editPricesBtn}>
            <Feather name="edit-2" size={13} color={theme.color.brand} />
            <Text style={s.editPricesText}>Edytuj cennik i pozycje</Text>
          </Pressable>
        </View>
      )}

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
        {tab === "grill" ? (
          <>
            <View style={s.infoBox}>
              <Feather name="info" size={14} color={theme.color.brand} />
              <Text style={s.infoText}>Grill menu · Imprezy dla dorosłych (firmowe / okolicznościowe) · cena od osoby</Text>
            </View>
            {adultSetsLive.map(zs => {
              const forecast = grillProfitForecast(zs.id, zs.price_per_person, 50);
              return (
              <View key={zs.id} style={s.card} testID={`grill-card-${zs.id}`}>
                <View style={s.cardBody}>
                  <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 12 }}>
                    <Text style={s.cardName}>{zs.name}</Text>
                    <Text style={[s.priceValue, { color: theme.color.brand }]}>{zs.price_per_person} zł<Text style={{ fontSize: 13, color: theme.color.onSurfaceSecondary }}> /os.</Text></Text>
                  </View>
                  {/* Profit forecast strip */}
                  <View style={{ flexDirection: "row", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: theme.color.error + "1A", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 }}>
                      <Feather name="trending-down" size={11} color={theme.color.error} />
                      <Text style={{ fontSize: 11, fontWeight: "700", color: theme.color.error }}>Koszt {forecast.cost_per_person} zł/os.</Text>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: theme.color.brand + "1A", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 }}>
                      <Feather name="trending-up" size={11} color={theme.color.brand} />
                      <Text style={{ fontSize: 11, fontWeight: "700", color: theme.color.brand }}>Zysk {forecast.profit_per_person} zł/os. ({(forecast.margin * 100).toFixed(0)}%)</Text>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: theme.color.surfaceTertiary, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 }}>
                      <Feather name="users" size={11} color={theme.color.onSurfaceSecondary} />
                      <Text style={{ fontSize: 11, fontWeight: "700", color: theme.color.onSurfaceSecondary }}>50 os. → {forecast.total_profit.toLocaleString("pl-PL")} zł zysku</Text>
                    </View>
                  </View>
                  <Text style={s.sectionLabel}>W zestawie</Text>
                  {zs.items.map((it, i) => (
                    <View key={i} style={s.featureRow}>
                      <Feather name="check" size={14} color={theme.color.brand} />
                      <Text style={s.featureText}>{it}</Text>
                    </View>
                  ))}
                  <Text style={[s.sectionLabel, { marginTop: 12 }]}>Dodatki w cenie</Text>
                  {zs.addons.map((it, i) => (
                    <View key={i} style={s.featureRow}>
                      <Feather name="plus" size={14} color={theme.color.onSurfaceSecondary} />
                      <Text style={s.featureText}>{it}</Text>
                    </View>
                  ))}
                  <Pressable
                    testID={`grill-create-${zs.id}`}
                    style={s.actionBtn}
                    onPress={() => {
                      const desc = [`Grill menu · ${zs.name} · ${zs.price_per_person} zł/os.`, "", "W zestawie:", ...zs.items.map(f => `• ${f}`), "", "Dodatki w cenie:", ...zs.addons.map(f => `• ${f}`)].join("\n");
                      router.push({ pathname: "/event/[id]", params: { id: "new", name: `Impreza firmowa · ${zs.name}`, category: "dorosli/firmowe", notes: desc } as any });
                    }}
                  >
                    <Feather name="plus" size={14} color={theme.color.onBrand} />
                    <Text style={s.actionBtnText}>Utwórz imprezę z tego zestawu</Text>
                  </Pressable>
                </View>
              </View>
              );
            })}
          </>
        ) : tab === "obiad" ? (
          <>
            <View style={s.infoBox}>
              <Feather name="info" size={14} color={theme.color.brand} />
              <Text style={s.infoText}>Cennik obiadowy · przy większych zamówieniach rabat −{(DINNER_DISCOUNT * 100).toFixed(0)}% od ceny listowej</Text>
            </View>
            {DINNER_SECTIONS.map(sec => {
              const items = dinnerMenuLive.filter(m => m.section === sec.id);
              if (items.length === 0) return null;
              return (
                <View key={sec.id} style={[s.card, { padding: 14 }]}>
                  <Text style={[s.cardName, { marginBottom: 6 }]}>{sec.title}</Text>
                  {sec.note ? <Text style={{ fontSize: 11, color: theme.color.onSurfaceSecondary, marginBottom: 8, fontStyle: "italic" }}>{sec.note}</Text> : null}
                  {items.map(it => {
                    const disc = discountedPrice(it.base_price);
                    return (
                      <View key={it.id} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.color.divider }}>
                        <Text style={{ flex: 1, fontSize: 13, color: theme.color.onSurface }}>{it.name}</Text>
                        <View style={{ alignItems: "flex-end", marginLeft: 8 }}>
                          <Text style={{ fontSize: 14, fontWeight: "800", color: theme.color.brand }}>{disc} zł</Text>
                          <Text style={{ fontSize: 10, color: theme.color.onSurfaceSecondary }}>/ {it.unit}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </>
        ) : tab === "urodziny" ? (
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

      <Modal visible={emailOpen} transparent animationType="slide" onRequestClose={() => setEmailOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <Pressable style={s.backdrop} onPress={() => setEmailOpen(false)} />
          <View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={s.grip} />
            <Text style={s.sheetTitle}>Wyślij ofertę na e-mail</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={s.fieldLabel}>Typ imprezy</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {([
                  { k: "okolicznosciowe", label: "Okolicznościowa", icon: "gift" },
                  { k: "firmowe", label: "Firmowa", icon: "briefcase" },
                  { k: "urodziny", label: "Urodziny", icon: "star" },
                  { k: "warsztaty", label: "Warsztaty", icon: "feather" },
                  { k: "wycieczki_szkolne", label: "Wycieczki szkolne", icon: "map" },
                  { k: "wycieczki_rodzice", label: "Wycieczki z rodzicami", icon: "map-pin" },
                ] as const).map(t => {
                  const active = emailType === t.k;
                  return (
                    <Pressable
                      key={t.k}
                      testID={`offer-type-${t.k}`}
                      onPress={() => setEmailType(t.k)}
                      style={[s.typeBtn, active && s.typeBtnActive]}
                    >
                      <Feather name={t.icon as any} size={12} color={active ? theme.color.onBrand : theme.color.onSurfaceSecondary} />
                      <Text style={[s.typeBtnText, active && s.typeBtnTextActive]}>{t.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {isAdultType && (
                <>
                  <View style={s.modeRow}>
                    <Pressable
                      testID="offer-mode-general"
                      onPress={() => setEmailMode("general")}
                      style={[s.modeBtn, emailMode === "general" && s.modeBtnActive]}
                    >
                      <Feather name="list" size={13} color={emailMode === "general" ? theme.color.onBrand : theme.color.onSurfaceSecondary} />
                      <Text style={[s.modeBtnText, emailMode === "general" && s.modeBtnTextActive]}>Pełny katalog</Text>
                    </Pressable>
                    <Pressable
                      testID="offer-mode-personalized"
                      onPress={() => setEmailMode("personalized")}
                      style={[s.modeBtn, emailMode === "personalized" && s.modeBtnActive]}
                    >
                      <Feather name="user-check" size={13} color={emailMode === "personalized" ? theme.color.onBrand : theme.color.onSurfaceSecondary} />
                      <Text style={[s.modeBtnText, emailMode === "personalized" && s.modeBtnTextActive]}>Z propozycją</Text>
                    </Pressable>
                  </View>
                  <Text style={s.modeHint}>
                    {emailMode === "general"
                      ? "Klient dostanie pełny katalog wszystkich 3 zestawów i dodatków — sam wybierze."
                      : "Do pełnego katalogu dołączymy Twoją propozycję z wyliczeniem dla konkretnego zestawu."}
                  </Text>

                  <Text style={[s.fieldLabel, { marginTop: 12 }]}>Załączniki</Text>
                  <View style={s.modeRow}>
                    {([
                      { k: "grill",  label: "Grill",     icon: "aperture" },
                      { k: "dinner", label: "Obiadowa",  icon: "coffee" },
                      { k: "both",   label: "Obydwa",    icon: "layers" },
                    ] as const).map(a => {
                      const active = emailAtt === a.k;
                      return (
                        <Pressable
                          key={a.k}
                          testID={`offer-att-${a.k}`}
                          onPress={() => setEmailAtt(a.k)}
                          style={[s.modeBtn, active && s.modeBtnActive]}
                        >
                          <Feather name={a.icon as any} size={13} color={active ? theme.color.onBrand : theme.color.onSurfaceSecondary} />
                          <Text style={[s.modeBtnText, active && s.modeBtnTextActive]}>{a.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={s.modeHint}>
                    {emailAtt === "grill" && "W mailu będzie tylko Menu Biesiada pod Lasem 2026 (grill)."}
                    {emailAtt === "dinner" && "W mailu będzie tylko Oferta obiadowa 2026."}
                    {emailAtt === "both" && "W mailu będą oba pliki — Menu grill + Oferta obiadowa."}
                  </Text>
                </>
              )}
              {!isAdultType && (
                <Text style={s.modeHint}>
                  {emailType === "urodziny"
                    ? "Klient dostanie pełny katalog pakietów urodzinowych (START, STANDARD, GADY, KONIE, TEMATYCZNY)."
                    : "Klient dostanie pełny katalog warsztatów pogrupowanych wg pory roku."}
                </Text>
              )}

              <Text style={s.fieldLabel}>E-mail klienta *</Text>
              <TextInput
                testID="offer-email-to"
                value={emailTo}
                onChangeText={setEmailTo}
                placeholder="klient@przyklad.pl"
                placeholderTextColor={theme.color.onSurfaceSecondary}
                style={s.input}
                autoCapitalize="none"
                keyboardType="email-address"
              />

              <Text style={s.fieldLabel}>Imię / nazwa klienta</Text>
              <TextInput
                testID="offer-email-client"
                value={emailClient}
                onChangeText={setEmailClient}
                placeholder="Jan Kowalski"
                placeholderTextColor={theme.color.onSurfaceSecondary}
                style={s.input}
              />

              <Text style={s.fieldLabel}>Data imprezy (opcjonalnie)</Text>
              <TextInput
                testID="offer-email-date"
                value={emailDate}
                onChangeText={setEmailDate}
                placeholder="2026-08-15"
                placeholderTextColor={theme.color.onSurfaceSecondary}
                style={s.input}
              />

              {isAdultType && emailMode === "personalized" && (
                <>
                  <Text style={s.fieldLabel}>Liczba osób</Text>
                  <TextInput
                    testID="offer-email-people"
                    value={emailPeople}
                    onChangeText={setEmailPeople}
                    placeholder="25"
                    placeholderTextColor={theme.color.onSurfaceSecondary}
                    style={s.input}
                    keyboardType="number-pad"
                  />

                  <Text style={s.fieldLabel}>Sugerowany zestaw</Text>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {adultSetsLive.map(zs => {
                      const active = emailSet === zs.id;
                      return (
                        <Pressable
                          key={zs.id}
                          testID={`offer-set-${zs.id}`}
                          onPress={() => setEmailSet(zs.id as any)}
                          style={[s.setBtn, active && s.setBtnActive]}
                        >
                          <Text style={[s.setBtnLabel, active && s.setBtnLabelActive]}>{zs.name.replace("Zestaw nr ", "Zestaw ")}</Text>
                          <Text style={[s.setBtnPrice, active && s.setBtnPriceActive]}>{zs.price_per_person} zł/os.</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={s.fieldLabel}>Dodatki do propozycji (opcjonalnie)</Text>
                  {ADULT_EXTRAS.map(ex => (
                    <View key={ex.id} style={s.extraRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.extraName}>{ex.name}</Text>
                        <Text style={s.extraSub}>
                          {ex.id === "ciasto" ? "Wpisz kwotę PLN" : `${ex.price} zł / ${ex.unit}`}
                        </Text>
                      </View>
                      <TextInput
                        testID={`offer-extra-${ex.id}`}
                        value={ex.id === "ciasto" ? (emailExtras[ex.id]?.amount ?? "") : (emailExtras[ex.id]?.qty ?? "")}
                        onChangeText={(t) =>
                          setEmailExtras(prev => ({
                            ...prev,
                            [ex.id]: ex.id === "ciasto" ? { amount: t } : { qty: t },
                          }))
                        }
                        placeholder="0"
                        placeholderTextColor={theme.color.onSurfaceSecondary}
                        style={s.extraInput}
                        keyboardType="decimal-pad"
                      />
                    </View>
                  ))}

                  {/* Menu obiadowe — collapsible (rarely needed at pricing stage) */}
                  {(() => {
                    const dinnerCount = Object.values(emailExtras).reduce((sum, v) => {
                      const q = Number(v?.qty || 0);
                      return sum + (isNaN(q) ? 0 : q);
                    }, 0);
                    const dinnerIds = new Set(DINNER_EXTRAS.map(d => d.id));
                    const dinnerActive = Object.entries(emailExtras).filter(([id, v]) => dinnerIds.has(id) && Number(v?.qty || 0) > 0).length;
                    return (
                      <Pressable
                        testID="offer-dinner-toggle"
                        onPress={() => setEmailDinnerExpanded(v => !v)}
                        style={{
                          flexDirection: "row", alignItems: "center", gap: 10,
                          marginTop: 20, padding: 12, borderRadius: 12,
                          backgroundColor: dinnerActive > 0 ? theme.color.brand + "18" : theme.color.surfaceSecondary,
                          borderWidth: 1, borderColor: dinnerActive > 0 ? theme.color.brand + "55" : theme.color.border,
                        }}
                      >
                        <Feather name="coffee" size={16} color={theme.color.brand} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.color.onSurface, fontSize: 14, fontWeight: "800" }}>
                            Menu obiadowe {dinnerActive > 0 ? `· ${dinnerActive} poz. · ${dinnerCount} porcji` : "(opcjonalnie)"}
                          </Text>
                          {!emailDinnerExpanded && dinnerActive === 0 && (
                            <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 }}>
                              Kliknij, żeby rozwinąć zupy, dania główne i dodatki
                            </Text>
                          )}
                        </View>
                        <Feather name={emailDinnerExpanded ? "chevron-up" : "chevron-down"} size={18} color={theme.color.onSurfaceSecondary} />
                      </Pressable>
                    );
                  })()}
                  {emailDinnerExpanded && (
                    <View style={{ marginTop: 12, marginBottom: 4 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                        <Feather name="zap" size={12} color={theme.color.brand} />
                        <Text style={{ color: theme.color.onSurface, fontSize: 12, fontWeight: "800", letterSpacing: 0.3, textTransform: "uppercase" }}>Szybki wybór</Text>
                        <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 11 }}>· na {parseInt(emailPeople, 10) || 0} osób</Text>
                      </View>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
                        {CATERING_PRESET_TEMPLATES.map(tpl => (
                          <Pressable
                            key={tpl.id}
                            testID={`offer-catering-preset-${tpl.id}`}
                            onPress={() => {
                              const ppl = parseInt(emailPeople, 10) || 0;
                              if (ppl <= 0) {
                                Alert.alert("Wpisz liczbę osób", "Ustaw ilu jest gości, żeby zastosować preset.");
                                return;
                              }
                              const next = buildPresetOfferExtras(tpl.id, ppl);
                              setEmailExtras(prev => ({ ...prev, ...next }));
                            }}
                            style={{
                              minWidth: 180, maxWidth: 240,
                              padding: 10, borderRadius: 12,
                              backgroundColor: theme.color.brand + "18",
                              borderWidth: 1, borderColor: theme.color.brand + "55",
                            }}
                          >
                            <Text style={{ color: theme.color.brand, fontWeight: "800", fontSize: 13 }}>{tpl.label}</Text>
                            <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 10, marginTop: 2 }} numberOfLines={2}>{tpl.description}</Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                      <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 10, marginTop: 6, fontStyle: "italic" }}>
                        Preset dodaje porcje × liczba osób.
                      </Text>
                    </View>
                  )}
                  {emailDinnerExpanded && (["Zupa", "Danie główne", "Dodatek"] as const).map(section => (
                    <View key={section}>
                      <Text style={[s.fieldLabel, { marginTop: 16 }]}>Menu obiadowe · {section}</Text>
                      {DINNER_EXTRAS.filter(d => d.section === section).map(di => (
                        <View key={di.id} style={s.extraRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={s.extraName}>{di.name}</Text>
                            <Text style={s.extraSub}>{di.price} zł / porcja</Text>
                          </View>
                          <TextInput
                            testID={`offer-dinner-${di.id}`}
                            value={emailExtras[di.id]?.qty ?? ""}
                            onChangeText={(t) =>
                              setEmailExtras(prev => ({ ...prev, [di.id]: { qty: t } }))
                            }
                            placeholder="0"
                            placeholderTextColor={theme.color.onSurfaceSecondary}
                            style={s.extraInput}
                            keyboardType="decimal-pad"
                          />
                        </View>
                      ))}
                    </View>
                  ))}

                  <View style={s.totalCard}>
                    <Text style={s.totalLabel}>Szacunkowy koszt propozycji</Text>
                    <Text style={s.totalValue}>{formatPLN(emailPreviewTotal)}</Text>
                  </View>
                </>
              )}

              <Text style={s.fieldLabel}>Uwagi (opcjonalnie)</Text>
              <TextInput
                testID="offer-email-note"
                value={emailNote}
                onChangeText={setEmailNote}
                placeholder="Dodatkowe informacje dla klienta..."
                placeholderTextColor={theme.color.onSurfaceSecondary}
                style={[s.input, { minHeight: 70, textAlignVertical: "top" }]}
                multiline
              />

              <Pressable
                testID="offer-send-btn"
                onPress={sendEmail}
                disabled={emailSending || !emailTo.trim()}
                style={[s.saveBtn, (emailSending || !emailTo.trim()) && { opacity: 0.5 }]}
              >
                {emailSending ? (
                  <ActivityIndicator color={theme.color.onBrand} />
                ) : (
                  <>
                    <Feather name="send" size={16} color={theme.color.onBrand} />
                    <Text style={s.saveBtnText}>Wyślij ofertę PDF</Text>
                  </>
                )}
              </Pressable>
              <Text style={s.footerNote}>
                Wysyłamy z: biesiadapodlasem@gmail.com · Klient odpowie bezpośrednio do Ciebie.
              </Text>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ---------- Menu Editor Modal ---------- */}
      <Modal visible={editorOpen} transparent animationType="slide" onRequestClose={() => setEditorOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <Pressable style={s.backdrop} onPress={() => setEditorOpen(false)} />
          <View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={s.sheetHandle} />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <Text style={s.sheetTitle}>Edytor cennika</Text>
              <Pressable testID="editor-save" onPress={saveEditor} disabled={menu.saving} style={s.saveBtn}>
                {menu.saving ? <ActivityIndicator color={theme.color.onBrand} size="small" /> : <Text style={s.saveBtnText}>Zapisz</Text>}
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 620 }} contentContainerStyle={{ paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
              <Text style={s.editorSection}>Grill — cena za osobę</Text>
              {adultSetsLive.map(zs => (
                <View key={zs.id} style={s.editorRow}>
                  <Text style={s.editorRowName} numberOfLines={1}>{zs.name}</Text>
                  <TextInput
                    testID={`edit-grill-${zs.id}`}
                    value={editorGrill[zs.id] ?? ""}
                    onChangeText={(v) => setEditorGrill(p => ({ ...p, [zs.id]: v }))}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={theme.color.onSurfaceSecondary}
                    style={s.editorInput}
                  />
                  <Text style={s.editorSuf}>zł/os.</Text>
                </View>
              ))}

              <Text style={[s.editorSection, { marginTop: 16 }]}>Menu obiadowe — cena klienta / koszt zakupu</Text>
              {DINNER_SECTIONS.map(sec => (
                <View key={sec.id}>
                  <Text style={s.editorSubHeader}>{sec.title}</Text>
                  {dinnerMenuLive.filter(m => m.section === sec.id && !m.id.startsWith("custom_")).map(it => (
                    <View key={it.id} style={s.editorRow}>
                      <Text style={s.editorRowName} numberOfLines={1}>{it.name}</Text>
                      <TextInput
                        testID={`edit-price-${it.id}`}
                        value={editorPrices[it.id] ?? ""}
                        onChangeText={(v) => setEditorPrices(p => ({ ...p, [it.id]: v }))}
                        keyboardType="decimal-pad"
                        placeholder="cena"
                        placeholderTextColor={theme.color.onSurfaceSecondary}
                        style={s.editorInput}
                      />
                      <TextInput
                        testID={`edit-cost-${it.id}`}
                        value={editorCosts[it.id] ?? ""}
                        onChangeText={(v) => setEditorCosts(p => ({ ...p, [it.id]: v }))}
                        keyboardType="decimal-pad"
                        placeholder="koszt"
                        placeholderTextColor={theme.color.onSurfaceSecondary}
                        style={s.editorInputSmall}
                      />
                    </View>
                  ))}
                </View>
              ))}

              <View style={{ marginTop: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={s.editorSection}>Własne pozycje cateringu</Text>
                <Pressable testID="editor-add-custom" onPress={addCustomItem} style={s.addCustomBtn}>
                  <Feather name="plus" size={12} color={theme.color.brand} />
                  <Text style={s.addCustomText}>Dodaj pozycję</Text>
                </Pressable>
              </View>
              {editorCustom.length === 0 && (
                <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 12, padding: 8 }}>Brak — dodaj własną pozycję (np. deser autorski).</Text>
              )}
              {editorCustom.map((c, i) => (
                <View key={c.id} style={s.customCard}>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <TextInput
                      testID={`custom-name-${i}`}
                      value={c.name}
                      onChangeText={(v) => setEditorCustom(prev => prev.map((x, ix) => ix === i ? { ...x, name: v } : x))}
                      placeholder="Nazwa (np. Kaczka z żurawiną)"
                      placeholderTextColor={theme.color.onSurfaceSecondary}
                      style={[s.editorInput, { flex: 2 }]}
                    />
                    <TextInput
                      testID={`custom-unit-${i}`}
                      value={c.unit}
                      onChangeText={(v) => setEditorCustom(prev => prev.map((x, ix) => ix === i ? { ...x, unit: v } : x))}
                      placeholder="os / szt"
                      placeholderTextColor={theme.color.onSurfaceSecondary}
                      style={[s.editorInputSmall, { flex: 1 }]}
                    />
                  </View>
                  <View style={{ flexDirection: "row", gap: 6, marginTop: 6, alignItems: "center" }}>
                    <View style={s.pillPicker}>
                      {["zupy", "dania", "dodatki"].map(sid => (
                        <Pressable
                          key={sid}
                          onPress={() => setEditorCustom(prev => prev.map((x, ix) => ix === i ? { ...x, section: sid } : x))}
                          style={[s.pillBtn, c.section === sid && s.pillBtnActive]}
                        >
                          <Text style={[s.pillBtnText, c.section === sid && { color: "#FFF" }]}>{DINNER_SECTIONS.find(s => s.id === sid)?.title}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <TextInput
                      testID={`custom-price-${i}`}
                      value={c.base_price}
                      onChangeText={(v) => setEditorCustom(prev => prev.map((x, ix) => ix === i ? { ...x, base_price: v } : x))}
                      keyboardType="decimal-pad"
                      placeholder="cena"
                      placeholderTextColor={theme.color.onSurfaceSecondary}
                      style={s.editorInput}
                    />
                    <TextInput
                      testID={`custom-cost-${i}`}
                      value={c.cost_price}
                      onChangeText={(v) => setEditorCustom(prev => prev.map((x, ix) => ix === i ? { ...x, cost_price: v } : x))}
                      keyboardType="decimal-pad"
                      placeholder="koszt"
                      placeholderTextColor={theme.color.onSurfaceSecondary}
                      style={s.editorInputSmall}
                    />
                    <Pressable
                      testID={`custom-del-${i}`}
                      onPress={() => setEditorCustom(prev => prev.filter((_, ix) => ix !== i))}
                      hitSlop={10}
                    >
                      <Feather name="trash-2" size={16} color={theme.color.error} />
                    </Pressable>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: 20, paddingBottom: 12, paddingTop: 8, flexDirection: "row", alignItems: "flex-end" },
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
  sendBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: theme.color.brand, paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 999,
  },
  sendBtnText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 13, letterSpacing: 0.3 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    backgroundColor: theme.color.surfaceSecondary, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12, borderWidth: 1, borderColor: theme.color.border,
    maxHeight: "88%",
  },
  grip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.color.borderStrong, marginBottom: 12 },
  sheetTitle: { color: theme.color.onSurface, fontSize: 18, fontWeight: "700", marginBottom: 4 },
  fieldLabel: { color: theme.color.onSurfaceSecondary, fontSize: 12, letterSpacing: 1, marginTop: 14, marginBottom: 6 },
  input: {
    backgroundColor: theme.color.surfaceTertiary, borderRadius: 12, color: theme.color.onSurface,
    paddingHorizontal: 14, paddingVertical: 14, fontSize: 15, borderWidth: 1, borderColor: theme.color.border,
  },
  setBtn: {
    flex: 1, paddingVertical: 12, paddingHorizontal: 8, borderRadius: 12,
    backgroundColor: theme.color.surfaceTertiary, borderWidth: 1, borderColor: theme.color.border,
    alignItems: "center",
  },
  setBtnActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  setBtnLabel: { color: theme.color.onSurface, fontWeight: "700", fontSize: 13 },
  setBtnLabelActive: { color: theme.color.onBrand },
  setBtnPrice: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  setBtnPriceActive: { color: theme.color.onBrand, opacity: 0.85 },
  extraRow: {
    flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8,
    backgroundColor: theme.color.surfaceTertiary, borderRadius: 12, padding: 10,
    borderWidth: 1, borderColor: theme.color.border,
  },
  extraName: { color: theme.color.onSurface, fontSize: 13, fontWeight: "600" },
  extraSub: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  extraInput: {
    width: 78, textAlign: "center", backgroundColor: theme.color.surface, borderRadius: 10,
    color: theme.color.onSurface, paddingVertical: 10, fontSize: 14,
    borderWidth: 1, borderColor: theme.color.border,
  },
  totalCard: {
    marginTop: 18, backgroundColor: theme.color.surfaceTertiary,
    borderWidth: 1, borderColor: theme.color.brand, borderRadius: 14,
    padding: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  totalLabel: { color: theme.color.onSurfaceSecondary, fontSize: 12, letterSpacing: 1 },
  totalValue: { color: theme.color.brand, fontSize: 22, fontWeight: "800" },
  saveBtn: {
    marginTop: 16, backgroundColor: theme.color.brand, borderRadius: 12, paddingVertical: 15,
    alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8,
  },
  saveBtnText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 15 },
  // Menu editor styles
  editPricesBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: theme.color.brand,
    backgroundColor: theme.color.brand + "12",
  },
  editPricesText: { color: theme.color.brand, fontWeight: "700", fontSize: 12 },
  editorSection: { color: theme.color.onSurface, fontWeight: "800", fontSize: 14, marginBottom: 8, marginTop: 4 },
  editorSubHeader: { color: theme.color.onSurfaceSecondary, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginTop: 10, marginBottom: 4 },
  editorRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 5 },
  editorRowName: { flex: 1, color: theme.color.onSurface, fontSize: 13 },
  editorInput: {
    width: 68, paddingHorizontal: 8, paddingVertical: 7,
    borderWidth: 1, borderColor: theme.color.border, borderRadius: 8,
    backgroundColor: theme.color.surface, color: theme.color.onSurface, fontSize: 13, textAlign: "right",
  },
  editorInputSmall: {
    width: 62, paddingHorizontal: 8, paddingVertical: 7,
    borderWidth: 1, borderColor: theme.color.border, borderRadius: 8,
    backgroundColor: theme.color.surfaceSecondary, color: theme.color.onSurface, fontSize: 12, textAlign: "right",
  },
  editorSuf: { color: theme.color.onSurfaceSecondary, fontSize: 11, width: 40 },
  addCustomBtn: {
    flexDirection: "row", gap: 4, alignItems: "center",
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    borderWidth: 1, borderColor: theme.color.brand, backgroundColor: theme.color.brand + "12",
  },
  addCustomText: { color: theme.color.brand, fontWeight: "700", fontSize: 12 },
  customCard: {
    padding: 8, marginTop: 6, borderRadius: 12,
    backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.divider,
  },
  pillPicker: {
    flexDirection: "row", gap: 4, backgroundColor: theme.color.surface,
    padding: 2, borderRadius: 999, borderWidth: 1, borderColor: theme.color.border,
  },
  pillBtn: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999 },
  pillBtnActive: { backgroundColor: theme.color.brand },
  pillBtnText: { color: theme.color.onSurfaceSecondary, fontSize: 10, fontWeight: "700" },
  footerNote: { color: theme.color.onSurfaceSecondary, fontSize: 11, textAlign: "center", marginTop: 10, fontStyle: "italic" },
  modeRow: {
    flexDirection: "row", gap: 6, marginTop: 4, marginBottom: 6,
    backgroundColor: theme.color.surfaceTertiary, borderRadius: 999, padding: 4,
    borderWidth: 1, borderColor: theme.color.border,
  },
  modeBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 10, borderRadius: 999,
  },
  modeBtnActive: { backgroundColor: theme.color.brand },
  modeBtnText: { color: theme.color.onSurfaceSecondary, fontWeight: "700", fontSize: 12 },
  modeBtnTextActive: { color: theme.color.onBrand },
  modeHint: { color: theme.color.onSurfaceSecondary, fontSize: 11, fontStyle: "italic", marginBottom: 2 },
  typeBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    backgroundColor: theme.color.surfaceTertiary,
    borderWidth: 1, borderColor: theme.color.border,
  },
  typeBtnActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  typeBtnText: { color: theme.color.onSurfaceSecondary, fontSize: 12, fontWeight: "700" },
  typeBtnTextActive: { color: theme.color.onBrand },
});

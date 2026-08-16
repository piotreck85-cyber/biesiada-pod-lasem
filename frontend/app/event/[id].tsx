import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView,
  Platform, ActivityIndicator, Modal, Alert, Linking,
} from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme, formatPLN, initials } from "@/src/theme";
import { api } from "@/src/api";
import { CATEGORY_GROUPS, categoryLabel } from "@/src/categories";
import { computePricing } from "@/src/pricing";
import { ADULT_SETS, ADULT_EXTRAS, findAdultSet, extrasFor } from "@/src/offers";
import { DINNER_MENU, DINNER_SECTIONS, discountedPrice, DINNER_DISCOUNT, dinnerAutoCost } from "@/src/dinnerMenu";

type Cost = { label: string; amount: number };
type Shift = { staff_id: string; hours: number };

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hoursBetween(start?: string, end?: string): number {
  if (!start || !end) return 0;
  const parse = (v: string) => {
    const [h, m] = v.split(":").map(x => parseInt(x, 10));
    if (isNaN(h)) return null;
    return h + (isNaN(m) ? 0 : m) / 60;
  };
  const s = parse(start); const e = parse(end);
  if (s === null || e === null) return 0;
  let diff = e - s;
  if (diff < 0) diff += 24;
  return Math.round(diff * 100) / 100;
}

export default function EventDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, date: initDate, name: initName, category: initCategory, notes: initNotes, revenue: initRevenue, image_url: initImage } = useLocalSearchParams<{
    id: string; date?: string; name?: string; category?: string; notes?: string; revenue?: string; image_url?: string;
  }>();
  const isNew = id === "new";

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(initName || "");
  const [date, setDate] = useState(initDate || todayIso());
  const [timeStart, setTimeStart] = useState("");
  const [timeEnd, setTimeEnd] = useState("");
  const [notes, setNotes] = useState(initNotes || "");
  const [revenue, setRevenue] = useState(initRevenue || "");
  const [people, setPeople] = useState("");
  const [packageSet, setPackageSet] = useState<string>("");
  const [revenueNet, setRevenueNet] = useState("");
  const [autoPrice, setAutoPrice] = useState(true);
  const [extras, setExtras] = useState<Record<string, number>>({}); // extra_id -> qty (or amount for 'kwota')
  const [dinnerQty, setDinnerQty] = useState<Record<string, number>>({}); // dinner_item_id -> qty
  const [dinnerCost, setDinnerCost] = useState<string>(""); // user-entered wholesale cost for margin calc
  const [costs, setCosts] = useState<Cost[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [staffAll, setStaffAll] = useState<any[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState(initImage || "");
  const [category, setCategory] = useState<string>(initCategory || "");
  const [catPickerOpen, setCatPickerOpen] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [tplPickerOpen, setTplPickerOpen] = useState(false);
  // ---- Status, Client, Payment, Weather (new) ----
  const [status, setStatus] = useState<string>("");
  const [validUntil, setValidUntil] = useState<string>("");
  const [clientName, setClientName] = useState<string>("");
  const [clientPhone, setClientPhone] = useState<string>("");
  const [clientEmail, setClientEmail] = useState<string>("");
  const [clientNotes, setClientNotes] = useState<string>("");
  const [priceTotal, setPriceTotal] = useState<string>("");
  const [discountPct, setDiscountPct] = useState<string>("");
  const [depositPaid, setDepositPaid] = useState<boolean>(false);
  const [depositAmount, setDepositAmount] = useState<string>("");
  const [depositDate, setDepositDate] = useState<string>("");
  const [weather, setWeather] = useState<any | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try { setStaffAll(await api.listStaff()); } catch {}
      try { setTemplates(await api.listTemplates()); } catch {}
      if (!isNew) {
        try {
          const ev: any = await api.getEvent(id as string);
          setName(ev.name); setDate(ev.date);
          setTimeStart(ev.time_start || ev.time || "");
          setTimeEnd(ev.time_end || "");
          setNotes(ev.notes || ""); setRevenue(String(ev.revenue || ""));
          setCosts(ev.costs || []); setShifts(ev.shifts || []);
          setImageUrl(ev.image_url || "");
          setCategory(ev.category || "");
          setPeople(ev.people ? String(ev.people) : "");
          setPackageSet(ev.package_set || "");
          setRevenueNet(ev.revenue_net ? String(ev.revenue_net) : "");
          if (ev.extras_qty && typeof ev.extras_qty === "object") {
            setExtras(ev.extras_qty as Record<string, number>);
          }
          setAutoPrice(false); // editing existing event: don't override user's saved revenue
          // New fields
          setStatus(ev.status || "");
          setValidUntil(ev.valid_until || "");
          setClientName(ev.client_name || "");
          setClientPhone(ev.client_phone || "");
          setClientEmail(ev.client_email || "");
          setClientNotes(ev.client_notes || "");
          setPriceTotal(ev.price_total ? String(ev.price_total) : "");
          setDiscountPct(ev.discount_pct ? String(ev.discount_pct) : "");
          setDepositPaid(!!ev.deposit_paid);
          setDepositAmount(ev.deposit_amount ? String(ev.deposit_amount) : "");
          setDepositDate(ev.deposit_date || "");
          // ---- Dinner offer ----
          if (ev.dinner_items && typeof ev.dinner_items === "object") {
            setDinnerQty(ev.dinner_items as Record<string, number>);
          }
          setDinnerCost(ev.dinner_cost ? String(ev.dinner_cost) : "");
        } catch {} finally { setLoading(false); }
      }
    })();
  }, [id]);

  const staffMap = useMemo(() => {
    const m: Record<string, any> = {};
    staffAll.forEach(s => m[s.id] = s);
    return m;
  }, [staffAll]);

  const laborCost = useMemo(() => {
    return shifts.reduce((sum, sh) => {
      const s = staffMap[sh.staff_id];
      return sum + (s ? (sh.hours || 0) * (s.hourly_rate || 0) : 0);
    }, 0);
  }, [shifts, staffMap]);
  const materialCost = useMemo(() => costs.reduce((s, c) => s + (Number(c.amount) || 0), 0), [costs]);
  const revenueNum = parseFloat(revenue.replace(",", ".")) || 0;
  const profit = revenueNum - laborCost - materialCost;

  const peopleNum = parseInt(people, 10) || 0;
  const isAdult = category.startsWith("dorosli");
  const isBirthday = category.startsWith("dzieci/urodzinki");
  const isParentTrip = category === "dzieci/wycieczki_rodzice";
  const activeExtras = extrasFor(category);
  const extrasTotal = useMemo(() => {
    return activeExtras.reduce((sum, e) => {
      const q = extras[e.id] || 0;
      if (e.unit === "kwota") return sum + q;
      return sum + q * e.price;
    }, 0);
  }, [extras, activeExtras]);
  const pricing = useMemo(
    () => computePricing(category, date, peopleNum, packageSet),
    [category, date, peopleNum, packageSet]
  );
  const parseAmt = (v: string) => parseFloat(String(v || "").replace(",", ".")) || 0;

  // Dinner-only aggregation (for margin calc)
  const dinnerRevenue = useMemo(() => {
    return Object.entries(dinnerQty).reduce((s, [id, q]) => {
      const it = DINNER_MENU.find(m => m.id === id);
      if (!it || !q) return s;
      return s + discountedPrice(it.base_price) * q;
    }, 0);
  }, [dinnerQty]);
  // Auto purchase cost (hidden): sum of cost_price × qty. User can still override via dinnerCost input.
  const dinnerAutoCostVal = useMemo(() => dinnerAutoCost(dinnerQty), [dinnerQty]);
  const dinnerCostOverride = parseAmt(dinnerCost);
  const dinnerCostNum = dinnerCostOverride > 0 ? dinnerCostOverride : dinnerAutoCostVal;
  const dinnerMargin = dinnerRevenue > 0 ? ((dinnerRevenue - dinnerCostNum) / dinnerRevenue) * 100 : 0;
  const dinnerProfit = dinnerRevenue - dinnerCostNum;

  const combinedTotal = (pricing?.total || 0) + extrasTotal + dinnerRevenue;

  // Auto-price when computable and user hasn't manually overridden
  useEffect(() => {
    if (autoPrice && (pricing || extrasTotal > 0)) {
      setRevenue(String(combinedTotal));
      // Also propose it as the "Całkowita cena imprezy" if empty
      setPriceTotal(prev => (!prev || prev === "0" || prev === String(revenueNum)) ? String(combinedTotal) : prev);
    }
  }, [combinedTotal, autoPrice]);

  const save = async () => {
    if (!name.trim() || !date) return;
    setSaving(true);
    const body = {
      name: name.trim(), date,
      time_start: timeStart, time_end: timeEnd, time: timeStart,
      venue: "Biesiada pod lasem",
      notes, category,
      people: peopleNum,
      package_set: packageSet,
      extras_qty: extras,
      revenue: revenueNum,
      revenue_net: parseFloat(revenueNet.replace(",", ".")) || 0,
      // ---- Dinner offer ----
      dinner_items: dinnerQty,
      dinner_cost: parseAmt(dinnerCost),
      dinner_revenue: dinnerRevenue,
      dinner_profit: dinnerProfit,
      dinner_margin_pct: Number(dinnerMargin.toFixed(2)),
      // ---- Status ----
      status: status || "",
      valid_until: validUntil || "",
      // ---- Client ----
      client_name: clientName.trim(),
      client_phone: clientPhone.trim(),
      client_email: clientEmail.trim(),
      client_notes: clientNotes.trim(),
      // ---- Payment ----
      price_total: parseAmt(priceTotal),
      discount_pct: parseAmt(discountPct),
      price_after_discount: (function(){
        const t = parseAmt(priceTotal); const d = parseAmt(discountPct);
        return d > 0 ? Number((t * (1 - d / 100)).toFixed(2)) : t;
      })(),
      deposit_paid: !!depositPaid,
      deposit_amount: parseAmt(depositAmount),
      deposit_date: depositDate || "",
      costs: costs.map(c => ({ label: c.label, amount: Number(c.amount) || 0 })),
      shifts: shifts.map(sh => ({
        staff_id: sh.staff_id,
        hours: Number(sh.hours) || 0,
        time_start: sh.time_start || "",
        time_end: sh.time_end || "",
      })),
      image_url: imageUrl,
    };
    try {
      if (isNew) await api.createEvent(body);
      else await api.updateEvent(id as string, body);
      router.back();
    } catch {} finally { setSaving(false); }
  };

  const remove = async () => {
    if (isNew) return;
    await api.deleteEvent(id as string);
    router.back();
  };

  const addStaff = (staffId: string) => {
    if (shifts.some(sh => sh.staff_id === staffId)) return;
    setShifts([...shifts, { staff_id: staffId, hours: 0 }]);
    setPickerOpen(false);
  };

  const pickImage = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.5, mediaTypes: ImagePicker.MediaTypeOptions.Images })
      : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.5, mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (!res.canceled && res.assets && res.assets[0]) {
      const a = res.assets[0];
      const b64 = a.base64;
      if (b64) setImageUrl(`data:image/jpeg;base64,${b64}`);
      else if (a.uri) setImageUrl(a.uri);
    }
  };

  const showImagePicker = () => {
    if (Platform.OS === "web") { pickImage(false); return; }
    Alert.alert("Zdjęcie", "Skąd chcesz dodać zdjęcie?", [
      { text: "Anuluj", style: "cancel" },
      { text: "Galeria", onPress: () => pickImage(false) },
      { text: "Aparat", onPress: () => pickImage(true) },
    ]);
  };

  const saveAsTemplate = async () => {
    if (!name.trim()) return;
    try {
      await api.createTemplate({
        name: name.trim(), venue: "Biesiada pod lasem", notes, category,
        revenue: revenueNum,
        costs, shifts, image_url: imageUrl,
      });
      const list = await api.listTemplates();
      setTemplates(list);
      Alert.alert("Zapisano", "Szablon został zapisany.");
    } catch (e: any) { Alert.alert("Błąd", e.message || "Nie udało się"); }
  };

  const applyTemplate = (tpl: any) => {
    setName(tpl.name || "");
    setNotes(tpl.notes || "");
    setRevenue(String(tpl.revenue || ""));
    setCosts(tpl.costs || []);
    setShifts(tpl.shifts || []);
    setImageUrl(tpl.image_url || "");
    setCategory(tpl.category || "");
    setTplPickerOpen(false);
  };

  const deleteTemplate = async (tplId: string) => {
    await api.deleteTemplate(tplId);
    setTemplates(templates.filter(t => t.id !== tplId));
  };

  // ---- Send offer email (pre-filled from this event) ----
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerTo, setOfferTo] = useState("");
  const [offerClient, setOfferClient] = useState("");
  const [offerNote, setOfferNote] = useState("");
  const [offerSending, setOfferSending] = useState(false);

  const openOfferModal = () => {
    setOfferTo("");
    // best-guess client name from event name (e.g. "Urodziny Ani" -> "Ani")
    setOfferClient("");
    setOfferNote(notes ? `Dot. imprezy: ${name}\n\n${notes}` : `Dot. imprezy: ${name}`);
    setOfferOpen(true);
  };

  const sendOfferForEvent = async () => {
    if (!offerTo.trim() || !offerTo.includes("@")) {
      Alert.alert("Błąd", "Podaj poprawny adres e-mail klienta.");
      return;
    }
    setOfferSending(true);
    try {
      // package_set_id must be set1/set2/set3 (adult sets)
      const isSetId = packageSet === "set1" || packageSet === "set2" || packageSet === "set3";
      const extrasPayload = activeExtras
        .map(e => {
          const q = extras[e.id] || 0;
          if (q <= 0) return null;
          if (e.unit === "kwota") return { id: e.id, amount: q };
          return { id: e.id, qty: q };
        })
        .filter(Boolean) as any[];
      // Derive event_type from the event's category
      let eventType: "okolicznosciowe" | "firmowe" | "urodziny" | "warsztaty" | undefined;
      if (category.startsWith("dorosli/firmowe")) eventType = "firmowe";
      else if (category.startsWith("dorosli/okolicznosciowe")) eventType = "okolicznosciowe";
      else if (category.startsWith("dorosli")) eventType = "okolicznosciowe";
      else if (category.startsWith("dzieci/urodzinki")) eventType = "urodziny";
      else if (category.startsWith("dzieci/wycieczki")) eventType = "warsztaty";
      await api.sendOfferEmail({
        to_email: offerTo.trim(),
        client_name: offerClient.trim() || undefined,
        event_date: date || undefined,
        people_count: peopleNum || undefined,
        package_set_id: isSetId ? (packageSet as any) : undefined,
        extras: extrasPayload,
        custom_note: offerNote.trim() || undefined,
        event_id: isNew ? undefined : (id as string),
        event_type: eventType,
      });
      setOfferOpen(false);
      Alert.alert("Wysłano ✓", `Oferta poszła na ${offerTo.trim()}.`);
    } catch (e: any) {
      Alert.alert("Nie udało się wysłać", e?.message || "Spróbuj ponownie.");
    } finally {
      setOfferSending(false);
    }
  };

  if (loading) {
    return <View style={[s.root, { justifyContent: "center", alignItems: "center" }]}><ActivityIndicator color={theme.color.brand} /></View>;
  }

  const availStaff = staffAll.filter(s => !shifts.some(sh => sh.staff_id === s.id));

  return (
    <View style={s.root} testID="event-detail-screen">
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable testID="event-back-btn" onPress={() => router.back()} hitSlop={12} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={s.headerTitle}>{isNew ? "Nowa impreza" : "Edytuj imprezę"}</Text>
        <View style={{ flexDirection: "row", gap: 4 }}>
          {(isAdult || category.startsWith("dzieci/urodzinki") || category.startsWith("dzieci/wycieczki") || category === "dzieci/wycieczki_rodzice") ? (
            <Pressable testID="event-send-offer-btn" onPress={openOfferModal} hitSlop={12} style={s.backBtn}>
              <Feather name="mail" size={18} color={theme.color.brand} />
            </Pressable>
          ) : null}
          {!isNew ? (
            <Pressable testID="event-delete-btn" onPress={remove} hitSlop={12} style={s.backBtn}>
              <Feather name="trash-2" size={18} color={theme.color.error} />
            </Pressable>
          ) : <View style={{ width: 36 }} />}
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 160 }} keyboardShouldPersistTaps="handled">
          {/* Image */}
          <Pressable testID="event-image-picker" onPress={showImagePicker} style={s.imageBox}>
            {imageUrl ? (
              <>
                <Image source={imageUrl} style={StyleSheet.absoluteFill} contentFit="cover" />
                <LinearGradient
                  colors={["rgba(12,12,14,0.15)", "rgba(12,12,14,0.85)"]}
                  style={StyleSheet.absoluteFill}
                />
                <View style={s.imageEditRow}>
                  <View style={s.imageBadge}>
                    <Feather name="camera" size={14} color={theme.color.onBrand} />
                    <Text style={s.imageBadgeText}>Zmień zdjęcie</Text>
                  </View>
                  <Pressable testID="event-image-remove" onPress={(e) => { e.stopPropagation?.(); setImageUrl(""); }} hitSlop={10} style={s.imageRemoveBtn}>
                    <Feather name="x" size={16} color={theme.color.onSurface} />
                  </Pressable>
                </View>
              </>
            ) : (
              <View style={s.imagePlaceholder}>
                <Feather name="camera" size={28} color={theme.color.brand} />
                <Text style={s.imagePlaceholderText}>Dodaj zdjęcie imprezy</Text>
                <Text style={s.imagePlaceholderSub}>Galeria lub aparat</Text>
              </View>
            )}
          </Pressable>

          {/* Template chips - shown for new events */}
          {isNew && templates.length > 0 && (
            <Pressable testID="tpl-load-btn" onPress={() => setTplPickerOpen(true)} style={s.tplLoadBtn}>
              <Feather name="copy" size={16} color={theme.color.brand} />
              <Text style={s.tplLoadText}>Wczytaj z szablonu ({templates.length})</Text>
            </Pressable>
          )}

          {/* Info */}
          <Section title="Informacje">
            <Field label="Nazwa">
              <TextInput testID="event-name-input" value={name} onChangeText={setName} placeholder="Wesele Kowalscy" placeholderTextColor={theme.color.onSurfaceSecondary} style={s.input} />
            </Field>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Field label="Data (RRRR-MM-DD)">
                  <TextInput testID="event-date-input" value={date} onChangeText={setDate} placeholder="2026-05-15" placeholderTextColor={theme.color.onSurfaceSecondary} style={s.input} autoCapitalize="none" />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Godzina od">
                  <TextInput testID="event-time-start-input" value={timeStart} onChangeText={setTimeStart} placeholder="18:00" placeholderTextColor={theme.color.onSurfaceSecondary} style={s.input} />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Godzina do">
                  <TextInput testID="event-time-end-input" value={timeEnd} onChangeText={setTimeEnd} placeholder="22:00" placeholderTextColor={theme.color.onSurfaceSecondary} style={s.input} />
                </Field>
              </View>
            </View>
            <Field label="Kategoria">
              <Pressable testID="event-category-btn" onPress={() => setCatPickerOpen(true)} style={[s.input, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}>
                <Text style={{ color: category ? theme.color.onSurface : theme.color.onSurfaceSecondary, fontSize: 15 }}>
                  {category ? categoryLabel(category) : "Wybierz kategorię"}
                </Text>
                <Feather name="chevron-down" size={18} color={theme.color.onSurfaceSecondary} />
              </Pressable>
            </Field>
            <Field label="Notatki">
              <TextInput testID="event-notes-input" value={notes} onChangeText={setNotes} placeholder="Notatki, kontakt do klienta, uwagi..." placeholderTextColor={theme.color.onSurfaceSecondary} style={[s.input, { height: 140, textAlignVertical: "top" }]} multiline />
            </Field>
          </Section>

          {/* Status */}
          <Section title="Status imprezy">
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {([
                { k: "wstepne",     label: "Wstępne zapytanie", color: "#F59E0B" },
                { k: "rezerwacja",  label: "Rezerwacja",        color: "#F97316" },
                { k: "potwierdzona",label: "Potwierdzona",      color: "#10B981" },
                { k: "zakonczona",  label: "Zakończona",        color: "#3B82F6" },
                { k: "anulowana",   label: "Anulowana",         color: "#EF4444" },
              ] as const).map(st => {
                const active = status === st.k;
                return (
                  <Pressable
                    key={st.k}
                    testID={`status-${st.k}`}
                    onPress={() => setStatus(active ? "" : st.k)}
                    style={{
                      flexDirection: "row", alignItems: "center", gap: 6,
                      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
                      backgroundColor: active ? st.color : theme.color.surfaceTertiary,
                      borderWidth: 1, borderColor: active ? st.color : theme.color.border,
                    }}
                  >
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: st.color }} />
                    <Text style={{ color: active ? "#0A0A0A" : theme.color.onSurface, fontSize: 12, fontWeight: "700" }}>{st.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {status === "wstepne" && (
              <Field label="Ważne do (data ważności zapytania)">
                <TextInput
                  testID="event-valid-until"
                  value={validUntil}
                  onChangeText={setValidUntil}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={theme.color.onSurfaceSecondary}
                  style={s.input}
                />
                <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 6, fontStyle: "italic" }}>
                  💡 Wstępne zapytania blokują termin — po tej dacie aplikacja przypomni Ci o kontakcie z klientem.
                </Text>
              </Field>
            )}
          </Section>

          {/* Client */}
          <Section title="Klient">
            <Field label="Imię i nazwisko / nazwa firmy">
              <TextInput testID="client-name" value={clientName} onChangeText={setClientName}
                placeholder="Jan Kowalski / XYZ Sp. z o.o." placeholderTextColor={theme.color.onSurfaceSecondary} style={s.input} />
            </Field>
            <Field label="Telefon">
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <TextInput testID="client-phone" value={clientPhone} onChangeText={setClientPhone}
                  placeholder="+48 123 456 789" placeholderTextColor={theme.color.onSurfaceSecondary}
                  keyboardType="phone-pad" style={[s.input, { flex: 1 }]} />
                <Pressable
                  testID="client-call"
                  disabled={!clientPhone.trim()}
                  onPress={() => Linking.openURL(`tel:${clientPhone.replace(/\s/g, "")}`)}
                  style={{ padding: 12, borderRadius: 10, backgroundColor: clientPhone.trim() ? theme.color.brand : theme.color.surfaceTertiary }}
                >
                  <Feather name="phone" size={18} color={clientPhone.trim() ? theme.color.onBrand : theme.color.onSurfaceSecondary} />
                </Pressable>
                <Pressable
                  testID="client-sms"
                  disabled={!clientPhone.trim()}
                  onPress={() => Linking.openURL(`sms:${clientPhone.replace(/\s/g, "")}`)}
                  style={{ padding: 12, borderRadius: 10, backgroundColor: clientPhone.trim() ? theme.color.brand : theme.color.surfaceTertiary }}
                >
                  <Feather name="message-circle" size={18} color={clientPhone.trim() ? theme.color.onBrand : theme.color.onSurfaceSecondary} />
                </Pressable>
              </View>
            </Field>
            <Field label="E-mail">
              <TextInput testID="client-email" value={clientEmail} onChangeText={setClientEmail}
                placeholder="klient@example.com" placeholderTextColor={theme.color.onSurfaceSecondary}
                keyboardType="email-address" autoCapitalize="none" style={s.input} />
            </Field>
            <Field label="Notatki o kliencie">
              <TextInput testID="client-notes" value={clientNotes} onChangeText={setClientNotes}
                placeholder="Preferencje, historia współpracy..." placeholderTextColor={theme.color.onSurfaceSecondary}
                style={[s.input, { height: 60, textAlignVertical: "top" }]} multiline />
            </Field>
          </Section>

          {/* Payment */}
          <Section title="Płatność">
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 2 }}>
                <Field label="Całkowita cena imprezy">
                  <TextInput testID="price-total" value={priceTotal} onChangeText={setPriceTotal}
                    placeholder="0" placeholderTextColor={theme.color.onSurfaceSecondary}
                    keyboardType="decimal-pad" style={s.input} />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Rabat %">
                  <TextInput testID="discount-pct" value={discountPct} onChangeText={setDiscountPct}
                    placeholder="0" placeholderTextColor={theme.color.onSurfaceSecondary}
                    keyboardType="decimal-pad" style={s.input} />
                </Field>
              </View>
            </View>
            {(() => {
              const total = parseAmt(priceTotal);
              const disc = parseAmt(discountPct);
              if (total > 0 && disc > 0) {
                const discAmt = total * (disc / 100);
                const afterDisc = total - discAmt;
                return (
                  <View style={{ marginTop: 6, padding: 10, borderRadius: 10, backgroundColor: theme.color.brand + "10", borderWidth: 1, borderColor: theme.color.brand + "44" }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ fontSize: 11, color: theme.color.onSurfaceSecondary, letterSpacing: 0.5 }}>
                        RABAT −{disc.toFixed(0)}% ({discAmt.toFixed(2)} zł)
                      </Text>
                      <Text style={{ fontSize: 16, fontWeight: "800", color: theme.color.brand }}>
                        {afterDisc.toFixed(2)} zł
                      </Text>
                    </View>
                  </View>
                );
              }
              return null;
            })()}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              {[{v: true, lbl: "Zaliczka wpłacona"}, {v: false, lbl: "Brak zaliczki"}].map(o => {
                const active = depositPaid === o.v;
                return (
                  <Pressable
                    key={String(o.v)}
                    testID={`deposit-${o.v}`}
                    onPress={() => setDepositPaid(o.v)}
                    style={{
                      flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center",
                      backgroundColor: active ? (o.v ? theme.color.success : theme.color.surfaceTertiary) : theme.color.surfaceTertiary,
                      borderWidth: 1, borderColor: active ? (o.v ? theme.color.success : theme.color.borderStrong) : theme.color.border,
                    }}
                  >
                    <Text style={{ color: active && o.v ? "#022C22" : theme.color.onSurface, fontWeight: "700", fontSize: 13 }}>{o.lbl}</Text>
                  </Pressable>
                );
              })}
            </View>
            {depositPaid && (
              <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                <View style={{ flex: 1 }}>
                  <Field label="Kwota zaliczki">
                    <TextInput testID="deposit-amount" value={depositAmount} onChangeText={setDepositAmount}
                      placeholder="0" placeholderTextColor={theme.color.onSurfaceSecondary}
                      keyboardType="decimal-pad" style={s.input} />
                  </Field>
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="Data wpłaty">
                    <TextInput testID="deposit-date" value={depositDate} onChangeText={setDepositDate}
                      placeholder="YYYY-MM-DD" placeholderTextColor={theme.color.onSurfaceSecondary}
                      style={s.input} />
                  </Field>
                </View>
              </View>
            )}
            {parseAmt(priceTotal) > 0 && (
              <View style={{
                marginTop: 14, padding: 14, borderRadius: 12,
                backgroundColor: theme.color.surfaceTertiary,
                borderWidth: 1, borderColor: theme.color.brand,
              }}>
                <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 11, letterSpacing: 1 }}>POZOSTAŁO DO ZAPŁATY</Text>
                {(() => {
                  const total = parseAmt(priceTotal);
                  const disc = parseAmt(discountPct);
                  const afterDisc = disc > 0 ? total * (1 - disc / 100) : total;
                  const remaining = afterDisc - (depositPaid ? parseAmt(depositAmount) : 0);
                  return (
                    <Text style={{
                      color: remaining > 0 ? theme.color.brand : theme.color.success,
                      fontSize: 24, fontWeight: "800", marginTop: 4,
                    }}>
                      {remaining.toFixed(2)} zł
                    </Text>
                  );
                })()}
              </View>
            )}
          </Section>

          {/* Weather */}
          <Section title="Pogoda w dniu imprezy">
            <Pressable
              testID="weather-fetch"
              onPress={async () => {
                if (!date) return;
                setWeatherLoading(true);
                try {
                  const w = await api.weather(date, timeStart, timeEnd);
                  setWeather(w);
                } catch (e: any) {
                  setWeather({ available: false, message: e?.message || "Błąd pobierania prognozy" });
                } finally { setWeatherLoading(false); }
              }}
              style={{
                flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                paddingVertical: 12, borderRadius: 10,
                backgroundColor: theme.color.surfaceTertiary, borderWidth: 1, borderColor: theme.color.brand,
              }}
            >
              {weatherLoading ? (
                <ActivityIndicator color={theme.color.brand} size="small" />
              ) : (
                <>
                  <Feather name="cloud" size={16} color={theme.color.brand} />
                  <Text style={{ color: theme.color.brand, fontWeight: "700", fontSize: 13 }}>
                    {weather ? "Odśwież prognozę" : "Sprawdź prognozę pogody"}
                  </Text>
                </>
              )}
            </Pressable>
            {weather && !weather.available && (
              <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 10, textAlign: "center", fontStyle: "italic" }}>
                {weather.message || "Prognoza niedostępna"}
              </Text>
            )}
            {weather && weather.available && (
              <View style={{ marginTop: 12, padding: 14, borderRadius: 12, backgroundColor: theme.color.surfaceTertiary, borderWidth: 1, borderColor: theme.color.border }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Feather name={weather.icon || "cloud"} size={40} color={theme.color.brand} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.color.onSurface, fontSize: 18, fontWeight: "800" }}>
                      {weather.temp_min !== null ? `${weather.temp_min}°` : "—"}
                      {" – "}
                      {weather.temp_max !== null ? `${weather.temp_max}°C` : "—"}
                    </Text>
                    <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 2 }}>
                      {weather.description}  ·  {weather.time_window}
                    </Text>
                  </View>
                </View>
                <View style={{ flexDirection: "row", gap: 16, marginTop: 12 }}>
                  <View>
                    <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 10, letterSpacing: 0.5 }}>OPADY</Text>
                    <Text style={{ color: theme.color.onSurface, fontSize: 14, fontWeight: "700" }}>{weather.precipitation_prob}%</Text>
                  </View>
                  <View>
                    <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 10, letterSpacing: 0.5 }}>WIATR</Text>
                    <Text style={{ color: theme.color.onSurface, fontSize: 14, fontWeight: "700" }}>{weather.wind_kmh} km/h</Text>
                  </View>
                  <View>
                    <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 10, letterSpacing: 0.5 }}>LOKALIZACJA</Text>
                    <Text style={{ color: theme.color.onSurface, fontSize: 12, fontWeight: "600" }}>Kielce, Zastawie 4</Text>
                  </View>
                </View>
                {weather.warning && (
                  <View style={{ marginTop: 10, padding: 10, borderRadius: 8, backgroundColor: "rgba(245,158,11,0.15)", borderWidth: 1, borderColor: theme.color.warning }}>
                    <Text style={{ color: theme.color.warning, fontSize: 12, fontWeight: "700" }}>{weather.warning}</Text>
                  </View>
                )}
              </View>
            )}
          </Section>

          {/* Financials */}
          <Section title="Finanse">
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Field label="Liczba osób">
                  <TextInput
                    testID="event-people-input"
                    value={people}
                    onChangeText={(v) => { setPeople(v); setAutoPrice(true); }}
                    placeholder="np. 25"
                    placeholderTextColor={theme.color.onSurfaceSecondary}
                    keyboardType="number-pad"
                    style={s.input}
                  />
                </Field>
              </View>
              <View style={{ flex: 1.2 }}>
                <Field label="Przychód (PLN)">
                  <TextInput
                    testID="event-revenue-input"
                    value={revenue}
                    onChangeText={(v) => { setRevenue(v); setAutoPrice(false); }}
                    placeholder="0"
                    placeholderTextColor={theme.color.onSurfaceSecondary}
                    keyboardType="decimal-pad"
                    style={s.input}
                  />
                </Field>
              </View>
            </View>
            {isAdult && (
              <View style={s.zestawRow} testID="adult-sets">
                {ADULT_SETS.map(zs => {
                  const sel = packageSet === zs.id;
                  return (
                    <Pressable
                      key={zs.id}
                      testID={`zestaw-${zs.id}`}
                      onPress={() => { setPackageSet(sel ? "" : zs.id); setAutoPrice(true); }}
                      style={[s.zestawBtn, sel && s.zestawBtnActive]}
                    >
                      <Text style={[s.zestawName, sel && { color: theme.color.onBrand }]}>{zs.name}</Text>
                      <Text style={[s.zestawPrice, sel && { color: theme.color.onBrand }]}>{zs.price_per_person} zł/os.</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
            {isAdult && packageSet && findAdultSet(packageSet) && (
              <View style={s.zestawDetails}>
                <Text style={s.zestawDetailsTitle}>W {findAdultSet(packageSet)!.name}:</Text>
                {findAdultSet(packageSet)!.items.map((it, i) => (
                  <Text key={i} style={s.zestawItem}>• {it}</Text>
                ))}
                <Text style={[s.zestawDetailsTitle, { marginTop: 6 }]}>Dodatki w cenie:</Text>
                {findAdultSet(packageSet)!.addons.map((it, i) => (
                  <Text key={i} style={s.zestawItem}>• {it}</Text>
                ))}
              </View>
            )}
            {pricing && (
              <View style={s.pricingCard} testID="pricing-breakdown">
                <View style={{ flex: 1 }}>
                  <Text style={s.pricingBreakdown}>{pricing.breakdown}</Text>
                  {extrasTotal > 0 && <Text style={s.pricingBreakdown}>+ Dodatki: {extrasTotal.toFixed(0)} zł</Text>}
                  <Text style={s.pricingHint}>{autoPrice ? "Cena wpisana automatycznie" : "Cena ręczna — dotknij, aby użyć auto"}</Text>
                </View>
                <Pressable
                  testID="pricing-apply-btn"
                  onPress={() => { setRevenue(String(combinedTotal)); setAutoPrice(true); }}
                  style={s.pricingApply}
                >
                  <Text style={s.pricingApplyText}>{formatPLN(combinedTotal)}</Text>
                </Pressable>
              </View>
            )}

            <View style={{ marginTop: 12, marginBottom: 4 }}>
              <Text style={s.label}>{
                activeExtras.length > 0
                  ? (isAdult ? "Dodatki (napoje, ciasto, tace, sałatki)"
                    : isParentTrip ? "Dodatki (catering, konie, animacje)"
                    : isBirthday ? "Dodatki (catering)"
                    : "Dodatki")
                  : "Koszty (materiały, wynajem itp.)"
              }</Text>
            </View>
            {activeExtras.map(ex => {
              const q = extras[ex.id] || 0;
              const line = ex.unit === "kwota" ? q : q * ex.price;
              return (
                <View key={ex.id} style={s.extraRow} testID={`extra-${ex.id}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.extraName}>{ex.name}</Text>
                    <Text style={s.extraHint}>{ex.unit === "kwota" ? "Wpisz kwotę (zł)" : `${ex.price} zł / ${ex.unit}`}{ex.hint ? ` · ${ex.hint}` : ""}</Text>
                  </View>
                  <TextInput
                    testID={`extra-qty-${ex.id}`}
                    value={q ? String(q) : ""}
                    onChangeText={(v) => {
                      const n = parseAmt(v);
                      setExtras(prev => ({ ...prev, [ex.id]: n }));
                      setAutoPrice(true);
                    }}
                    placeholder="0"
                    placeholderTextColor={theme.color.onSurfaceSecondary}
                    keyboardType="decimal-pad"
                    style={s.extraQtyInput}
                  />
                  <Text style={s.extraLine}>{line ? `${line.toFixed(0)} zł` : "—"}</Text>
                </View>
              );
            })}

            {activeExtras.length > 0 && (
              <View style={{ marginTop: 12, marginBottom: 4 }}>
                <Text style={s.label}>Koszty (materiały, wynajem itp.)</Text>
              </View>
            )}

            {/* Oferta obiadowa — quick picker with auto-margin */}
            <View style={{ marginTop: 20, marginBottom: 6, flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Feather name="coffee" size={14} color={theme.color.brand} />
              <Text style={[s.label, { marginTop: 0 }]}>Oferta obiadowa (opcjonalnie)</Text>
            </View>
            <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 11, marginBottom: 8 }}>
              Wpisz ilości porcji z menu obiadowego. Marża liczona automatycznie z ukrytych cen zakupu.
            </Text>
            {DINNER_SECTIONS.map(sec => {
              const items = DINNER_MENU.filter(m => m.section === sec.id);
              return (
                <View key={sec.id} style={{ marginBottom: 8 }}>
                  <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 10, letterSpacing: 1, marginBottom: 4, textTransform: "uppercase" }}>{sec.title}</Text>
                  {items.map(it => {
                    const q = dinnerQty[it.id] || 0;
                    const price = discountedPrice(it.base_price);
                    const line = q * price;
                    return (
                      <View key={it.id} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 6, gap: 8 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, color: theme.color.onSurface }}>{it.name}</Text>
                          <Text style={{ fontSize: 10, color: theme.color.onSurfaceSecondary }}>{price} zł / {it.unit}</Text>
                        </View>
                        <TextInput
                          testID={`dinner-qty-${it.id}`}
                          value={q ? String(q) : ""}
                          onChangeText={(v) => {
                            const n = parseAmt(v);
                            setDinnerQty(prev => ({ ...prev, [it.id]: n }));
                            setAutoPrice(true);
                          }}
                          placeholder="0"
                          placeholderTextColor={theme.color.onSurfaceSecondary}
                          keyboardType="decimal-pad"
                          style={s.extraQtyInput}
                        />
                        <Text style={{ minWidth: 60, textAlign: "right", fontWeight: "700", color: line ? theme.color.brand : theme.color.onSurfaceSecondary, fontSize: 12 }}>{line ? `${line.toFixed(0)} zł` : "—"}</Text>
                      </View>
                    );
                  })}
                </View>
              );
            })}
            {dinnerRevenue > 0 && (
              <View style={{ marginTop: 12, backgroundColor: theme.color.brand + "10", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.color.brand + "44" }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                  <Text style={{ color: theme.color.onSurface, fontSize: 13, fontWeight: "700" }}>Suma obiadu</Text>
                  <Text style={{ color: theme.color.brand, fontSize: 16, fontWeight: "800" }}>{dinnerRevenue.toFixed(0)} zł</Text>
                </View>
                <Text style={[s.label, { marginTop: 8 }]}>Koszt zakupu (opcjonalne nadpisanie — puste = auto)</Text>
                <TextInput
                  testID="dinner-cost-input"
                  value={dinnerCost}
                  onChangeText={setDinnerCost}
                  placeholder={`Auto: ${dinnerAutoCostVal.toFixed(2)} zł`}
                  placeholderTextColor={theme.color.onSurfaceSecondary}
                  keyboardType="decimal-pad"
                  style={s.input}
                />
                <View style={{ flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <View style={{ flex: 1, backgroundColor: theme.color.surface, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.color.divider }}>
                    <Text style={{ fontSize: 10, color: theme.color.onSurfaceSecondary, letterSpacing: 0.5, textTransform: "uppercase" }}>Zysk</Text>
                    <Text style={{ fontSize: 18, fontWeight: "800", color: dinnerProfit >= 0 ? theme.color.brand : theme.color.error }}>
                      {dinnerProfit.toFixed(0)} zł
                    </Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: theme.color.surface, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.color.divider }}>
                    <Text style={{ fontSize: 10, color: theme.color.onSurfaceSecondary, letterSpacing: 0.5, textTransform: "uppercase" }}>Marża</Text>
                    <Text style={{ fontSize: 18, fontWeight: "800", color: dinnerMargin >= 0 ? theme.color.brand : theme.color.error }}>
                      {dinnerMargin.toFixed(1)}%
                    </Text>
                  </View>
                </View>
              </View>
            )}
            {costs.map((c, i) => (
              <View key={i} style={s.costRow}>
                <TextInput
                  testID={`cost-label-${i}`}
                  value={c.label}
                  onChangeText={v => setCosts(costs.map((x, ix) => ix === i ? { ...x, label: v } : x))}
                  placeholder="np. Catering"
                  placeholderTextColor={theme.color.onSurfaceSecondary}
                  style={[s.input, { flex: 2 }]}
                />
                <TextInput
                  testID={`cost-amount-${i}`}
                  value={String(c.amount || "")}
                  onChangeText={v => setCosts(costs.map((x, ix) => ix === i ? { ...x, amount: parseAmt(v) } : x))}
                  placeholder="0"
                  placeholderTextColor={theme.color.onSurfaceSecondary}
                  keyboardType="decimal-pad"
                  style={[s.input, { flex: 1 }]}
                />
                <Pressable testID={`cost-del-${i}`} onPress={() => setCosts(costs.filter((_, ix) => ix !== i))} hitSlop={8} style={s.iconBtn}>
                  <Feather name="x" size={16} color={theme.color.onSurfaceSecondary} />
                </Pressable>
              </View>
            ))}
            <Pressable testID="cost-add-btn" onPress={() => setCosts([...costs, { label: "", amount: 0 }])} style={s.addRow}>
              <Feather name="plus" size={16} color={theme.color.brand} />
              <Text style={s.addRowText}>Dodaj koszt</Text>
            </Pressable>
          </Section>

          {/* Staff */}
          <Section title="Pracownicy na zmianie">
            {shifts.length === 0 && <Text style={s.hint}>Brak przypisanych pracowników</Text>}
            {shifts.map((sh, i) => {
              const s2 = staffMap[sh.staff_id];
              return (
                <View key={sh.staff_id} style={s.shiftBlock}>
                  <View style={s.shiftRow}>
                    <View style={s.avatar}><Text style={s.avatarText}>{initials(s2?.name)}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.shiftName}>{s2?.name || "?"}</Text>
                      <Text style={s.shiftRate}>{formatPLN(s2?.hourly_rate || 0)}/godz.</Text>
                    </View>
                    <Text style={s.shiftHoursBadge}>{(Number(sh.hours) || 0).toFixed(1)} h</Text>
                    <Pressable testID={`shift-del-${i}`} onPress={() => setShifts(shifts.filter((_, ix) => ix !== i))} hitSlop={8} style={s.iconBtn}>
                      <Feather name="x" size={16} color={theme.color.onSurfaceSecondary} />
                    </Pressable>
                  </View>
                  <View style={s.shiftTimeRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.miniLabel}>Od</Text>
                      <TextInput
                        testID={`shift-start-${i}`}
                        value={sh.time_start || ""}
                        onChangeText={(v) => setShifts(shifts.map((x, ix) => {
                          if (ix !== i) return x;
                          const next = { ...x, time_start: v };
                          const h = hoursBetween(v, next.time_end);
                          return { ...next, hours: h || x.hours };
                        }))}
                        placeholder="18:00"
                        placeholderTextColor={theme.color.onSurfaceSecondary}
                        style={s.timeInput}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.miniLabel}>Do</Text>
                      <TextInput
                        testID={`shift-end-${i}`}
                        value={sh.time_end || ""}
                        onChangeText={(v) => setShifts(shifts.map((x, ix) => {
                          if (ix !== i) return x;
                          const next = { ...x, time_end: v };
                          const h = hoursBetween(next.time_start, v);
                          return { ...next, hours: h || x.hours };
                        }))}
                        placeholder="22:00"
                        placeholderTextColor={theme.color.onSurfaceSecondary}
                        style={s.timeInput}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.miniLabel}>Godziny (ręcznie)</Text>
                      <TextInput
                        testID={`shift-hours-${i}`}
                        value={String(sh.hours || "")}
                        onChangeText={(v) => setShifts(shifts.map((x, ix) => ix === i ? { ...x, hours: parseAmt(v) } : x))}
                        placeholder="4"
                        placeholderTextColor={theme.color.onSurfaceSecondary}
                        keyboardType="decimal-pad"
                        style={s.timeInput}
                      />
                    </View>
                  </View>
                </View>
              );
            })}
            {availStaff.length > 0 ? (
              <Pressable testID="shift-add-btn" onPress={() => setPickerOpen(true)} style={s.addRow}>
                <Feather name="plus" size={16} color={theme.color.brand} />
                <Text style={s.addRowText}>Dodaj pracownika</Text>
              </Pressable>
            ) : staffAll.length === 0 ? (
              <Text style={s.hint}>Najpierw dodaj pracowników w zakładce Pracownicy</Text>
            ) : null}
          </Section>

          {/* Summary */}
          <View style={s.summary}>
            <SummaryRow label="Przychód" value={revenueNum} />
            <SummaryRow label="Koszty materiałowe" value={-materialCost} />
            <SummaryRow label="Koszty pracy" value={-laborCost} />
            <View style={s.sep} />
            <SummaryRow label="Zysk" value={profit} bold />
          </View>

          <Pressable testID="save-as-template-btn" onPress={saveAsTemplate} disabled={!name.trim()} style={[s.tplSaveBtn, !name.trim() && { opacity: 0.5 }]}>
            <Feather name="bookmark" size={16} color={theme.color.brand} />
            <Text style={s.tplLoadText}>Zapisz jako szablon</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable testID="event-save-btn" onPress={save} disabled={saving || !name.trim() || !date} style={[s.saveBtn, (saving || !name.trim() || !date) && { opacity: 0.5 }]}>
          {saving ? <ActivityIndicator color={theme.color.onBrand} /> : <Text style={s.saveBtnText}>{isNew ? "Utwórz imprezę" : "Zapisz zmiany"}</Text>}
        </Pressable>
      </View>

      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setPickerOpen(false)} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={s.grip} />
          <Text style={s.sheetTitle}>Wybierz pracownika</Text>
          <ScrollView>
            {availStaff.map(st => (
              <Pressable key={st.id} testID={`picker-staff-${st.id}`} style={s.pickerRow} onPress={() => addStaff(st.id)}>
                <View style={s.avatar}><Text style={s.avatarText}>{initials(st.name)}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.shiftName}>{st.name}</Text>
                  <Text style={s.shiftRate}>{st.role || "—"}  ·  {formatPLN(st.hourly_rate)}/godz.</Text>
                </View>
                <Feather name="plus" size={18} color={theme.color.brand} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={tplPickerOpen} transparent animationType="slide" onRequestClose={() => setTplPickerOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setTplPickerOpen(false)} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={s.grip} />
          <Text style={s.sheetTitle}>Wczytaj z szablonu</Text>
          <ScrollView>
            {templates.map(tpl => (
              <View key={tpl.id} style={s.pickerRow}>
                <Pressable testID={`tpl-apply-${tpl.id}`} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }} onPress={() => applyTemplate(tpl)}>
                  <View style={s.avatar}><Feather name="bookmark" size={16} color={theme.color.onBrandTertiary} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.shiftName}>{tpl.name}</Text>
                    <Text style={s.shiftRate}>{tpl.venue || "—"}  ·  {formatPLN(tpl.revenue || 0)}</Text>
                  </View>
                </Pressable>
                <Pressable testID={`tpl-del-${tpl.id}`} onPress={() => deleteTemplate(tpl.id)} hitSlop={10} style={{ padding: 6 }}>
                  <Feather name="trash-2" size={16} color={theme.color.onSurfaceSecondary} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={catPickerOpen} transparent animationType="slide" onRequestClose={() => setCatPickerOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setCatPickerOpen(false)} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={s.grip} />
          <Text style={s.sheetTitle}>Kategoria imprezy</Text>
          <ScrollView>
            <Pressable testID="cat-clear" style={s.pickerRow} onPress={() => { setCategory(""); setCatPickerOpen(false); }}>
              <View style={s.avatar}><Feather name="x" size={16} color={theme.color.onBrandTertiary} /></View>
              <Text style={[s.shiftName, { flex: 1 }]}>Bez kategorii</Text>
              {!category && <Feather name="check" size={18} color={theme.color.brand} />}
            </Pressable>
            {CATEGORY_GROUPS.map(g => (
              <View key={g.key} style={{ marginTop: 10 }}>
                <Text style={s.groupHeader}>{g.key}</Text>
                {g.items.map(it => {
                  const sel = category === it.id;
                  return (
                    <Pressable
                      key={it.id}
                      testID={`cat-${it.id}`}
                      style={[s.pickerRow, sel && { backgroundColor: "rgba(212,175,55,0.08)" }]}
                      onPress={() => { setCategory(it.id); setCatPickerOpen(false); }}
                    >
                      <View style={s.avatar}><Feather name="tag" size={14} color={theme.color.onBrandTertiary} /></View>
                      <Text style={[s.shiftName, { flex: 1 }]}>{it.label}</Text>
                      {sel && <Feather name="check" size={18} color={theme.color.brand} />}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={offerOpen} transparent animationType="slide" onRequestClose={() => setOfferOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={() => setOfferOpen(false)} />
          <View style={{
            backgroundColor: theme.color.surfaceSecondary, borderTopLeftRadius: 24, borderTopRightRadius: 24,
            paddingHorizontal: 20, paddingTop: 12, paddingBottom: insets.bottom + 20,
            borderWidth: 1, borderColor: theme.color.border, maxHeight: "85%",
          }}>
            <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.color.borderStrong, marginBottom: 12 }} />
            <Text style={{ color: theme.color.onSurface, fontSize: 18, fontWeight: "700", marginBottom: 6 }}>Wyślij ofertę klientowi</Text>
            <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 12, marginBottom: 12 }}>
              Dane imprezy wypełnią PDF automatycznie: {date}
              {peopleNum ? ` · ${peopleNum} os.` : ""}
              {packageSet ? ` · ${findAdultSet(packageSet)?.name || packageSet}` : ""}
            </Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={s.label}>E-mail klienta *</Text>
              <TextInput
                testID="event-offer-email-to"
                value={offerTo}
                onChangeText={setOfferTo}
                placeholder="klient@przyklad.pl"
                placeholderTextColor={theme.color.onSurfaceSecondary}
                style={s.input}
                autoCapitalize="none"
                keyboardType="email-address"
              />
              <Text style={[s.label, { marginTop: 12 }]}>Imię / nazwa klienta</Text>
              <TextInput
                testID="event-offer-email-client"
                value={offerClient}
                onChangeText={setOfferClient}
                placeholder="Jan Kowalski"
                placeholderTextColor={theme.color.onSurfaceSecondary}
                style={s.input}
              />
              <Text style={[s.label, { marginTop: 12 }]}>Uwagi w mailu</Text>
              <TextInput
                testID="event-offer-email-note"
                value={offerNote}
                onChangeText={setOfferNote}
                placeholder="Dodatkowe informacje..."
                placeholderTextColor={theme.color.onSurfaceSecondary}
                style={[s.input, { minHeight: 80, textAlignVertical: "top" }]}
                multiline
              />
              <Pressable
                testID="event-offer-send-btn"
                onPress={sendOfferForEvent}
                disabled={offerSending || !offerTo.trim()}
                style={{
                  marginTop: 18, backgroundColor: theme.color.brand, borderRadius: 12, paddingVertical: 15,
                  flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                  opacity: (offerSending || !offerTo.trim()) ? 0.5 : 1,
                }}
              >
                {offerSending ? (
                  <ActivityIndicator color={theme.color.onBrand} />
                ) : (
                  <>
                    <Feather name="send" size={16} color={theme.color.onBrand} />
                    <Text style={{ color: theme.color.onBrand, fontWeight: "800", fontSize: 15 }}>Wyślij ofertę PDF</Text>
                  </>
                )}
              </Pressable>
              <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 11, textAlign: "center", marginTop: 10, fontStyle: "italic" }}>
                Wysyłamy z: biesiadapodlasem@gmail.com
              </Text>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function Section({ title, children }: any) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}
function Field({ label, children }: any) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={s.label}>{label}</Text>
      {children}
    </View>
  );
}
function SummaryRow({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  const isProfit = bold;
  const color = isProfit ? (value >= 0 ? theme.color.brand : theme.color.error) : (value < 0 ? theme.color.error : theme.color.onSurface);
  return (
    <View style={s.sumRow}>
      <Text style={[s.sumLabel, bold && { color: theme.color.onSurface, fontWeight: "700", fontSize: 16 }]}>{label}</Text>
      <Text style={[s.sumVal, { color }, bold && { fontSize: 20, fontWeight: "800" }]}>{formatPLN(value)}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: theme.color.divider,
  },
  headerTitle: { flex: 1, textAlign: "center", color: theme.color.onSurface, fontSize: 17, fontWeight: "700" },
  backBtn: { width: 36, height: 36, borderRadius: 999, backgroundColor: theme.color.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  section: {
    backgroundColor: theme.color.surfaceSecondary, borderRadius: 16, padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: theme.color.border,
  },
  sectionTitle: { color: theme.color.brand, fontSize: 12, letterSpacing: 2, fontWeight: "700", marginBottom: 12 },
  label: { color: theme.color.onSurfaceSecondary, fontSize: 12, letterSpacing: 0.5, marginBottom: 6 },
  input: {
    backgroundColor: theme.color.surfaceTertiary, borderRadius: 10, color: theme.color.onSurface,
    paddingHorizontal: 12, paddingVertical: 12, fontSize: 15, borderWidth: 1, borderColor: theme.color.border,
  },
  costRow: { flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 8 },
  iconBtn: { width: 36, height: 36, borderRadius: 999, backgroundColor: theme.color.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  addRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderWidth: 1, borderColor: theme.color.brandTertiary, borderRadius: 10, borderStyle: "dashed", marginTop: 4 },
  addRowText: { color: theme.color.brand, fontWeight: "700" },
  hint: { color: theme.color.onSurfaceSecondary, fontSize: 13, textAlign: "center", padding: 12 },
  shiftRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  avatar: { width: 38, height: 38, borderRadius: 999, backgroundColor: theme.color.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarText: { color: theme.color.onBrandTertiary, fontWeight: "700", fontSize: 12 },
  shiftName: { color: theme.color.onSurface, fontWeight: "600", fontSize: 14 },
  shiftRate: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  hoursInput: { width: 70, backgroundColor: theme.color.surfaceTertiary, borderRadius: 10, color: theme.color.onSurface, paddingHorizontal: 10, paddingVertical: 10, fontSize: 14, textAlign: "center", borderWidth: 1, borderColor: theme.color.border },
  shiftBlock: {
    backgroundColor: theme.color.surfaceTertiary, borderRadius: 12, padding: 12, marginBottom: 10,
    borderWidth: 1, borderColor: theme.color.border,
  },
  shiftTimeRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  timeInput: {
    backgroundColor: theme.color.surface, borderRadius: 10, color: theme.color.onSurface,
    paddingHorizontal: 10, paddingVertical: 10, fontSize: 14, borderWidth: 1, borderColor: theme.color.border,
    textAlign: "center",
  },
  miniLabel: { color: theme.color.onSurfaceSecondary, fontSize: 10, letterSpacing: 0.5, marginBottom: 4 },
  shiftHoursBadge: {
    color: theme.color.brand, fontWeight: "800", fontSize: 14,
    borderWidth: 1, borderColor: theme.color.brand, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  pricingCard: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "rgba(212,175,55,0.08)",
    borderWidth: 1, borderColor: theme.color.brandTertiary,
    borderRadius: 12, padding: 12, marginTop: 4,
  },
  pricingBreakdown: { color: theme.color.onSurface, fontSize: 12, fontWeight: "600" },
  pricingHint: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  pricingApply: {
    backgroundColor: theme.color.brand, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
  },
  pricingApplyText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 13 },
  zestawRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  zestawBtn: {
    flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 12,
    borderWidth: 1, borderColor: theme.color.brandTertiary, backgroundColor: theme.color.surfaceTertiary,
  },
  zestawBtnActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  zestawName: { color: theme.color.onSurface, fontSize: 12, fontWeight: "800" },
  zestawPrice: { color: theme.color.brand, fontSize: 13, fontWeight: "800", marginTop: 2 },
  zestawDetails: {
    marginTop: 10, padding: 12, borderRadius: 12,
    backgroundColor: "rgba(212,175,55,0.06)", borderWidth: 1, borderColor: theme.color.brandTertiary,
  },
  zestawDetailsTitle: { color: theme.color.brand, fontSize: 11, letterSpacing: 1, fontWeight: "800", marginBottom: 4 },
  zestawItem: { color: theme.color.onSurface, fontSize: 12, marginBottom: 2 },
  extraRow: {
    flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: theme.color.divider,
  },
  extraName: { color: theme.color.onSurface, fontSize: 13, fontWeight: "700" },
  extraHint: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  extraQtyInput: {
    width: 60, backgroundColor: theme.color.surfaceTertiary, borderRadius: 8,
    color: theme.color.onSurface, paddingHorizontal: 8, paddingVertical: 8, fontSize: 13,
    textAlign: "center", borderWidth: 1, borderColor: theme.color.border,
  },
  extraLine: { color: theme.color.brand, fontSize: 13, fontWeight: "700", width: 62, textAlign: "right" },
  summary: { backgroundColor: theme.color.surfaceSecondary, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: theme.color.brandTertiary },
  sumRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  sumLabel: { color: theme.color.onSurfaceSecondary, fontSize: 13 },
  sumVal: { fontSize: 14, fontWeight: "600" },
  sep: { height: 1, backgroundColor: theme.color.divider, marginVertical: 8 },
  footer: {
    position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(12,12,14,0.92)",
    padding: 16, borderTopWidth: 1, borderTopColor: theme.color.divider,
  },
  saveBtn: { backgroundColor: theme.color.brand, borderRadius: 12, paddingVertical: 15, alignItems: "center" },
  saveBtnText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 15, letterSpacing: 0.5 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { backgroundColor: theme.color.surfaceSecondary, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 12, maxHeight: "70%", borderWidth: 1, borderColor: theme.color.border },
  grip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.color.borderStrong, marginBottom: 12 },
  sheetTitle: { color: theme.color.onSurface, fontSize: 18, fontWeight: "700", marginBottom: 12 },
  pickerRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  imageBox: {
    height: 160, borderRadius: 16, backgroundColor: theme.color.surfaceSecondary,
    overflow: "hidden", marginBottom: 14, borderWidth: 1, borderColor: theme.color.border,
  },
  imagePlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  imagePlaceholderText: { color: theme.color.onSurface, fontWeight: "700", marginTop: 4 },
  imagePlaceholderSub: { color: theme.color.onSurfaceSecondary, fontSize: 12 },
  imageEditRow: { position: "absolute", left: 12, right: 12, bottom: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  imageBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: theme.color.brand, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  imageBadgeText: { color: theme.color.onBrand, fontWeight: "700", fontSize: 12 },
  imageRemoveBtn: { width: 32, height: 32, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  tplLoadBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 12, marginBottom: 14, borderRadius: 12, borderWidth: 1,
    borderColor: theme.color.brandTertiary, backgroundColor: "rgba(212,175,55,0.06)",
  },
  tplLoadText: { color: theme.color.brand, fontWeight: "700", fontSize: 14 },
  tplSaveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 12, marginTop: 14, borderRadius: 12, borderWidth: 1,
    borderColor: theme.color.brandTertiary,
  },
  groupHeader: {
    color: theme.color.brand, fontSize: 11, letterSpacing: 2, fontWeight: "800",
    marginTop: 4, marginBottom: 4, paddingHorizontal: 4,
  },
});

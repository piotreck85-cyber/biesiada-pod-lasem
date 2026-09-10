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
import { formatPLN, initials } from "@/src/theme";
import { v2 } from "@/src/designTokensV2";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { calculateEventFinance } from "@/src/eventFinance";
import TimeTreeEventInfo from "@/src/components/TimeTreeEventInfo";
import EventAuditList from "@/src/components/EventAuditList";
import { CATEGORY_GROUPS, categoryLabel } from "@/src/categories";
import { computePricing } from "@/src/pricing";
import { ADULT_SETS, ADULT_EXTRAS, findAdultSet, extrasFor } from "@/src/offers";
import { DINNER_MENU, DINNER_SECTIONS, discountedPrice, DINNER_DISCOUNT, dinnerAutoCost } from "@/src/dinnerMenu";
import { CATERING_PRESET_TEMPLATES, buildPresetQty } from "@/src/cateringPresets";
import EventPayments from "@/src/components/EventPayments";
import ManualDiscountModal from "@/src/components/ManualDiscountModal";

type Cost = { label: string; amount: number };
type Shift = { staff_id: string; hours: number; time_start?: string; time_end?: string; role?: string; note?: string };

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
  const [timeTreeEvent, setTimeTreeEvent] = useState<any>(null);
  const [perPersonMode, setPerPersonMode] = useState(isNew);
  const [pricePerPerson, setPricePerPerson] = useState("");
  const [payingPeople, setPayingPeople] = useState("");
  const [freeCarers, setFreeCarers] = useState("");
  const [costInput, setCostInput] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [venue, setVenue] = useState("Biesiada pod lasem");
  const [name, setName] = useState(initName || "");
  const [date, setDate] = useState(initDate || todayIso());
  const [timeStart, setTimeStart] = useState("");
  const [timeEnd, setTimeEnd] = useState("");
  const [notes, setNotes] = useState(initNotes || "");
  const [revenue, setRevenue] = useState(initRevenue || "");
  const [people, setPeople] = useState("");
  const [packageSet, setPackageSet] = useState<string>("");
  const [revenueNet, setRevenueNet] = useState("");
  const [autoPrice, setAutoPrice] = useState(false);
  const [extras, setExtras] = useState<Record<string, number>>({}); // extra_id -> qty (or amount for 'kwota')
  const [dinnerQty, setDinnerQty] = useState<Record<string, number>>({}); // dinner_item_id -> qty
  const [dinnerCost, setDinnerCost] = useState<string>(""); // user-entered wholesale cost for margin calc
  const [dinnerExpanded, setDinnerExpanded] = useState<boolean>(false); // collapsed by default; auto-expand if items selected
  const [financeMeta, setFinanceMeta] = useState<any>(null); // { is_revenue_estimated, is_cost_estimated, status, notes, import_batch_id, ... }
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
  const [prevStatus, setPrevStatus] = useState<string>(""); // status loaded from DB — for change detection
  const [thanksStatus, setThanksStatus] = useState<any | null>(null); // { sent, log, code, ... }
  const [preEventEmail, setPreEventEmail] = useState<any | null>(null);
  const [preEventEmailBusy, setPreEventEmailBusy] = useState(false);
  const [clientDiscounts, setClientDiscounts] = useState<any[]>([]); // active discounts for this client (new event flow)
  const [appliedDiscount, setAppliedDiscount] = useState<any | null>(null); // if event has applied_discount saved
  const [manualCodeOpen, setManualCodeOpen] = useState(false);
  const [validUntil, setValidUntil] = useState<string>("");
  const [clientName, setClientName] = useState<string>("");
  const [clientPhone, setClientPhone] = useState<string>("");
  const [clientEmail, setClientEmail] = useState<string>("");
  const [clientNotes, setClientNotes] = useState<string>("");
  const [priceTotal, setPriceTotal] = useState<string>("");
  const [vatRate, setVatRate] = useState(23);
  const [discountPct, setDiscountPct] = useState<string>("");
  const [depositPaid, setDepositPaid] = useState<boolean>(false);
  const [depositAmount, setDepositAmount] = useState<string>("");
  const [depositDate, setDepositDate] = useState<string>("");
  const [weather, setWeather] = useState<any | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  // ---- Organizacja dla obsługi (staff-visible) ----
  const [org, setOrg] = useState<Record<string, any>>({});
  const setOrgField = (k: string, v: any) => setOrg(o => ({ ...o, [k]: v }));
  const [clientUpdateText, setClientUpdateText] = useState("");
  const [clientUpdateAt, setClientUpdateAt] = useState<string | null>(null);
  const [clientUpdateSaving, setClientUpdateSaving] = useState(false);
  const [serviceInfos, setServiceInfos] = useState<any[]>([]);
  const [newInfoText, setNewInfoText] = useState("");
  const [newInfoImportant, setNewInfoImportant] = useState(false);
  const [teamComments, setTeamComments] = useState<any[]>([]);
  const [replySuggestions, setReplySuggestions] = useState<any[]>([]);
  const [sugEdit, setSugEdit] = useState<Record<string, string>>({});
  const [sugBusy, setSugBusy] = useState(false);

  // ---- Uprawnienia (pracownik z modułami vs admin) ----
  const { user: authUser } = useAuth();
  const isEmp = authUser?.role === "staff";
  const eperm = (k: string) => !isEmp || !!(authUser?.permissions as any)?.[k];
  const canSaveEvent = isNew ? eperm("event_create") : ["event_create", "event_edit", "event_org_edit", "event_status", "offer_prices", "finances"].some(eperm);

  // ---- Dostępność pracowników dla daty imprezy (staff_id -> deklaracja) ----
  const [availByStaff, setAvailByStaff] = useState<Record<string, any>>({});
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) { setAvailByStaff({}); return; }
    let cancelled = false;
    api.availabilityForDate(date)
      .then((r: any) => { if (!cancelled) setAvailByStaff(r && typeof r === "object" && !Array.isArray(r) ? r : {}); })
      .catch(() => { if (!cancelled) setAvailByStaff({}); });
    return () => { cancelled = true; };
  }, [date]);

  const fmtStamp = (iso?: string | null) => {
    try { return iso ? new Date(iso).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""; }
    catch { return ""; }
  };

  const saveClientUpdate = async () => {
    setClientUpdateSaving(true);
    try {
      const r: any = await api.setClientUpdate(id as string, clientUpdateText.trim());
      setClientUpdateAt(r?.client_update_at || null);
      Alert.alert("Zapisano ✓", "Informacje od klienta są widoczne dla obsługi.");
    } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
    finally { setClientUpdateSaving(false); }
  };

  const addServiceInfo = async () => {
    const text = newInfoText.trim();
    if (!text) { Alert.alert("Błąd", "Wpisz treść informacji"); return; }
    try {
      const info: any = await api.addServiceInfo(id as string, { text, important: newInfoImportant });
      setServiceInfos(prev => [...prev, info]);
      setNewInfoText(""); setNewInfoImportant(false);
    } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
  };

  const removeServiceInfo = async (infoId: string) => {
    try {
      await api.deleteServiceInfo(id as string, infoId);
      setServiceInfos(prev => prev.filter(i => i.id !== infoId));
    } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
  };

  const approveSuggestion = async (sug: any) => {
    setSugBusy(true);
    try {
      const edited = (sugEdit[sug.id] || "").trim();
      const r: any = await api.approveClientReply(sug.id, edited || undefined);
      setReplySuggestions(prev => prev.filter(x => x.id !== sug.id));
      setClientUpdateText(r?.client_update_text || "");
      setClientUpdateAt(r?.applied?.client_update_at || new Date().toISOString());
      if (r?.applied?.org) setOrg(r.applied.org);
      if (r?.applied?.people) setPeople(String(r.applied.people));
      Alert.alert("Zapisano ✓", "Informacje od klienta zostały zapisane i są widoczne dla obsługi.");
    } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
    finally { setSugBusy(false); }
  };

  const rejectSuggestion = async (sug: any) => {
    setSugBusy(true);
    try {
      await api.rejectClientReply(sug.id);
      setReplySuggestions(prev => prev.filter(x => x.id !== sug.id));
    } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
    finally { setSugBusy(false); }
  };

  useEffect(() => {
    (async () => {
      try { setStaffAll(await api.listStaff()); } catch {}
      try { setTemplates(await api.listTemplates()); } catch {}
      if (!isNew) {
        try {
          const ev: any = await api.getEvent(id as string);
          setTimeTreeEvent(ev); setVenue(ev.venue || "");
          setPerPersonMode(ev.pricing_mode === "per_person_v1");
          const paid = ev.paying_people ?? Math.max(0, (ev.people || 0) - (ev.free_carers || 0));
          setPayingPeople(String(paid || ""));
          setFreeCarers(String(ev.free_carers || ""));
          setPricePerPerson(ev.price_per_person != null ? String(ev.price_per_person) : paid ? ((ev.price_total || ev.revenue || 0) / paid).toFixed(2) : "");
          setCostInput(ev.costs?.length === 1 ? String(ev.costs[0].amount) : "");
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
          setPrevStatus(ev.status || "");
          setAppliedDiscount(ev.applied_discount || null);
          setValidUntil(ev.valid_until || "");
          setClientName(ev.client_name || "");
          setClientPhone(ev.client_phone || "");
          setClientEmail(ev.client_email || "");
          setClientNotes(ev.client_notes || "");
          setPriceTotal(ev.price_total ? String(ev.price_total) : "");
          setVatRate(ev.vat_rate === 23 ? 23 : 0);
          setDiscountPct(ev.discount_pct ? String(ev.discount_pct) : "");
          setDepositPaid(!!ev.deposit_paid);
          setDepositAmount(ev.deposit_amount ? String(ev.deposit_amount) : "");
          setDepositDate(ev.deposit_date || "");
          // ---- Dinner offer ----
          if (ev.dinner_items && typeof ev.dinner_items === "object") {
            const items = ev.dinner_items as Record<string, number>;
            setDinnerQty(items);
            // Auto-expand catering section if event already has items selected
            if (Object.values(items).some(q => (q || 0) > 0)) setDinnerExpanded(true);
          }
          setDinnerCost(ev.dinner_cost ? String(ev.dinner_cost) : "");
          // ---- Finance metadata (from import) ----
          setFinanceMeta(ev.finance || null);
          // ---- Organizacja / info dla obsługi ----
          setOrg(ev.org && typeof ev.org === "object" ? ev.org : {});
          setClientUpdateText(ev.client_update_text || "");
          setClientUpdateAt(ev.client_update_at || null);
          setServiceInfos(Array.isArray(ev.service_infos) ? ev.service_infos : []);
          try { const cm: any = await api.eventComments(id as string); setTeamComments(Array.isArray(cm) ? cm : []); } catch {}
          try { const sg: any = await api.clientReplySuggestions(id as string); setReplySuggestions(Array.isArray(sg) ? sg : []); } catch {}
          // ---- Thank-you status (only for existing events) ----
          try {
            const ts: any = await api.eventThanksStatus(id as string);
            setThanksStatus(ts);
          } catch {}
          try {
            const ps: any = await api.preEventEmailStatus(id as string);
            setPreEventEmail(ps);
          } catch {}
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

  const peopleNum = perPersonMode
    ? (parseInt(payingPeople, 10) || 0) + (parseInt(freeCarers, 10) || 0)
    : org.kids_count != null || org.adults_count != null
      ? (Number(org.kids_count) || 0) + (Number(org.adults_count) || 0)
      : parseInt(people, 10) || 0;
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
  const parseAmt = (v: string | number | null | undefined) => parseFloat(String(v || "").replace(",", ".")) || 0;

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

  // ---- Auto forecast of event costs (Przewidywane rozliczenie) ----
  // Catering cost = dinnerAutoCostVal (sum of cost_price × qty)
  // Grill cost = per-person cost (25/30/35) × people, from GRILL_SET_COSTS
  // Beverages cost = 8 zł × people (if "napoje" extra selected with qty > 0)
  // Other planned costs = sum of costs[].amount from the event form
  const grillCostPerPerson = (packageSet === "set1" ? 25 : packageSet === "set2" ? 30 : packageSet === "set3" ? 35 : 0);
  const grillCost = grillCostPerPerson * (peopleNum || 0);
  const beveragesQty = extras["napoje"] || 0;
  const beveragesCost = beveragesQty > 0 ? 8 * (peopleNum || 0) : 0;
  const otherPlannedCosts = costs.reduce((s, c) => s + (parseAmt(c.amount) || 0), 0);
  const cateringCost = dinnerCostNum;
  const totalPlannedCost = grillCost + beveragesCost + cateringCost + otherPlannedCosts;
  const eventValue = parseAmt(priceTotal) || combinedTotal || 0;
  const discountedValue = parseAmt(discountPct) > 0
    ? eventValue * (1 - parseAmt(discountPct) / 100)
    : eventValue;
  const plannedProfit = discountedValue - totalPlannedCost;

  // Auto-price when computable and user hasn't manually overridden
  useEffect(() => {
    if (!perPersonMode && autoPrice && (pricing || extrasTotal > 0)) {
      setRevenue(String(combinedTotal));
      // Also propose it as the "Całkowita cena imprezy" if empty
      setPriceTotal(prev => (!prev || prev === "0" || prev === String(revenueNum)) ? String(combinedTotal) : prev);
    }
  }, [combinedTotal, autoPrice, perPersonMode]);

  // ---- Check discounts for known client email (only on NEW event) ----
  useEffect(() => {
    if (!isNew) return;
    const email = clientEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) { setClientDiscounts([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r: any = await api.discountsForClient(email);
        if (!cancelled) setClientDiscounts(Array.isArray(r?.active) ? r.active : []);
      } catch { if (!cancelled) setClientDiscounts([]); }
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [clientEmail, isNew]);

  const financial = useMemo(() => {
    try {
      if (costs.length <= 1) calculateEventFinance(0, 0, 0, costInput, 0);
      const values = calculateEventFinance(pricePerPerson, payingPeople, discountPct,
        Math.round((materialCost + laborCost) * 100) / 100, freeCarers);
      return { values, error: "" };
    } catch (e: any) { return { values: null, error: e.message || "Sprawdź dane finansowe." }; }
  }, [pricePerPerson, payingPeople, discountPct, materialCost, laborCost, freeCarers, costInput, costs.length]);
  const legacyGross = parseAmt(priceTotal);
  const financeValues = perPersonMode ? financial.values : {
    subtotal: parseAmt(priceTotal), discount: 0, gross: legacyGross,
    net: timeTreeEvent?.revenue_net || (vatRate === 23 ? Math.round(legacyGross / 1.23 * 100) / 100 : legacyGross),
    vat: vatRate === 23 ? Math.round((legacyGross - legacyGross / 1.23) * 100) / 100 : 0,
    costs: materialCost + laborCost,
    profit: revenueNum - materialCost - laborCost,
  };
  const setUnitPrice = (value: string) => { setPricePerPerson(value); setPerPersonMode(true); setAutoPrice(false); };
  const setPaidCount = (value: string) => { setPayingPeople(value); if (isNew || timeTreeEvent?.pricing_mode === "per_person_v1") setPerPersonMode(true); };

  const save = async () => {
    if (!canSaveEvent) { Alert.alert("Brak uprawnień", "Nie masz uprawnienia do zapisu tej imprezy."); return; }
    if (!name.trim() || !date) return;
    if (perPersonMode && financial.error) { Alert.alert("Sprawdź finanse", financial.error); return; }
    // Detect transition to "zakonczona" for EXISTING events → show thanks confirm
    const isTransitionToCompleted = !isNew && status === "zakonczona" && prevStatus !== "zakonczona";
    if (isTransitionToCompleted && eperm("send_thanks")) {
      const hasEmail = !!clientEmail.trim() && clientEmail.includes("@");
      const alreadySent = !!(thanksStatus?.sent);
      if (alreadySent) {
        // No confirm — just proceed as normal update
      } else {
        const msg = hasEmail
          ? `Klient: ${clientName || "(brak imienia)"}\nE-mail: ${clientEmail}\n\nCzy wysłać podziękowanie z rabatem 10% na kolejną imprezę?`
          : `Klient nie ma podanego e-maila.\n\nOznacz imprezę jako zakończoną (bez wysyłki podziękowania)?`;
        const options: any[] = [{ text: "Anuluj", style: "cancel" }];
        if (hasEmail) {
          options.push({
            text: "Zakończ bez wysyłki",
            onPress: () => doSaveWithComplete(false),
          });
          options.push({
            text: "Zakończ i wyślij",
            onPress: () => doSaveWithComplete(true),
          });
        } else {
          options.push({
            text: "Zakończ",
            onPress: () => doSaveWithComplete(false),
          });
        }
        Alert.alert("Zakończyć imprezę?", msg, options);
        return;
      }
    }
    await doNormalSave();
  };

  const doSaveWithComplete = async (sendThanks: boolean) => {
    setSaving(true);
    try {
      // First save all other fields (except we let /complete set status)
      await doNormalSave({ skipReturn: true, statusOverride: prevStatus });
      // Then call complete endpoint (also sends email)
      const r: any = await api.eventComplete(id as string, sendThanks);
      if (sendThanks) {
        if (r?.sent) {
          Alert.alert("Wysłano", `Podziękowanie wysłane na ${r.log?.recipient}.\nKod: ${r.code?.code}`);
        } else if (r?.reason === "no_email") {
          Alert.alert("Nie wysłano", "Brak adresu e-mail klienta. Impreza oznaczona jako zakończona.");
        } else if (r?.reason === "already_sent") {
          Alert.alert("Już wysłane", `Ta impreza ma już wygenerowane podziękowanie. Kod: ${r.code?.code}`);
        } else if (r?.reason === "send_failed") {
          Alert.alert("Błąd wysyłki", r?.error || "Nie udało się wysłać maila. Spróbuj ponownie (przycisk Wyślij ponownie).");
        }
      }
      router.back();
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "Nie udało się zakończyć imprezy");
    } finally { setSaving(false); }
  };

  const doNormalSave = async (opts: { skipReturn?: boolean; statusOverride?: string } = {}) => {
    if (!opts.skipReturn) setSaving(true);
    const body = {
      name: name.trim(), date,
      time_start: timeStart, time_end: timeEnd, time: timeStart,
      venue,
      ...(!isNew && timeTreeEvent && { timetree_expected_revision: timeTreeEvent.timetree_revision || 0 }),
      notes, category,
      org,
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
      status: opts.statusOverride !== undefined ? opts.statusOverride : (status || ""),
      valid_until: validUntil || "",
      // ---- Client ----
      client_name: clientName.trim(),
      client_phone: clientPhone.trim(),
      client_email: clientEmail.trim(),
      client_notes: clientNotes.trim(),
      // ---- Payment ----
      price_total: parseAmt(priceTotal),
      vat_rate: vatRate,
      discount_pct: parseAmt(discountPct),
      price_after_discount: (function(){
        const t = parseAmt(priceTotal); const d = parseAmt(discountPct);
        return d > 0 ? Number((t * (1 - d / 100)).toFixed(2)) : t;
      })(),
      deposit_paid: !!depositPaid,
      deposit_amount: parseAmt(depositAmount),
      deposit_date: depositDate || "",
      costs: costs.map(c => ({ ...c, amount: Number(c.amount) || 0 })),
      shifts: shifts.map(sh => ({
        staff_id: sh.staff_id,
        hours: Number(sh.hours) || 0,
        time_start: sh.time_start || "",
        time_end: sh.time_end || "",
        role: sh.role || "",
        note: sh.note || "",
      })),
      image_url: imageUrl,
    };
    const pricedBody = perPersonMode && financial.values ? {
      ...body, pricing_mode: "per_person_v1", price_per_person: parseAmt(pricePerPerson),
      paying_people: financial.values.paidPeople, free_carers: financial.values.freeCarers,
      people: financial.values.attendees, vat_rate: 23,
      pricing_subtotal: financial.values.subtotal, pricing_discount_amount: financial.values.discount,
      price_total: financial.values.gross, price_after_discount: financial.values.gross,
      revenue: financial.values.gross, revenue_net: financial.values.net, vat_amount: financial.values.vat,
    } : { ...body, free_carers: parseInt(freeCarers, 10) || 0,
      price_after_discount: timeTreeEvent?.price_after_discount ?? body.price_after_discount };
    try {
      if (isNew) await api.createEvent(pricedBody);
      else { const saved: any = await api.updateEvent(id as string, pricedBody); setTimeTreeEvent(saved); }
      if (!opts.skipReturn) router.back();
    } catch (e: any) {
      if (opts.skipReturn) throw e;
      Alert.alert("Błąd zapisu", e?.message || "Nie udało się zapisać imprezy.");
    } finally { if (!opts.skipReturn) setSaving(false); }
  };

  const refreshPreEventEmail = async () => {
    if (isNew) return;
    const result: any = await api.preEventEmailStatus(id as string);
    setPreEventEmail(result);
  };

  const openBlobPdf = async (blob: Blob, filename: string) => {
    if (Platform.OS === "web") {
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return;
    }
    const b64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const FS = await import("expo-file-system/legacy");
    const Sharing = await import("expo-sharing");
    const path = FS.cacheDirectory + filename;
    await FS.writeAsStringAsync(path, b64, { encoding: FS.EncodingType.Base64 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(path, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
    }
  };

  // ---- Etap 3: dokumenty PDF ----
  const [pdfBusy, setPdfBusy] = useState<null | "conf" | "staff">(null);
  const downloadEventPdf = async (kind: "conf" | "staff") => {
    setPdfBusy(kind);
    try {
      const blob = kind === "conf"
        ? await api.eventConfirmationPdf(id as string)
        : await api.eventStaffCardPdf(id as string);
      await openBlobPdf(blob, kind === "conf" ? "Potwierdzenie-Biesiada-pod-Lasem.pdf" : "Karta-obslugi.pdf");
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "Nie udało się wygenerować PDF.");
    } finally { setPdfBusy(null); }
  };

  // ---- Etap 2: AI szkice odpowiedzi do klienta ----
  const [sugReply, setSugReply] = useState<Record<string, { draft: string; subject: string; to: string; busy: boolean; sent?: string }>>({});
  const generateReplyDraft = async (sug: any) => {
    setSugReply(p => ({ ...p, [sug.id]: { draft: "", subject: "", to: "", busy: true } }));
    try {
      const r: any = await api.draftClientReply(sug.id);
      setSugReply(p => ({ ...p, [sug.id]: { draft: r.draft || "", subject: r.subject || "", to: r.to_email || "", busy: false } }));
    } catch (e: any) {
      setSugReply(p => { const n = { ...p }; delete n[sug.id]; return n; });
      Alert.alert("Błąd", e?.message || "Nie udało się wygenerować szkicu.");
    }
  };
  const sendReply = async (sug: any) => {
    const r = sugReply[sug.id];
    if (!r?.draft.trim()) { Alert.alert("Błąd", "Treść odpowiedzi jest pusta"); return; }
    setSugReply(p => ({ ...p, [sug.id]: { ...p[sug.id], busy: true } }));
    try {
      const res: any = await api.sendClientReply(sug.id, { text: r.draft.trim(), subject: r.subject.trim(), to_email: r.to });
      setSugReply(p => ({ ...p, [sug.id]: { ...p[sug.id], busy: false, sent: res.to } }));
      Alert.alert("Wysłano ✓", `Odpowiedź wysłana na ${res.to}`);
    } catch (e: any) {
      setSugReply(p => ({ ...p, [sug.id]: { ...p[sug.id], busy: false } }));
      Alert.alert("Błąd wysyłki", e?.message || "");
    }
  };

  const previewPreEventRegulation = async () => {
    setPreEventEmailBusy(true);
    try {
      const blob = await api.preEventEmailRegulation(id as string);
      const suffix = preEventEmail?.regulation_type === "children" ? "DZIECI" : "DOROSLI";
      await openBlobPdf(blob, `Regulamin_Biesiada_pod_Lasem_${suffix}.pdf`);
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "Nie udało się otworzyć regulaminu.");
    } finally { setPreEventEmailBusy(false); }
  };

  const sendPreEventEmail = (resend = false) => {
    Alert.alert(
      resend ? "Wysłać ponownie?" : "Wysłać teraz?",
      resend
        ? `To świadomie wyśle wiadomość ponownie na ${preEventEmail?.address || "adres klienta"}.`
        : `Wiadomość z jednym regulaminem zostanie wysłana na ${preEventEmail?.address || "adres klienta"}.`,
      [
        { text: "Anuluj", style: "cancel" },
        {
          text: resend ? "Wyślij ponownie" : "Wyślij teraz",
          onPress: async () => {
            setPreEventEmailBusy(true);
            try {
              if (resend) await api.preEventEmailResend(id as string);
              else await api.preEventEmailSendNow(id as string);
              await refreshPreEventEmail();
              Alert.alert("Wysłano", "Wiadomość przed imprezą została wysłana.");
            } catch (e: any) {
              await refreshPreEventEmail().catch(() => undefined);
              Alert.alert("Błąd wysyłki", e?.message || "Nie udało się wysłać wiadomości.");
            } finally { setPreEventEmailBusy(false); }
          },
        },
      ],
    );
  };

  const remove = async () => {
    if (isNew || !eperm("event_delete")) return;
    const doDelete = async () => {
      try { await api.deleteEvent(id as string); router.back(); }
      catch (e: any) { Alert.alert("Błąd", e?.message || "Nie udało się usunąć imprezy."); }
    };
    const message = `Usunąć imprezę „${name}” (${date})? Tej operacji nie można cofnąć.`;
    // This is the acting user's confirmation, never a request to the owner.
    if (Platform.OS === "web") { if (window.confirm(message)) await doDelete(); return; }
    Alert.alert("Usunąć imprezę?", message, [
      { text: "Anuluj", style: "cancel" },
      { text: "Usuń", style: "destructive", onPress: doDelete },
    ]);
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
  const [offerGreeting, setOfferGreeting] = useState("");
  const [offerSending, setOfferSending] = useState(false);
  const [offerPreviewing, setOfferPreviewing] = useState(false);

  // ---- Send SUMMARY email (AI-generated confirmation of details) ----
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryTo, setSummaryTo] = useState("");
  const [summaryClient, setSummaryClient] = useState("");
  const [summaryText, setSummaryText] = useState("");
  const [summarySubject, setSummarySubject] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summarySending, setSummarySending] = useState(false);

  const openSummaryModal = async () => {
    if (isNew) {
      Alert.alert("Zapisz najpierw", "Zapisz imprezę, aby móc wysłać podsumowanie.");
      return;
    }
    setSummaryOpen(true);
    setSummaryLoading(true);
    setSummaryText("");
    setSummarySubject("Podsumowanie szczegółów imprezy — Biesiada pod Lasem");
    try {
      const r: any = await api.aiGenerateSummary(id as string);
      setSummaryText(String(r?.summary || ""));
      const ev = r?.event || {};
      setSummaryTo(ev.client_email || "");
      setSummaryClient(ev.client_name || "");
    } catch (e: any) {
      Alert.alert("Błąd AI", e?.message || "Nie udało się wygenerować podsumowania");
    } finally { setSummaryLoading(false); }
  };

  const sendSummaryEmail = async () => {
    if (!summaryTo.trim() || !summaryTo.includes("@")) {
      Alert.alert("Zły adres", "Podaj poprawny adres e-mail klienta.");
      return;
    }
    if (summaryText.trim().length < 20) {
      Alert.alert("Brak treści", "Poczekaj aż AI wygeneruje treść lub napisz ją sam.");
      return;
    }
    setSummarySending(true);
    try {
      await api.aiSendOfferEmail({
        to_email: summaryTo.trim(),
        client_name: summaryClient.trim(),
        subject: summarySubject.trim(),
        body_text: summaryText.trim(),
        event_kind: "okolicznosciowa",
        mode: "summary",
        event_id: id as string,
        attach_offer_pdf: false,
      });
      setSummaryOpen(false);
      Alert.alert("Wysłano ✓", `Podsumowanie poszło na ${summaryTo.trim()}.`);
    } catch (e: any) {
      Alert.alert("Nie udało się wysłać", e?.message || "Spróbuj ponownie.");
    } finally { setSummarySending(false); }
  };

  const openOfferModal = () => {
    setOfferTo("");
    setOfferClient("");
    setOfferNote(notes ? `Dot. imprezy: ${name}\n\n${notes}` : `Dot. imprezy: ${name}`);
    setOfferGreeting("");
    setOfferOpen(true);
  };

  const buildOfferPayload = () => ({
    to_email: (offerTo || "").trim() || "preview@local",
    client_name: offerClient || undefined,
    event_date: date || undefined,
    people_count: peopleNum || undefined,
    package_set_id: (packageSet || null) as any,
    extras: Object.entries(extras).filter(([, q]) => (q || 0) > 0).map(([id, q]) => ({ id, qty: q as number })),
    custom_note: offerNote || undefined,
    custom_greeting: offerGreeting || undefined,
    event_id: id === "new" ? undefined : (id as string),
    event_type: (category.startsWith("dorosli/firmowe") ? "firmowe"
      : category.startsWith("dzieci/urodzinki") ? "urodziny"
      : category.startsWith("dzieci/wycieczki") || category.startsWith("warsztaty") ? "warsztaty"
      : "okolicznosciowe") as "firmowe" | "urodziny" | "warsztaty" | "okolicznosciowe",
  });

  const previewOfferPdf = async () => {
    setOfferPreviewing(true);
    try {
      const blob = await api.previewOfferPdf(buildOfferPayload());
      if (Platform.OS === "web") {
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        // Save to cache + share/open with system viewer
        const b64 = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result || "").split(",")[1] || "");
          r.onerror = () => rej(r.error);
          r.readAsDataURL(blob);
        });
        const FS = await import("expo-file-system/legacy");
        const Sharing = await import("expo-sharing");
        const path = FS.cacheDirectory + `Oferta-podglad-${Date.now()}.pdf`;
        await FS.writeAsStringAsync(path, b64, { encoding: FS.EncodingType.Base64 });
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
      }
    } catch (e: any) {
      Alert.alert("Błąd podglądu", e?.message || "Nie udało się wygenerować podglądu");
    } finally { setOfferPreviewing(false); }
  };

  // ---- Send catering order email (dinner_items → yubari.restauracja@gmail.com) ----
  const [cateringOpen, setCateringOpen] = useState(false);
  const [cateringTo, setCateringTo] = useState("yubari.restauracja@gmail.com");
  const [cateringPickup, setCateringPickup] = useState("");
  const [cateringNotes, setCateringNotes] = useState("");
  const [cateringGreeting, setCateringGreeting] = useState("Cześć Lorena, poniżej wysyłam zamówienie.");
  const [cateringSending, setCateringSending] = useState(false);
  const openCateringModal = () => {
    if (isNew) {
      Alert.alert("Zapisz najpierw", "Zapisz imprezę, żeby móc wysłać zamówienie cateringowe.");
      return;
    }
    // Prefill godzina odbioru: 2h before event time_start if set
    if (timeStart) {
      const [hh, mm] = timeStart.split(":").map(Number);
      if (!isNaN(hh)) {
        const dt = new Date(); dt.setHours(hh - 2, mm || 0, 0);
        setCateringPickup(`${String(dt.getHours()).padStart(2,"0")}:${String(dt.getMinutes()).padStart(2,"0")}`);
      }
    }
    setCateringOpen(true);
  };
  const sendCateringForEvent = async () => {
    const hasDinner = Object.values(dinnerQty).some(q => (q || 0) > 0);
    if (!hasDinner) { Alert.alert("Brak pozycji", "Nie zaznaczono nic z menu obiadowego."); return; }
    if (!cateringTo.trim() || !cateringTo.includes("@")) { Alert.alert("Błąd", "Nieprawidłowy adres e-mail."); return; }
    setCateringSending(true);
    try {
      await api.sendCateringEmail(id as string, {
        to_email: cateringTo.trim(),
        pickup_time: cateringPickup.trim() || undefined,
        extra_notes: cateringNotes.trim() || undefined,
        greeting: cateringGreeting,
      });
      setCateringOpen(false);
      Alert.alert("Wysłano ✓", `Zamówienie poszło na ${cateringTo.trim()}.`);
    } catch (e: any) {
      Alert.alert("Nie udało się wysłać", e?.message || "Spróbuj ponownie.");
    } finally { setCateringSending(false); }
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
      else if (category.startsWith("dzieci/wycieczki") || category.startsWith("warsztaty")) eventType = "warsztaty";
      await api.sendOfferEmail({
        to_email: offerTo.trim(),
        client_name: offerClient.trim() || undefined,
        event_date: date || undefined,
        people_count: peopleNum || undefined,
        package_set_id: isSetId ? (packageSet as any) : undefined,
        extras: extrasPayload,
        custom_note: offerNote.trim() || undefined,
        custom_greeting: offerGreeting.trim() || undefined,
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
    return <View style={[s.root, { justifyContent: "center", alignItems: "center" }]}><ActivityIndicator color={v2.color.forest} /></View>;
  }

  const availStaff = staffAll.filter(s => !shifts.some(sh => sh.staff_id === s.id));

  // Kompaktowe podsumowanie (nagłówek karty)
  const statusMeta: Record<string, { label: string; color: string }> = {
    wstepne: { label: "Wstępne zapytanie", color: "#F59E0B" },
    rezerwacja: { label: "Rezerwacja", color: "#F97316" },
    potwierdzona: { label: "Potwierdzona", color: "#10B981" },
    zakonczona: { label: "Zakończona", color: "#3B82F6" },
    anulowana: { label: "Anulowana", color: "#EF4444" },
  };
  const priceForKpi = parseAmt(priceTotal) > 0
    ? (parseAmt(discountPct) > 0 ? parseAmt(priceTotal) * (1 - parseAmt(discountPct) / 100) : parseAmt(priceTotal))
    : discountedValue;
  const kpiRemaining = priceForKpi - (depositPaid ? parseAmt(depositAmount) : 0);

  return (
    <View style={s.root} testID="event-detail-screen">
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Pressable testID="event-back-btn" onPress={() => router.back()} hitSlop={12} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={s.headerBrand}>{isNew ? "NOWA IMPREZA" : "CENTRUM IMPREZY"}</Text>
          <Text style={s.headerTitle} numberOfLines={1}>{isNew ? "Utwórz nową" : (name || "Edytuj imprezę")}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 4 }}>
          {!isNew && !isEmp ? (
            <Pressable testID="event-send-summary-btn" onPress={openSummaryModal} hitSlop={12} style={s.backBtn}>
              <Feather name="file-text" size={17} color="#fff" />
            </Pressable>
          ) : null}
          {!isEmp ? (
            <Pressable testID="event-send-offer-btn" onPress={openOfferModal} hitSlop={12} style={s.backBtn}>
              <Feather name="mail" size={18} color="#fff" />
            </Pressable>
          ) : null}
          {!isNew && eperm("event_delete") ? (
            <Pressable testID="event-delete-btn" onPress={remove} hitSlop={12} style={[s.backBtn, { backgroundColor: "rgba(220,38,38,0.35)" }]}>
              <Feather name="trash-2" size={18} color="#fff" />
            </Pressable>
          ) : <View style={{ width: 36 }} />}
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 160 }} keyboardShouldPersistTaps="handled">
          <Section title="Kategoria">
            <Pressable testID="event-category-btn" accessibilityRole="button" onPress={() => setCatPickerOpen(true)} style={[s.input, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}>
              <Text style={{ color: category ? v2.color.text : v2.color.textMuted, fontSize: 16 }}>{category ? categoryLabel(category) : "Wybierz kategorię"}</Text>
              <Feather name="chevron-down" size={18} color={v2.color.textMuted} />
            </Pressable>
          </Section>
          <Collapse title="STATUS" icon="flag" defaultOpen testID="sec-status">
          {/* Status */}
          <Section title="">
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
                    onPress={() => {
                      if (!eperm("event_status")) {
                        Alert.alert("Brak uprawnień", "Nie masz uprawnienia do zmiany statusu imprezy.");
                        return;
                      }
                      setStatus(active ? "" : st.k);
                    }}
                    style={{
                      flexDirection: "row", alignItems: "center", gap: 6,
                      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
                      backgroundColor: active ? st.color : v2.color.cardMuted,
                      borderWidth: 1, borderColor: active ? st.color : v2.color.border,
                    }}
                  >
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: st.color }} />
                    <Text style={{ color: active ? "#0A0A0A" : v2.color.text, fontSize: 12, fontWeight: "700" }}>{st.label}</Text>
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
                  placeholderTextColor={v2.color.textMuted}
                  style={s.input}
                />
                <Text style={{ color: v2.color.textMuted, fontSize: 11, marginTop: 6, fontStyle: "italic" }}>
                  💡 Wstępne zapytania blokują termin — po tej dacie aplikacja przypomni Ci o kontakcie z klientem.
                </Text>
              </Field>
            )}

          </Section>

          </Collapse>
          <Collapse title="WYDARZENIE" icon="calendar" defaultOpen testID="sec-dane">
            <Field label="Nazwa wydarzenia">
              <TextInput testID="event-name-input" value={name} onChangeText={setName} placeholder="np. Wycieczka klasy 3A" placeholderTextColor={v2.color.textMuted} style={s.input} />
            </Field>
            <Field label="Termin wycieczki">
              <TextInput testID="event-date-input" value={date} onChangeText={setDate} placeholder="RRRR-MM-DD" placeholderTextColor={v2.color.textMuted} style={s.input} autoCapitalize="none" />
            </Field>
            <Field label="Godzina rozpoczęcia">
              <TextInput testID="event-time-start-input" value={timeStart} onChangeText={setTimeStart} placeholder="09:00" placeholderTextColor={v2.color.textMuted} style={s.input} />
            </Field>
            <Field label="Godzina zakończenia">
              <TextInput testID="event-time-end-input" value={timeEnd} onChangeText={setTimeEnd} placeholder="14:00" placeholderTextColor={v2.color.textMuted} style={s.input} />
            </Field>
            <Field label="Szkoła / przedszkole – nazwa i numer">
              <TextInput testID="event-school" value={org.institution_name ?? ([org.school_name, org.preschool_name].filter(Boolean).join(" / "))} onChangeText={v => setOrgField("institution_name", v)} placeholder="np. Szkoła Podstawowa nr 2" placeholderTextColor={v2.color.textMuted} style={s.input} />
            </Field>
            <Field label="Rodzaj warsztatów">
              <TextInput testID="event-workshop" value={org.workshop_type || ""} onChangeText={v => setOrgField("workshop_type", v)} placeholder="np. Warsztaty przyrodnicze" placeholderTextColor={v2.color.textMuted} style={s.input} />
            </Field>
            <Field label="Liczba dzieci">
              <TextInput testID="event-kids-count" value={org.kids_count != null ? String(org.kids_count) : ""} onChangeText={v => { const clean = v.replace(/\D/g, ""); setOrgField("kids_count", clean === "" ? null : Number(clean)); setPaidCount(clean); }} keyboardType="number-pad" placeholder="0" placeholderTextColor={v2.color.textMuted} style={s.input} />
            </Field>
            <Field label="Opiekunowie gratis – liczba">
              <TextInput testID="event-free-carers" value={freeCarers} onChangeText={v => setFreeCarers(v.replace(/\D/g, ""))} keyboardType="number-pad" placeholder="0" placeholderTextColor={v2.color.textMuted} style={s.input} />
              <Text style={s.maskHint}>Opiekunowie są uwzględnieni organizacyjnie, ale nie zwiększają liczby płatnych osób.</Text>
            </Field>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: showDetails }} onPress={() => setShowDetails(!showDetails)}><Text style={s.maskLink}>{showDetails ? "Ukryj dodatkowe ustalenia" : "Dodatkowe ustalenia, zespół i menu"}</Text></Pressable>
            {showDetails && <>
              <Field label="Lokalizacja"><TextInput value={venue} onChangeText={setVenue} style={s.input} /></Field>
              {!isEmp && <Field label="Opis / notatka"><TextInput value={notes} onChangeText={setNotes} multiline style={[s.input, { minHeight: 90 }]} /></Field>}
          <Collapse title="Organizacja — widoczna dla obsługi" icon="clipboard" testID="sec-organizacja">
          <Section title="Pracownicy na zmianie">
          {/* Staff */}
          <Section title="">
            {shifts.length === 0 && <Text style={s.hint}>Brak przypisanych pracowników</Text>}
            {shifts.map((sh, i) => {
              const s2 = staffMap[sh.staff_id];
              return (
                <View key={sh.staff_id} style={s.shiftBlock}>
                  <View style={s.shiftRow}>
                    <View style={s.avatar}><Text style={s.avatarText}>{initials(s2?.name)}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.shiftName}>{s2?.name || "?"}</Text>
                      {eperm("finances") ? <Text style={s.shiftRate}>{formatPLN(s2?.hourly_rate || 0)}/godz.</Text> : null}
                    </View>
                    <Text style={s.shiftHoursBadge}>{(Number(sh.hours) || 0).toFixed(1)} h</Text>
                    {!isEmp ? (
                    <Pressable testID={`shift-del-${i}`} onPress={() => setShifts(shifts.filter((_, ix) => ix !== i))} hitSlop={8} style={s.iconBtn}>
                      <Feather name="x" size={16} color={v2.color.textMuted} />
                    </Pressable>
                    ) : null}
                  </View>
                  {availByStaff[sh.staff_id]?.status === "unavailable" ? (
                    <View style={s.availWarn}>
                      <Feather name="alert-triangle" size={13} color={v2.color.error} />
                      <Text style={s.availWarnText}>
                        Zgłoszony brak dostępności {availByStaff[sh.staff_id].all_day === false
                          ? `w godz. ${availByStaff[sh.staff_id].time_from}–${availByStaff[sh.staff_id].time_to}`
                          : "(cały dzień)"}
                        {availByStaff[sh.staff_id].note ? ` · „${availByStaff[sh.staff_id].note}”` : ""}
                      </Text>
                    </View>
                  ) : null}
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
                        placeholderTextColor={v2.color.textMuted}
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
                        placeholderTextColor={v2.color.textMuted}
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
                        placeholderTextColor={v2.color.textMuted}
                        keyboardType="decimal-pad"
                        style={s.timeInput}
                      />
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.miniLabel}>Rola na imprezie</Text>
                      <TextInput
                        testID={`shift-role-${i}`}
                        value={sh.role || ""}
                        onChangeText={(v) => setShifts(shifts.map((x, ix) => ix === i ? { ...x, role: v } : x))}
                        placeholder="np. przygotowanie / obsługa"
                        placeholderTextColor={v2.color.textMuted}
                        style={s.timeInput}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.miniLabel}>Notatka (opcjonalna)</Text>
                      <TextInput
                        testID={`shift-note-${i}`}
                        value={sh.note || ""}
                        onChangeText={(v) => setShifts(shifts.map((x, ix) => ix === i ? { ...x, note: v } : x))}
                        placeholder="np. dekoracje od 9:00"
                        placeholderTextColor={v2.color.textMuted}
                        style={s.timeInput}
                      />
                    </View>
                  </View>
                </View>
              );
            })}
            {!isEmp && availStaff.length > 0 ? (
              <Pressable testID="shift-add-btn" onPress={() => setPickerOpen(true)} style={s.addRow}>
                <Feather name="plus" size={16} color={v2.color.forest} />
                <Text style={s.addRowText}>Dodaj pracownika</Text>
              </Pressable>
            ) : staffAll.length === 0 ? (
              <Text style={s.hint}>Najpierw dodaj pracowników w zakładce Pracownicy</Text>
            ) : null}
          </Section>

          </Section>
          {/* Organizacja — widoczne dla obsługi */}
          <Section title="">
            {([
              ["tables_setup", "Ustawienie stołów", "np. 4 stoły po 8 osób, podkowa"],
              ["tables_plan", "Plan / układ stołów", "opis układu, jeśli ustalony"],
              ["menu_details", "Menu (szczegóły dla obsługi)", "co i o której wydajemy"],
              ["grill", "Grill / ognisko", "np. kiełbaski o 18:00, ognisko 19:30"],
              ["drinks", "Napoje", "np. cola, soki, woda z cytryną"],
              ["cakes", "Ciasta i przekąski", "np. tort klienta + 2 ciasta"],
              ["client_provisions", "Dodatkowy prowiant klienta", "co klient przywozi"],
              ["decorations", "Dekoracje", "np. balony, girlandy — kto i kiedy"],
              ["attractions", "Atrakcje", "np. alpaki 16:00, animacje 17:00"],
              ["extra_orders", "Dodatkowe zamówienia", ""],
              ["org_notes", "Informacje organizacyjne", ""],
              ["special_requests", "Specjalne wymagania klienta", ""],
              ["allergies", "Alergie / wymagania żywieniowe", "np. 1 os. bez glutenu"],
              ["setup_info", "Przygotowanie miejsca", "np. wiata + leżaki, parasole"],
            ] as const).map(([k, label, ph]) => (
              <Field key={k} label={label}>
                <TextInput
                  testID={`org-${k}`}
                  value={org[k] || ""}
                  onChangeText={t => setOrgField(k, t)}
                  editable={eperm("event_org_edit")}
                  placeholder={ph || "…"}
                  placeholderTextColor={v2.color.textMuted}
                  style={[s.input, { minHeight: 44 }]}
                  multiline
                />
              </Field>
            ))}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
              <Pressable
                testID="org-own-decorations-toggle"
                onPress={() => setOrgField("client_own_decorations", !org.client_own_decorations)}
                style={{
                  flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10,
                  borderRadius: 10, borderWidth: 1.5,
                  borderColor: org.client_own_decorations ? v2.color.forest : v2.color.border,
                  backgroundColor: org.client_own_decorations ? v2.color.mint : v2.color.card,
                }}
              >
                <Feather name={org.client_own_decorations ? "check-square" : "square"} size={16} color={v2.color.forest} />
                <Text style={{ color: v2.color.text, fontSize: 12, fontWeight: "700" }}>Klient robi własne dekoracje</Text>
              </Pressable>
              <Pressable
                testID="org-early-arrival-toggle"
                onPress={() => setOrgField("early_arrival", !org.early_arrival)}
                style={{
                  flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10,
                  borderRadius: 10, borderWidth: 1.5,
                  borderColor: org.early_arrival ? v2.color.forest : v2.color.border,
                  backgroundColor: org.early_arrival ? v2.color.mint : v2.color.card,
                }}
              >
                <Feather name={org.early_arrival ? "check-square" : "square"} size={16} color={v2.color.forest} />
                <Text style={{ color: v2.color.text, fontSize: 12, fontWeight: "700" }}>Klient przyjedzie wcześniej</Text>
              </Pressable>
            </View>
            {!!org.early_arrival && (
              <Field label="Godzina wcześniejszego przyjazdu">
                <TextInput
                  testID="org-early-arrival-time"
                  value={org.early_arrival_time || ""}
                  onChangeText={t => setOrgField("early_arrival_time", t)}
                  placeholder="15:30" placeholderTextColor={v2.color.textMuted} style={s.input}
                />
              </Field>
            )}
            <Text style={{ color: v2.color.textMuted, fontSize: 11, marginTop: 6 }}>
              Te pola zobaczy obsługa przypisana do imprezy (Moja praca). Zapisują się przyciskiem „Zapisz” na dole.
            </Text>
          </Section>

          </Collapse>

          <Section title="Menu / Catering — oferta obiadowa">
            {(
              <>
            <Text style={{ color: v2.color.textMuted, fontSize: 11, marginBottom: 8, marginTop: 10 }}>
              Wpisz ilości porcji z menu obiadowego. Marża liczona automatycznie z ukrytych cen zakupu.
            </Text>

            {/* Catering presets — quick fill */}
            <View style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <Feather name="zap" size={12} color={v2.color.forest} />
                <Text style={{ color: v2.color.text, fontSize: 12, fontWeight: "800", letterSpacing: 0.3, textTransform: "uppercase" }}>Szybki wybór</Text>
                <Text style={{ color: v2.color.textMuted, fontSize: 11 }}>· na {parseAmt(people) || 0} osób</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
                {CATERING_PRESET_TEMPLATES.map(tpl => (
                  <Pressable
                    key={tpl.id}
                    testID={`catering-preset-${tpl.id}`}
                    onPress={() => {
                      const p = parseAmt(people) || 0;
                      if (p <= 0) {
                        Alert.alert("Wpisz liczbę osób", "Ustaw ilu jest gości, żeby zastosować preset.");
                        return;
                      }
                      const nextQty = buildPresetQty(tpl.id, p);
                      setDinnerQty(prev => ({ ...prev, ...nextQty }));
                      setAutoPrice(true);
                    }}
                    style={{
                      minWidth: 180, maxWidth: 240,
                      padding: 10, borderRadius: 12,
                      backgroundColor: v2.color.mint,
                      borderWidth: 1, borderColor: v2.color.forest + "44",
                    }}
                  >
                    <Text style={{ color: v2.color.forest, fontWeight: "800", fontSize: 13 }}>{tpl.label}</Text>
                    <Text style={{ color: v2.color.textMuted, fontSize: 10, marginTop: 2 }} numberOfLines={2}>{tpl.description}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Text style={{ color: v2.color.textSubtle, fontSize: 10, marginTop: 6, fontStyle: "italic" }}>
                Preset dodaje porcje × liczba osób. Możesz potem edytować ręcznie.
              </Text>
            </View>

            {DINNER_SECTIONS.map(sec => {
              const items = DINNER_MENU.filter(m => m.section === sec.id);
              return (
                <View key={sec.id} style={{ marginBottom: 8 }}>
                  <Text style={{ color: v2.color.textMuted, fontSize: 10, letterSpacing: 1, marginBottom: 4, textTransform: "uppercase" }}>{sec.title}</Text>
                  {items.map(it => {
                    const q = dinnerQty[it.id] || 0;
                    const price = discountedPrice(it.base_price);
                    const line = q * price;
                    return (
                      <View key={it.id} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 6, gap: 8 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, color: v2.color.text }}>{it.name}</Text>
                          <Text style={{ fontSize: 10, color: v2.color.textMuted }}>{price} zł / {it.unit}</Text>
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
                          placeholderTextColor={v2.color.textMuted}
                          keyboardType="decimal-pad"
                          style={s.extraQtyInput}
                        />
                        <Text style={{ minWidth: 60, textAlign: "right", fontWeight: "700", color: line ? v2.color.forest : v2.color.textMuted, fontSize: 12 }}>{line ? `${line.toFixed(0)} zł` : "—"}</Text>
                      </View>
                    );
                  })}
                </View>
              );
            })}
              </>
            )}
            {dinnerRevenue > 0 && (
              <View style={{ marginTop: 12, backgroundColor: v2.color.forest + "10", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: v2.color.forest + "44" }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                  <Text style={{ color: v2.color.text, fontSize: 13, fontWeight: "700" }}>Suma obiadu</Text>
                  <Text style={{ color: v2.color.forest, fontSize: 16, fontWeight: "800" }}>{dinnerRevenue.toFixed(0)} zł</Text>
                </View>
                <Text style={[s.label, { marginTop: 8 }]}>Koszt zakupu (opcjonalne nadpisanie — puste = auto)</Text>
                <TextInput
                  testID="dinner-cost-input"
                  value={dinnerCost}
                  onChangeText={setDinnerCost}
                  placeholder={`Auto: ${dinnerAutoCostVal.toFixed(2)} zł`}
                  placeholderTextColor={v2.color.textMuted}
                  keyboardType="decimal-pad"
                  style={s.input}
                />
                <View style={{ flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <View style={{ flex: 1, backgroundColor: v2.color.bg, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: v2.color.divider }}>
                    <Text style={{ fontSize: 10, color: v2.color.textMuted, letterSpacing: 0.5, textTransform: "uppercase" }}>Zysk</Text>
                    <Text style={{ fontSize: 18, fontWeight: "800", color: dinnerProfit >= 0 ? v2.color.forest : v2.color.error }}>
                      {dinnerProfit.toFixed(0)} zł
                    </Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: v2.color.bg, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: v2.color.divider }}>
                    <Text style={{ fontSize: 10, color: v2.color.textMuted, letterSpacing: 0.5, textTransform: "uppercase" }}>Marża</Text>
                    <Text style={{ fontSize: 18, fontWeight: "800", color: dinnerMargin >= 0 ? v2.color.forest : v2.color.error }}>
                      {dinnerMargin.toFixed(1)}%
                    </Text>
                  </View>
                </View>
              </View>
            )}
            {/* Wyślij do cateringu (Yubari) */}
            {Object.values(dinnerQty).some(q => (q || 0) > 0) && !isNew ? (
              <Pressable onPress={openCateringModal} style={{ marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 12, backgroundColor: v2.color.forest + "18", borderWidth: 1, borderColor: v2.color.forest }}>
                <Feather name="send" size={16} color={v2.color.forest} />
                <Text style={{ color: v2.color.forest, fontWeight: "800", fontSize: 13 }}>Wyślij zamówienie do cateringu (Yubari)</Text>
              </Pressable>
            ) : null}
          </Section>

          {/* Najnowsze informacje od klienta */}
          {!isNew && (
            <Section title="Najnowsze informacje od klienta">
              <TextInput
                testID="client-update-input"
                value={clientUpdateText}
                onChangeText={setClientUpdateText}
                placeholder="np. Będzie nas 34 osoby. Przywieziemy tort i dwa ciasta…"
                placeholderTextColor={v2.color.textMuted}
                style={[s.input, { height: 100, textAlignVertical: "top" }]}
                multiline
              />
              {!!clientUpdateAt && (
                <Text style={{ color: v2.color.textMuted, fontSize: 11, marginTop: 4 }}>Zaktualizowano: {fmtStamp(clientUpdateAt)}</Text>
              )}
              <Pressable
                testID="client-update-save"
                onPress={saveClientUpdate}
                disabled={clientUpdateSaving}
                style={{ marginTop: 8, paddingVertical: 12, borderRadius: 10, backgroundColor: v2.color.forest, alignItems: "center", opacity: clientUpdateSaving ? 0.5 : 1 }}
              >
                {clientUpdateSaving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: "#fff", fontSize: 13, fontWeight: "800" }}>Zapisz — pokaż obsłudze</Text>}
              </Pressable>
            </Section>
          )}

          {/* Informacja dla obsługi */}
          {!isNew && (
            <Section title="Informacja dla obsługi">
              {serviceInfos.length === 0 && (
                <Text style={{ color: v2.color.textMuted, fontSize: 12, marginBottom: 6 }}>Brak informacji. Dodaj np. „Klient przyjedzie o 15:45 z tortem.”</Text>
              )}
              {serviceInfos.map(info => (
                <View key={info.id} style={{
                  flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 10, marginBottom: 6,
                  backgroundColor: info.important ? "#FEF3C7" : v2.color.bg,
                  borderWidth: 1, borderColor: info.important ? "#F59E0B" : v2.color.border,
                }}>
                  <View style={{ flex: 1 }}>
                    {!!info.important && <Text style={{ color: "#92400E", fontSize: 10, fontWeight: "900", marginBottom: 2 }}>⚠ WAŻNE DLA OBSŁUGI</Text>}
                    <Text style={{ color: v2.color.text, fontSize: 13, lineHeight: 19 }}>{info.text}</Text>
                    <Text style={{ color: v2.color.textMuted, fontSize: 10, marginTop: 2 }}>{info.author_name} · {fmtStamp(info.created_at)}</Text>
                  </View>
                  <Pressable testID={`service-info-delete-${info.id}`} onPress={() => removeServiceInfo(info.id)} hitSlop={8}>
                    <Feather name="trash-2" size={15} color={v2.color.error || "#EF4444"} />
                  </Pressable>
                </View>
              ))}
              <TextInput
                testID="service-info-input"
                value={newInfoText}
                onChangeText={setNewInfoText}
                placeholder="np. Kiełbaski wydajemy o 18:00…"
                placeholderTextColor={v2.color.textMuted}
                style={[s.input, { minHeight: 60, textAlignVertical: "top" }]}
                multiline
              />
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8, alignItems: "center" }}>
                <Pressable
                  testID="service-info-important-toggle"
                  onPress={() => setNewInfoImportant(v => !v)}
                  style={{
                    flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 10,
                    borderRadius: 10, borderWidth: 1.5,
                    borderColor: newInfoImportant ? "#F59E0B" : v2.color.border,
                    backgroundColor: newInfoImportant ? "#FEF3C7" : v2.color.card,
                  }}
                >
                  <Feather name={newInfoImportant ? "check-square" : "square"} size={15} color="#B45309" />
                  <Text style={{ color: "#92400E", fontSize: 12, fontWeight: "800" }}>⚠ WAŻNE</Text>
                </Pressable>
                <Pressable
                  testID="service-info-add"
                  onPress={addServiceInfo}
                  style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: v2.color.forest, alignItems: "center" }}
                >
                  <Text style={{ color: "#fff", fontSize: 13, fontWeight: "800" }}>Dodaj informację</Text>
                </Pressable>
              </View>
            </Section>
          )}

          {/* Informacje od zespołu */}
          {!isNew && (
            <Section title="Informacje od zespołu">
              {teamComments.length === 0 ? (
                <Text style={{ color: v2.color.textMuted, fontSize: 12 }}>Brak informacji od pracowników.</Text>
              ) : teamComments.map(c => (
                <View key={c.id} style={{ padding: 10, borderRadius: 10, backgroundColor: v2.color.bg, borderWidth: 1, borderColor: v2.color.border, marginBottom: 6 }} testID={`team-comment-${c.id}`}>
                  <Text style={{ color: v2.color.forest, fontSize: 12, fontWeight: "800" }}>
                    {c.author_name} <Text style={{ color: v2.color.textMuted, fontWeight: "400" }}>• {fmtStamp(c.created_at)}</Text>
                  </Text>
                  <Text style={{ color: v2.color.text, fontSize: 13, lineHeight: 19, marginTop: 2 }}>„{c.text}”</Text>
                </View>
              ))}
            </Section>
          )}

            </>}
          </Collapse>
          <Collapse title="OSOBA KONTAKTOWA" icon="user" defaultOpen testID="sec-contact">
            <Field label="Imię i nazwisko"><TextInput testID="event-client-name" value={clientName} onChangeText={setClientName} style={s.input} /></Field>
            <Field label="Telefon kontaktowy"><TextInput testID="event-client-phone" value={clientPhone} onChangeText={setClientPhone} keyboardType="phone-pad" style={s.input} /></Field>
            <Field label="Adres e-mail"><TextInput testID="event-client-email" value={clientEmail} onChangeText={setClientEmail} keyboardType="email-address" autoCapitalize="none" style={s.input} /></Field>
          {/* NOWA ODPPOWIEDŹ KLIENTA — AI suggestions from Gmail replies */}
          {!isNew && replySuggestions.map(sug => (
            <View key={sug.id} style={{
              padding: 14, borderRadius: 14, marginBottom: 14,
              backgroundColor: "#DBEAFE", borderWidth: 1.5, borderColor: "#3B82F6",
            }} testID={`client-reply-suggestion-${sug.id}`}>
              <Text style={{ color: "#1E40AF", fontSize: 12, fontWeight: "900", letterSpacing: 1 }}>📩 NOWA ODPOWIEDŹ KLIENTA</Text>
              <Text style={{ color: "#1E3A8A", fontSize: 11, marginTop: 2 }}>
                {sug.from_name || sug.from_email} · {fmtStamp(sug.created_at)}
              </Text>
              <View style={{ padding: 10, borderRadius: 10, backgroundColor: "#fff", marginTop: 8 }}>
                <Text style={{ color: v2.color.textMuted, fontSize: 10, fontWeight: "800", marginBottom: 4 }}>KLIENT NAPISAŁ:</Text>
                <Text style={{ color: v2.color.text, fontSize: 13, lineHeight: 19 }}>„{sug.client_text}”</Text>
              </View>
              {(sug.summary_lines || []).length > 0 && (
                <View style={{ padding: 10, borderRadius: 10, backgroundColor: "#EFF6FF", marginTop: 8 }}>
                  <Text style={{ color: "#1E40AF", fontSize: 10, fontWeight: "800", marginBottom: 4 }}>AI ROZPOZNAŁO:</Text>
                  {(sug.summary_lines || []).map((l: string, i: number) => (
                    <Text key={i} style={{ color: "#1E3A8A", fontSize: 13, fontWeight: "700", lineHeight: 20 }}>• {l}</Text>
                  ))}
                </View>
              )}
              {sugEdit[sug.id] !== undefined && (
                <TextInput
                  value={sugEdit[sug.id]}
                  onChangeText={t => setSugEdit(p => ({ ...p, [sug.id]: t }))}
                  multiline
                  style={[s.input, { height: 100, textAlignVertical: "top", marginTop: 8, backgroundColor: "#fff" }]}
                  placeholder="Edytuj informacje przed zapisem…"
                  placeholderTextColor={v2.color.textMuted}
                />
              )}
              <View style={{ flexDirection: "row", gap: 6, marginTop: 10 }}>
                <Pressable
                  testID={`sug-approve-${sug.id}`}
                  disabled={sugBusy}
                  onPress={() => approveSuggestion(sug)}
                  style={{ flex: 1.4, paddingVertical: 11, borderRadius: 10, backgroundColor: "#16A34A", alignItems: "center", opacity: sugBusy ? 0.5 : 1 }}
                >
                  <Text style={{ color: "#fff", fontSize: 12, fontWeight: "900" }}>ZATWIERDŹ I ZAPISZ</Text>
                </Pressable>
                <Pressable
                  testID={`sug-edit-${sug.id}`}
                  disabled={sugBusy}
                  onPress={() => setSugEdit(p => ({ ...p, [sug.id]: p[sug.id] !== undefined ? p[sug.id] : (sug.summary_lines || []).join("\n") }))}
                  style={{ flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1.5, borderColor: "#3B82F6", alignItems: "center" }}
                >
                  <Text style={{ color: "#1E40AF", fontSize: 12, fontWeight: "900" }}>EDYTUJ</Text>
                </Pressable>
                <Pressable
                  testID={`sug-reject-${sug.id}`}
                  disabled={sugBusy}
                  onPress={() => rejectSuggestion(sug)}
                  style={{ flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1.5, borderColor: "#EF4444", alignItems: "center" }}
                >
                  <Text style={{ color: "#B91C1C", fontSize: 12, fontWeight: "900" }}>ODRZUĆ</Text>
                </Pressable>
              </View>

              {/* Etap 2 — AI odpowiedź do klienta */}
              {(sugReply[sug.id]?.sent || sug.reply_sent_at) ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, padding: 8, borderRadius: 8, backgroundColor: "#DCFCE7" }}>
                  <Feather name="check-circle" size={14} color="#16A34A" />
                  <Text style={{ color: "#166534", fontSize: 12, fontWeight: "800" }}>
                    Odpowiedź wysłana{sugReply[sug.id]?.sent ? ` na ${sugReply[sug.id]?.sent}` : (sug.reply_sent_to ? ` na ${sug.reply_sent_to}` : "")}
                  </Text>
                </View>
              ) : sugReply[sug.id] ? (
                sugReply[sug.id].busy && !sugReply[sug.id].draft ? (
                  <View style={{ marginTop: 12, alignItems: "center", gap: 6 }}>
                    <ActivityIndicator color="#1E40AF" />
                    <Text style={{ color: "#1E40AF", fontSize: 11, fontWeight: "700" }}>AI pisze szkic odpowiedzi…</Text>
                  </View>
                ) : (
                  <View style={{ marginTop: 12 }}>
                    <Text style={{ color: "#1E40AF", fontSize: 10, fontWeight: "800", marginBottom: 4 }}>SZKIC ODPOWIEDZI (AI) — edytuj przed wysyłką:</Text>
                    <TextInput
                      value={sugReply[sug.id].subject}
                      onChangeText={t => setSugReply(p => ({ ...p, [sug.id]: { ...p[sug.id], subject: t } }))}
                      style={[s.input, { backgroundColor: "#fff", marginBottom: 6 }]}
                      placeholder="Temat"
                      placeholderTextColor={v2.color.textMuted}
                      testID={`sug-reply-subject-${sug.id}`}
                    />
                    <TextInput
                      value={sugReply[sug.id].draft}
                      onChangeText={t => setSugReply(p => ({ ...p, [sug.id]: { ...p[sug.id], draft: t } }))}
                      multiline
                      style={[s.input, { height: 170, textAlignVertical: "top", backgroundColor: "#fff" }]}
                      testID={`sug-reply-draft-${sug.id}`}
                    />
                    <Pressable
                      testID={`sug-reply-send-${sug.id}`}
                      disabled={sugReply[sug.id].busy}
                      onPress={() => sendReply(sug)}
                      style={{ marginTop: 8, paddingVertical: 12, borderRadius: 10, backgroundColor: "#1E40AF", alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6, opacity: sugReply[sug.id].busy ? 0.5 : 1 }}
                    >
                      {sugReply[sug.id].busy ? <ActivityIndicator color="#fff" size="small" /> : <Feather name="send" size={14} color="#fff" />}
                      <Text style={{ color: "#fff", fontSize: 12, fontWeight: "900" }}>
                        WYŚLIJ ODPOWIEDŹ{sugReply[sug.id].to ? ` (${sugReply[sug.id].to})` : ""}
                      </Text>
                    </Pressable>
                  </View>
                )
              ) : (
                <Pressable
                  testID={`sug-reply-generate-${sug.id}`}
                  onPress={() => generateReplyDraft(sug)}
                  style={{ marginTop: 8, paddingVertical: 11, borderRadius: 10, borderWidth: 1.5, borderColor: "#7C3AED", alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6, backgroundColor: "#F5F3FF" }}
                >
                  <Feather name="edit-3" size={13} color="#6D28D9" />
                  <Text style={{ color: "#6D28D9", fontSize: 12, fontWeight: "900" }}>✨ WYGENERUJ ODPOWIEDŹ AI</Text>
                </Pressable>
              )}
            </View>
          ))}

          {/* Template chips - shown for new events */}
          {isNew && templates.length > 0 && (
            <Pressable testID="tpl-load-btn" onPress={() => setTplPickerOpen(true)} style={s.tplLoadBtn}>
              <Feather name="copy" size={16} color={v2.color.forest} />
              <Text style={s.tplLoadText}>Wczytaj z szablonu ({templates.length})</Text>
            </Pressable>
          )}





          </Collapse>
          {(eperm("offer_prices") || eperm("finances")) && <Collapse title="FINANSE" icon="dollar-sign" defaultOpen testID="sec-finanse">
            {!perPersonMode && <View style={s.maskNotice}>
              <Text style={s.maskHint}>Ta impreza ma wcześniejsze rozliczenie. Pozostanie zachowane, dopóki nie włączysz nowego kalkulatora.</Text>
              {eperm("offer_prices") && <Pressable accessibilityRole="button" onPress={() => { setPerPersonMode(true); setAutoPrice(false); }}><Text style={s.maskLink}>Włącz kalkulator cena × osoby</Text></Pressable>}
            </View>}
            {eperm("offer_prices") && <>
              <Field label="Cena za osobę (brutto)"><TextInput testID="event-unit-price" value={pricePerPerson} onChangeText={setUnitPrice} keyboardType="decimal-pad" placeholder="np. 90" placeholderTextColor={v2.color.textMuted} style={s.input} /></Field>
              <Field label="Liczba osób (płatnych)"><TextInput testID="event-paying-people" value={payingPeople} onChangeText={setPaidCount} keyboardType="number-pad" placeholder="np. 35" placeholderTextColor={v2.color.textMuted} style={s.input} /></Field>
              <Field label="Rabat %"><TextInput testID="event-discount-pct" value={discountPct} onChangeText={v => { setDiscountPct(v); setPerPersonMode(true); setAutoPrice(false); }} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={v2.color.textMuted} style={s.input} /></Field>
            </>}
            {perPersonMode && !!financial.error && <Text accessibilityRole="alert" style={s.maskError}>{financial.error}</Text>}
            {financeValues && <View style={s.maskTotals}>
              {perPersonMode && <SummaryRow label="Cena × liczba płatnych osób" value={financeValues.subtotal} />}
              {perPersonMode && <SummaryRow label="Rabat (kwota)" value={financeValues.discount} />}
              <SummaryRow label={perPersonMode || vatRate === 23 ? "VAT 23%" : "VAT — zapisane rozliczenie"} value={financeValues.vat} />
              <SummaryRow label="Netto (informacyjnie)" value={financeValues.net} />
              <SummaryRow label="Brutto" value={financeValues.gross} />
              <SummaryRow label="Suma do zapłaty (brutto)" value={financeValues.gross} bold />
              <Text style={s.maskHint}>Cała należność po rabacie. Wpłaty i pozostałą kwotę pokazuje rozliczenie wpłat poniżej.</Text>
            </View>}
            {eperm("finances") && <>
              {costs.length <= 1 ? <Field label="Koszty wydarzenia (brutto)">
                <TextInput testID="event-total-cost-input" value={costInput} onChangeText={v => { setCostInput(v); setCosts([{ ...(costs[0] || { label: "Koszty wydarzenia" }), amount: parseAmt(v) }]); }} keyboardType="decimal-pad" placeholder="np. 900" placeholderTextColor={v2.color.textMuted} style={s.input} />
                {laborCost > 0 && <Text style={s.maskHint}>Do tej kwoty doliczana jest praca zespołu: {formatPLN(laborCost)}.</Text>}
              </Field> : <Section title="Koszty wydarzenia (brutto)">{costs.map((c, i) => <Field key={i} label={c.label}><TextInput value={String(c.amount)} onChangeText={v => setCosts(costs.map((entry, index) => index === i ? { ...entry, amount: parseAmt(v) } : entry))} keyboardType="decimal-pad" style={s.input} /></Field>)}</Section>}
              {financeValues && <>
                <SummaryRow label="Koszty wydarzenia łącznie (brutto)" value={financeValues.costs} bold />
                <SummaryRow label="Zysk" value={financeValues.profit} bold />
                <Text style={s.maskHint}>{perPersonMode ? "Zysk = suma brutto po rabacie − koszty brutto." : "Zysk zgodnie z dotychczasowym rozliczeniem."}</Text>
              </>}
              {!isNew && <Section title="Wpłaty klienta"><EventPayments eventId={String(id)} priceTotalOverride={financeValues?.gross} /></Section>}
            </>}
          </Collapse>}
          <Collapse title="AUTOMATYZACJE" icon="mail" defaultOpen testID="sec-automations">
            <Text style={s.maskHint}>Podziękowanie / wiadomości po wydarzeniu</Text>
            <Text style={s.compactText}>{thanksStatus?.sent ? "Podziękowanie zostało wysłane." : "Przy oznaczeniu imprezy jako zakończonej wybierzesz, czy wysłać podziękowanie."}</Text>
            {!isEmp && <>
              <Pressable onPress={() => router.push("/ustawienia/podziekowanie" as any)} style={s.tplLoadBtn}><Text style={s.tplLoadText}>Ustawienia podziękowań</Text></Pressable>
              <Pressable onPress={openOfferModal} style={s.tplLoadBtn} testID="event-offer-action"><Text style={s.tplLoadText}>Wiadomość / oferta do klienta</Text></Pressable>
              {!isNew && <Pressable onPress={openSummaryModal} style={s.tplLoadBtn} testID="event-summary-action"><Text style={s.tplLoadText}>Wyślij podsumowanie</Text></Pressable>}
            </>}
          </Collapse>
          <Collapse title="HISTORIA ZMIAN" icon="clock" testID="sec-history">
            <Text style={s.maskHint}>Kto, co i kiedy zmienił</Text>
            {isNew ? <Text style={s.compactText}>Historia będzie dostępna po zapisaniu imprezy.</Text> : <EventAuditList eventId={String(id)} />}
            {!isEmp && <TimeTreeEventInfo event={timeTreeEvent} values={{ name, date, time_start: timeStart, time_end: timeEnd, notes, venue }} />}
          </Collapse>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable testID="event-save-btn" onPress={save} disabled={!canSaveEvent || saving || !name.trim() || !date || (perPersonMode && !!financial.error)} style={[s.saveBtn, (saving || !name.trim() || !date || (perPersonMode && !!financial.error)) && { opacity: 0.5 }]}>
          {saving ? <ActivityIndicator color={'#fff'} /> : <Text style={s.saveBtnText}>{isNew ? "Utwórz imprezę" : "Zapisz zmiany"}</Text>}
        </Pressable>
      </View>

      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setPickerOpen(false)} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={s.grip} />
          <Text style={s.sheetTitle}>Wybierz pracownika</Text>
          <ScrollView>
            {availStaff.map(st => {
              const decl = availByStaff[st.id];
              const blockedAllDay = decl?.status === "unavailable" && decl?.all_day !== false;
              const blockedPartial = decl?.status === "unavailable" && decl?.all_day === false;
              const pill = !decl
                ? { txt: "⚪ Brak deklaracji", bg: v2.color.cardMuted, fg: v2.color.textMuted }
                : decl.status === "available"
                  ? { txt: decl.all_day === false ? `🟢 Dostępny ${decl.time_from}–${decl.time_to}` : "🟢 Dostępny", bg: v2.color.successBg, fg: v2.color.success }
                  : { txt: decl.all_day === false ? `🔴 Niedostępny ${decl.time_from}–${decl.time_to}` : "🔴 Niedostępny (cały dzień)", bg: v2.color.errorBg, fg: v2.color.error };
              return (
                <Pressable
                  key={st.id}
                  testID={`picker-staff-${st.id}`}
                  style={[s.pickerRow, blockedAllDay && { opacity: 0.45 }]}
                  onPress={() => {
                    if (blockedAllDay) {
                      Alert.alert(
                        "Pracownik niedostępny",
                        `${st.name} zgłosił(a) brak dostępności w tym dniu (cały dzień).${decl?.note ? `\n„${decl.note}”` : ""}\n\nNie można przypisać do imprezy.`
                      );
                      return;
                    }
                    if (blockedPartial) {
                      Alert.alert(
                        "Częściowa niedostępność",
                        `${st.name} zgłosił(a) brak dostępności w godz. ${decl.time_from}–${decl.time_to}.${decl?.note ? `\n„${decl.note}”` : ""}\n\nMożesz przypisać tylko poza tymi godzinami — zapis zostanie zablokowany, jeśli zmiana nachodzi na te godziny.`,
                        [
                          { text: "Anuluj", style: "cancel" },
                          { text: "Dodaj mimo to", onPress: () => addStaff(st.id) },
                        ]
                      );
                      return;
                    }
                    addStaff(st.id);
                  }}
                >
                  <View style={s.avatar}><Text style={s.avatarText}>{initials(st.name)}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.shiftName}>{st.name}</Text>
                    <Text style={s.shiftRate}>{st.role || "—"}  ·  {formatPLN(st.hourly_rate)}/godz.</Text>
                    <View style={[s.availPill, { backgroundColor: pill.bg }]}>
                      <Text style={[s.availPillText, { color: pill.fg }]}>{pill.txt}</Text>
                    </View>
                  </View>
                  <Feather name={blockedAllDay ? "slash" : "plus"} size={18} color={blockedAllDay ? v2.color.error : v2.color.forest} />
                </Pressable>
              );
            })}
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
                  <View style={s.avatar}><Feather name="bookmark" size={16} color={v2.color.forest} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.shiftName}>{tpl.name}</Text>
                    <Text style={s.shiftRate}>{tpl.venue || "—"}  ·  {formatPLN(tpl.revenue || 0)}</Text>
                  </View>
                </Pressable>
                <Pressable testID={`tpl-del-${tpl.id}`} onPress={() => deleteTemplate(tpl.id)} hitSlop={10} style={{ padding: 6 }}>
                  <Feather name="trash-2" size={16} color={v2.color.textMuted} />
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
              <View style={s.avatar}><Feather name="x" size={16} color={v2.color.forest} /></View>
              <Text style={[s.shiftName, { flex: 1 }]}>Bez kategorii</Text>
              {!category && <Feather name="check" size={18} color={v2.color.forest} />}
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
                      <View style={s.avatar}><Feather name="tag" size={14} color={v2.color.forest} /></View>
                      <Text style={[s.shiftName, { flex: 1 }]}>{it.label}</Text>
                      {sel && <Feather name="check" size={18} color={v2.color.forest} />}
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
            backgroundColor: v2.color.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
            paddingHorizontal: 20, paddingTop: 12, paddingBottom: insets.bottom + 20,
            borderWidth: 1, borderColor: v2.color.border, maxHeight: "85%",
          }}>
            <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: v2.color.borderStrong, marginBottom: 12 }} />
            <Text style={{ color: v2.color.text, fontSize: 18, fontWeight: "700", marginBottom: 6 }}>Wyślij ofertę klientowi</Text>
            <Text style={{ color: v2.color.textMuted, fontSize: 12, marginBottom: 12 }}>
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
                placeholderTextColor={v2.color.textMuted}
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
                placeholderTextColor={v2.color.textMuted}
                style={s.input}
              />
              <Text style={[s.label, { marginTop: 12 }]}>Powitanie (opcjonalnie)</Text>
              <TextInput
                value={offerGreeting}
                onChangeText={setOfferGreeting}
                placeholder={"Domyślnie: „Dzień dobry " + (offerClient || "Panie/Pani") + ",”\n\nMożesz np. wpisać:\nCześć Aniu, dzięki za spotkanie — poniżej oferta o której mówiliśmy."}
                placeholderTextColor={v2.color.textMuted}
                style={[s.input, { minHeight: 70, textAlignVertical: "top" }]}
                multiline
              />
              <Text style={[s.label, { marginTop: 12 }]}>Uwagi w mailu</Text>
              <TextInput
                testID="event-offer-email-note"
                value={offerNote}
                onChangeText={setOfferNote}
                placeholder="Dodatkowe informacje..."
                placeholderTextColor={v2.color.textMuted}
                style={[s.input, { minHeight: 80, textAlignVertical: "top" }]}
                multiline
              />
              <Pressable
                onPress={previewOfferPdf}
                disabled={offerPreviewing}
                style={{
                  marginTop: 12, borderRadius: 12, paddingVertical: 13, borderWidth: 1, borderColor: v2.color.forest,
                  backgroundColor: v2.color.forest + "12",
                  flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                  opacity: offerPreviewing ? 0.5 : 1,
                }}
              >
                {offerPreviewing ? (
                  <ActivityIndicator color={v2.color.forest} />
                ) : (
                  <>
                    <Feather name="eye" size={16} color={v2.color.forest} />
                    <Text style={{ color: v2.color.forest, fontWeight: "800", fontSize: 14 }}>Zobacz podgląd PDF</Text>
                  </>
                )}
              </Pressable>
              <Pressable
                testID="event-offer-send-btn"
                onPress={sendOfferForEvent}
                disabled={offerSending || !offerTo.trim()}
                style={{
                  marginTop: 10, backgroundColor: v2.color.forest, borderRadius: 12, paddingVertical: 15,
                  flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                  opacity: (offerSending || !offerTo.trim()) ? 0.5 : 1,
                }}
              >
                {offerSending ? (
                  <ActivityIndicator color={'#fff'} />
                ) : (
                  <>
                    <Feather name="send" size={16} color={'#fff'} />
                    <Text style={{ color: '#fff', fontWeight: "800", fontSize: 15 }}>Wyślij ofertę PDF</Text>
                  </>
                )}
              </Pressable>
              <Text style={{ color: v2.color.textMuted, fontSize: 11, textAlign: "center", marginTop: 10, fontStyle: "italic" }}>
                Wysyłamy z: biesiadapodlasem@gmail.com
              </Text>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Summary Email Modal (AI-generated confirmation) */}
      <Modal visible={summaryOpen} transparent animationType="slide" onRequestClose={() => setSummaryOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }} onPress={() => setSummaryOpen(false)} />
          <View style={{
            backgroundColor: v2.color.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
            paddingHorizontal: 20, paddingTop: 12, paddingBottom: insets.bottom + 20,
            borderWidth: 1, borderColor: v2.color.border, maxHeight: "88%",
          }}>
            <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: v2.color.borderStrong, marginBottom: 12 }} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <View style={{ width: 32, height: 32, borderRadius: 999, backgroundColor: v2.color.forest, alignItems: "center", justifyContent: "center" }}>
                <Feather name="file-text" size={16} color="#fff" />
              </View>
              <Text style={s.sheetTitle}>Podsumowanie dla klienta ✉️</Text>
            </View>
            <Text style={{ color: v2.color.textMuted, fontSize: 12, marginBottom: 12 }}>
              AI wygeneruje potwierdzenie szczegółów — możesz je edytować przed wysyłką.
            </Text>

            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 480 }}>
              <Text style={s.label}>Adres e-mail klienta</Text>
              <TextInput
                testID="summary-to-input"
                value={summaryTo}
                onChangeText={setSummaryTo}
                placeholder="klient@example.com"
                placeholderTextColor={v2.color.textSubtle}
                keyboardType="email-address"
                autoCapitalize="none"
                style={s.input}
              />

              <Text style={[s.label, { marginTop: 10 }]}>Imię klienta (opcjonalnie)</Text>
              <TextInput
                value={summaryClient}
                onChangeText={setSummaryClient}
                placeholder="np. Anna Kowalska"
                placeholderTextColor={v2.color.textSubtle}
                style={s.input}
              />

              <Text style={[s.label, { marginTop: 10 }]}>Temat</Text>
              <TextInput
                value={summarySubject}
                onChangeText={setSummarySubject}
                placeholder="Podsumowanie szczegółów imprezy"
                placeholderTextColor={v2.color.textSubtle}
                style={s.input}
              />

              <Text style={[s.label, { marginTop: 10 }]}>
                Treść{summaryLoading ? " — AI generuje…" : ""}
              </Text>
              {summaryLoading ? (
                <View style={{ padding: 20, alignItems: "center", backgroundColor: v2.color.bg, borderRadius: v2.radius.md, borderWidth: 1, borderColor: v2.color.border }}>
                  <ActivityIndicator color={v2.color.forest} />
                  <Text style={{ color: v2.color.textMuted, marginTop: 8, fontSize: 12 }}>AI analizuje szczegóły imprezy…</Text>
                </View>
              ) : (
                <TextInput
                  testID="summary-body-input"
                  value={summaryText}
                  onChangeText={setSummaryText}
                  multiline
                  style={[s.input, { minHeight: 200 }]}
                  textAlignVertical="top"
                />
              )}
            </ScrollView>

            <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
              <Pressable
                onPress={() => setSummaryOpen(false)}
                style={{ flex: 1, paddingVertical: 13, alignItems: "center", borderRadius: v2.radius.md, borderWidth: 1, borderColor: v2.color.borderStrong, backgroundColor: v2.color.card }}>
                <Text style={{ color: v2.color.text, fontWeight: "800" }}>Anuluj</Text>
              </Pressable>
              <Pressable
                testID="summary-send-btn"
                onPress={sendSummaryEmail}
                disabled={summarySending || summaryLoading || !summaryTo || summaryText.trim().length < 20}
                style={[s.saveBtn, { flex: 2, opacity: (summarySending || summaryLoading || !summaryTo || summaryText.trim().length < 20) ? 0.5 : 1 }]}>
                {summarySending ? <ActivityIndicator color="#fff" /> : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Feather name="send" size={14} color="#fff" />
                    <Text style={s.saveBtnText}>Wyślij podsumowanie</Text>
                  </View>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Catering Order Modal (Yubari) */}
      <Modal visible={cateringOpen} transparent animationType="slide" onRequestClose={() => setCateringOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={() => setCateringOpen(false)} />
          <View style={{
            backgroundColor: v2.color.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
            paddingHorizontal: 20, paddingTop: 12, paddingBottom: insets.bottom + 20,
            borderWidth: 1, borderColor: v2.color.border, maxHeight: "85%",
          }}>
            <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: v2.color.borderStrong, marginBottom: 12 }} />
            <Text style={{ color: v2.color.text, fontSize: 18, fontWeight: "700", marginBottom: 4 }}>Zamówienie do cateringu</Text>
            <Text style={{ color: v2.color.textMuted, fontSize: 12, marginBottom: 12 }}>
              Impreza: <Text style={{ fontWeight: "700" }}>{name || "?"}</Text>
              {date ? ` · ${date}` : ""}
              {timeStart ? ` · godz. ${timeStart}` : ""}
              {peopleNum ? ` · ${peopleNum} os.` : ""}
            </Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={s.label}>Adres e-mail cateringu</Text>
              <TextInput
                value={cateringTo}
                onChangeText={setCateringTo}
                placeholder="yubari.restauracja@gmail.com"
                placeholderTextColor={v2.color.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                style={s.input}
              />
              <Text style={[s.label, { marginTop: 10 }]}>Godzina odbioru (HH:MM)</Text>
              <TextInput
                value={cateringPickup}
                onChangeText={setCateringPickup}
                placeholder="np. 14:30"
                placeholderTextColor={v2.color.textMuted}
                style={s.input}
              />
              <Text style={[s.label, { marginTop: 10 }]}>Wstęp (powitanie)</Text>
              <TextInput
                value={cateringGreeting}
                onChangeText={setCateringGreeting}
                placeholder="Cześć Lorena, poniżej wysyłam zamówienie."
                placeholderTextColor={v2.color.textMuted}
                multiline
                numberOfLines={2}
                style={[s.input, { minHeight: 50 }]}
              />
              <Text style={[s.label, { marginTop: 10 }]}>Uwagi (opcjonalnie)</Text>
              <TextInput
                value={cateringNotes}
                onChangeText={setCateringNotes}
                placeholder="np. alergie, preferencje"
                placeholderTextColor={v2.color.textMuted}
                multiline
                numberOfLines={3}
                style={[s.input, { minHeight: 60 }]}
              />
              {/* Podgląd zawartości zamówienia */}
              <View style={{ marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: v2.color.bg, borderWidth: 1, borderColor: v2.color.divider }}>
                <Text style={{ color: v2.color.textMuted, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", fontWeight: "700", marginBottom: 6 }}>Zamawiam:</Text>
                {DINNER_SECTIONS.map(sec => {
                  const items = DINNER_MENU.filter(m => m.section === sec.id && (dinnerQty[m.id] || 0) > 0);
                  if (items.length === 0) return null;
                  return (
                    <View key={sec.id} style={{ marginBottom: 6 }}>
                      <Text style={{ color: v2.color.forest, fontSize: 11, fontWeight: "700", marginBottom: 2 }}>{sec.title}</Text>
                      {items.map(it => (
                        <Text key={it.id} style={{ color: v2.color.text, fontSize: 12, marginLeft: 6 }}>• {it.name} — {dinnerQty[it.id]} porcji</Text>
                      ))}
                    </View>
                  );
                })}
              </View>
              <Pressable
                onPress={sendCateringForEvent}
                disabled={cateringSending}
                style={{
                  marginTop: 14, borderRadius: 14, backgroundColor: v2.color.forest,
                  paddingVertical: 14, alignItems: "center", justifyContent: "center",
                  opacity: cateringSending ? 0.5 : 1,
                }}
              >
                {cateringSending ? (
                  <ActivityIndicator color={'#fff'} />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: "800", fontSize: 15 }}>Wyślij zamówienie</Text>
                )}
              </Pressable>
              <Text style={{ color: v2.color.textMuted, fontSize: 11, textAlign: "center", marginTop: 10, fontStyle: "italic" }}>
                Wysyłamy z: biesiadapodlasem@gmail.com
              </Text>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ManualDiscountModal
        visible={manualCodeOpen}
        onClose={() => setManualCodeOpen(false)}
        initialClientName={clientName}
        initialClientEmail={clientEmail}
        onCreated={async (code) => {
          // Refresh active discounts so the "Zastosuj" button appears
          try {
            const r: any = await api.discountsForClient(clientEmail || code?.client_email || "");
            setClientDiscounts(r?.active || []);
          } catch {}
        }}
      />
    </View>
  );
}

function Section({ title, children }: any) {
  return (
    <View style={s.section}>
      {title ? <Text style={s.sectionTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}
function Collapse({ title, icon, defaultOpen = false, children, testID }: any) {
  const [open, setOpen] = useState(!!defaultOpen);
  if (testID !== "sec-organizacja") return (
    <View style={[s.collapseWrap, testID === "sec-dane" && { borderWidth: 2, borderColor: v2.color.forest }]} testID={testID}>
      <Text style={s.collapseTitle}>{title}</Text>
      <View style={{ marginTop: 10 }}>{children}</View>
    </View>
  );
  return (
    <View style={s.collapseWrap}>
      <Pressable onPress={() => setOpen((o: boolean) => !o)} style={s.collapseHead} testID={testID}>
        <View style={s.collapseIconBox}>
          <Feather name={icon || "folder"} size={15} color={v2.color.forest} />
        </View>
        <Text style={s.collapseTitle}>{title}</Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={18} color={v2.color.textMuted} />
      </Pressable>
      {open ? <View style={{ marginTop: 10 }}>{children}</View> : null}
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
function PreEmailRow({ label, value, testID }: { label: string; value: string; testID: string }) {
  return (
    <View style={s.preEmailRow} testID={testID}>
      <Text style={s.preEmailLabel}>{label}</Text>
      <Text style={s.preEmailValue}>{value}</Text>
    </View>
  );
}
function SummaryRow({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  const isProfit = bold;
  const color = isProfit ? (value >= 0 ? v2.color.forest : v2.color.error) : (value < 0 ? v2.color.error : v2.color.text);
  return (
    <View style={s.sumRow}>
      <Text style={[s.sumLabel, bold && { color: v2.color.text, fontWeight: "700", fontSize: 16 }]}>{label}</Text>
      <Text style={[s.sumVal, { color }, bold && { fontSize: 20, fontWeight: "800" }]}>{formatPLN(value)}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  maskHint: { fontSize: 14, lineHeight: 21, color: v2.color.textMuted, marginVertical: 8 },
  maskLink: { fontSize: 16, fontWeight: "700", color: v2.color.forest, paddingVertical: 12 },
  maskNotice: { padding: 14, backgroundColor: v2.color.cardMuted, borderRadius: 12, marginBottom: 12 },
  maskError: { fontSize: 14, lineHeight: 21, color: v2.color.error, paddingVertical: 8 },
  maskTotals: { paddingVertical: 12, gap: 6 },
  summaryTiles: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  summaryTile: { flexBasis: "47%", flexGrow: 1, padding: 12, gap: 5, borderRadius: 14, backgroundColor: v2.color.cardMuted },
  root: { flex: 1, backgroundColor: v2.color.bg },
  header: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 14,
    backgroundColor: v2.color.forestDeep, gap: 6,
  },
  headerBrand: { color: v2.color.moss, letterSpacing: 3, fontSize: 10, fontWeight: "800" },
  headerTitle: { color: "#fff", fontSize: 15, fontWeight: "800", marginTop: 2, maxWidth: 220 },
  backBtn: { width: 36, height: 36, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  section: {
    backgroundColor: v2.color.card, borderRadius: v2.radius.xl, padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: v2.color.border, ...v2.shadow.sm,
  },
  sectionTitle: { color: v2.color.forest, fontSize: 11, letterSpacing: 2, fontWeight: "800", marginBottom: 12, textTransform: "uppercase" },
  label: { color: v2.color.textSubtle, fontSize: 10, letterSpacing: 0.5, marginBottom: 6, fontWeight: "700", textTransform: "uppercase" },
  input: {
    backgroundColor: v2.color.bg, borderRadius: v2.radius.md, color: v2.color.text,
    paddingHorizontal: 12, paddingVertical: 12, fontSize: 15, borderWidth: 1, borderColor: v2.color.border,
  },
  costRow: { flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 8 },
  iconBtn: { width: 36, height: 36, borderRadius: 999, backgroundColor: v2.color.cardMuted, alignItems: "center", justifyContent: "center" },
  addRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderWidth: 1, borderColor: v2.color.forest, borderRadius: v2.radius.md, borderStyle: "dashed", marginTop: 4 },
  addRowText: { color: v2.color.forest, fontWeight: "700" },
  hint: { color: v2.color.textMuted, fontSize: 13, textAlign: "center", padding: 12 },
  preEmailCard: {},
  preEmailRow: { minHeight: 44, paddingVertical: 10, marginBottom: 2, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: v2.color.divider },
  preEmailLabel: { flex: 1, color: v2.color.textMuted, fontSize: 12, fontWeight: "600" },
  preEmailValue: { flex: 1.3, color: v2.color.text, fontSize: 13, fontWeight: "800", textAlign: "right" },
  preEmailNotice: { marginTop: 12, padding: 12, borderRadius: 12, flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: v2.color.errorBg, borderWidth: 1, borderColor: v2.color.error + "55" },
  preEmailAttachments: { marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: v2.color.cardMuted, borderWidth: 1, borderColor: v2.color.border },
  preEmailAttachmentsTitle: { color: v2.color.text, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 },
  preEmailAttachmentRow: { minHeight: 30, flexDirection: "row", alignItems: "center", gap: 8 },
  preEmailAttachmentText: { flex: 1, color: v2.color.text, fontSize: 13, fontWeight: "700" },
  preEmailNoticeText: { flex: 1, color: v2.color.error, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  preEmailError: { marginTop: 10, color: v2.color.error, fontSize: 12, lineHeight: 17 },
  preEmailActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  preEmailSecondaryButton: { flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: v2.color.forest + "55", backgroundColor: v2.color.card, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, paddingHorizontal: 8 },
  preEmailSecondaryText: { color: v2.color.forest, fontSize: 11, fontWeight: "800", textAlign: "center" },
  preEmailPrimaryButton: { flex: 1, minHeight: 48, borderRadius: 12, backgroundColor: v2.color.forest, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, paddingHorizontal: 8 },
  preEmailPrimaryText: { color: "#fff", fontSize: 12, fontWeight: "800", textAlign: "center" },
  shiftRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  avatar: { width: 38, height: 38, borderRadius: 999, backgroundColor: v2.color.mint, alignItems: "center", justifyContent: "center" },
  avatarText: { color: v2.color.forest, fontWeight: "700", fontSize: 12 },
  shiftName: { color: v2.color.text, fontWeight: "700", fontSize: 14 },
  shiftRate: { color: v2.color.textMuted, fontSize: 12, marginTop: 2 },
  hoursInput: { width: 70, backgroundColor: v2.color.bg, borderRadius: v2.radius.sm, color: v2.color.text, paddingHorizontal: 10, paddingVertical: 10, fontSize: 14, textAlign: "center", borderWidth: 1, borderColor: v2.color.border },
  shiftBlock: {
    backgroundColor: v2.color.cardMuted, borderRadius: v2.radius.md, padding: 12, marginBottom: 10,
    borderWidth: 1, borderColor: v2.color.border,
  },
  shiftTimeRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  timeInput: {
    backgroundColor: v2.color.card, borderRadius: v2.radius.sm, color: v2.color.text,
    paddingHorizontal: 10, paddingVertical: 10, fontSize: 14, borderWidth: 1, borderColor: v2.color.border,
    textAlign: "center",
  },
  miniLabel: { color: v2.color.textSubtle, fontSize: 10, letterSpacing: 0.5, marginBottom: 4, fontWeight: "700" },
  shiftHoursBadge: {
    color: v2.color.forest, fontWeight: "800", fontSize: 14,
    borderWidth: 1, borderColor: v2.color.forest, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: v2.color.mint,
  },
  pricingCard: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: v2.color.mint,
    borderWidth: 1, borderColor: v2.color.forest,
    borderRadius: v2.radius.md, padding: 12, marginTop: 4,
  },
  pricingBreakdown: { color: v2.color.text, fontSize: 12, fontWeight: "700" },
  pricingHint: { color: v2.color.textMuted, fontSize: 11, marginTop: 2 },
  pricingApply: {
    backgroundColor: v2.color.forest, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
  },
  pricingApplyText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  zestawRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  zestawBtn: {
    flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: v2.radius.md,
    borderWidth: 1, borderColor: v2.color.border, backgroundColor: v2.color.cardMuted,
  },
  zestawBtnActive: { backgroundColor: v2.color.forest, borderColor: v2.color.forest },
  zestawName: { color: v2.color.text, fontSize: 12, fontWeight: "800" },
  zestawPrice: { color: v2.color.forest, fontSize: 13, fontWeight: "800", marginTop: 2 },
  zestawDetails: {
    marginTop: 10, padding: 12, borderRadius: v2.radius.md,
    backgroundColor: v2.color.mint, borderWidth: 1, borderColor: v2.color.forest,
  },
  zestawDetailsTitle: { color: v2.color.forest, fontSize: 11, letterSpacing: 1, fontWeight: "800", marginBottom: 4 },
  zestawItem: { color: v2.color.text, fontSize: 12, marginBottom: 2 },
  extraRow: {
    flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: v2.color.divider,
  },
  extraName: { color: v2.color.text, fontSize: 13, fontWeight: "700" },
  extraHint: { color: v2.color.textMuted, fontSize: 11, marginTop: 2 },
  extraQtyInput: {
    width: 60, backgroundColor: v2.color.bg, borderRadius: v2.radius.sm,
    color: v2.color.text, paddingHorizontal: 8, paddingVertical: 8, fontSize: 13,
    textAlign: "center", borderWidth: 1, borderColor: v2.color.border,
  },
  extraLine: { color: v2.color.forest, fontSize: 13, fontWeight: "800", width: 62, textAlign: "right" },
  summary: { backgroundColor: v2.color.forestDeep, borderRadius: v2.radius.xl, padding: 16, borderWidth: 1, borderColor: v2.color.forest, ...v2.shadow.md },
  sumRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  sumLabel: { color: v2.color.sage, fontSize: 13 },
  sumVal: { fontSize: 14, fontWeight: "700", color: "#fff" },
  sep: { height: 1, backgroundColor: "rgba(255,255,255,0.12)", marginVertical: 8 },
  footer: {
    position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: v2.color.card,
    padding: 16, borderTopWidth: 1, borderTopColor: v2.color.border, ...v2.shadow.md,
  },
  saveBtn: { backgroundColor: v2.color.forest, borderRadius: v2.radius.md, paddingVertical: 15, alignItems: "center" },
  saveBtnText: { color: "#fff", fontWeight: "800", fontSize: 15, letterSpacing: 0.5 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { backgroundColor: v2.color.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 12, maxHeight: "70%", borderWidth: 1, borderColor: v2.color.border },
  grip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: v2.color.borderStrong, marginBottom: 12 },
  sheetTitle: { color: v2.color.text, fontSize: 18, fontWeight: "800", marginBottom: 12 },
  pickerRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: v2.color.divider },
  availPill: { alignSelf: "flex-start", marginTop: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  availPillText: { fontSize: 10, fontWeight: "800" },
  availWarn: {
    flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8,
    padding: 8, borderRadius: 8, backgroundColor: v2.color.errorBg,
    borderWidth: 1, borderColor: v2.color.error + "44",
  },
  availWarnText: { flex: 1, color: v2.color.error, fontSize: 11, fontWeight: "700" },
  pdfRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  // Collapsible sections + compact summary (UX reorg)
  collapseWrap: { marginBottom: 12 },
  collapseHead: {
    flexDirection: "row", alignItems: "center", gap: 10, padding: 14,
    borderRadius: v2.radius.lg, backgroundColor: v2.color.card,
    borderWidth: 1, borderColor: v2.color.border, ...v2.shadow.sm,
  },
  collapseIconBox: { width: 30, height: 30, borderRadius: 8, backgroundColor: v2.color.mint, alignItems: "center", justifyContent: "center" },
  collapseTitle: { flex: 1, color: v2.color.text, fontSize: 14, fontWeight: "800" },
  compactCard: {
    backgroundColor: v2.color.card, borderRadius: v2.radius.xl, padding: 14, marginBottom: 14,
    borderWidth: 1, borderColor: v2.color.border, ...v2.shadow.sm,
  },
  compactRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  compactText: { color: v2.color.text, fontSize: 13, fontWeight: "700", flexShrink: 1 },
  compactKpiRow: { flexDirection: "row", gap: 6, marginTop: 12 },
  compactKpi: { flex: 1, backgroundColor: v2.color.bg, borderRadius: 10, padding: 8, borderWidth: 1, borderColor: v2.color.divider },
  compactKpiLabel: { color: v2.color.textSubtle, fontSize: 8.5, fontWeight: "800", letterSpacing: 0.4 },
  compactKpiVal: { color: v2.color.text, fontSize: 13, fontWeight: "800", marginTop: 2 },
  compactPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  compactPillText: { fontSize: 11, fontWeight: "800" },
  imageBox: {
    height: 160, borderRadius: v2.radius.xl, backgroundColor: v2.color.cardMuted,
    overflow: "hidden", marginBottom: 14, borderWidth: 1, borderColor: v2.color.border,
  },
  imagePlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  imagePlaceholderText: { color: v2.color.text, fontWeight: "800", marginTop: 4 },
  imagePlaceholderSub: { color: v2.color.textMuted, fontSize: 12 },
  imageEditRow: { position: "absolute", left: 12, right: 12, bottom: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  imageBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: v2.color.forest, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  imageBadgeText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  imageRemoveBtn: { width: 32, height: 32, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  tplLoadBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 12, marginBottom: 14, borderRadius: v2.radius.md, borderWidth: 1,
    borderColor: v2.color.forest, backgroundColor: v2.color.mint,
  },
  tplLoadText: { color: v2.color.forest, fontWeight: "800", fontSize: 14 },
  tplSaveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 12, marginTop: 14, borderRadius: v2.radius.md, borderWidth: 1,
    borderColor: v2.color.forest,
  },
  groupHeader: {
    color: v2.color.forest, fontSize: 11, letterSpacing: 2, fontWeight: "800",
    marginTop: 4, marginBottom: 4, paddingHorizontal: 4, textTransform: "uppercase",
  },
  checklistLink: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, marginTop: 14, borderRadius: v2.radius.lg,
    borderWidth: 1, borderColor: v2.color.forest + "44",
    backgroundColor: v2.color.mint,
  },
  checklistIconBox: {
    width: 42, height: 42, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
    backgroundColor: v2.color.forest + "20",
  },
  checklistLabel: { color: v2.color.text, fontSize: 15, fontWeight: "800" },
  checklistSub: { color: v2.color.textMuted, fontSize: 11, marginTop: 2 },
  financeBanner: {
    padding: 12, marginBottom: 14, borderRadius: v2.radius.md,
    backgroundColor: v2.color.warningBg, borderLeftWidth: 4, borderLeftColor: v2.color.warning,
  },
  financeBannerTitle: { color: v2.color.warning, fontSize: 12, fontWeight: "800", letterSpacing: 0.3 },
  financeBannerNotes: { color: v2.color.text, fontSize: 12, marginTop: 6, lineHeight: 17 },
  estPill: { backgroundColor: v2.color.warning, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  estPillText: { color: "#fff", fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
});

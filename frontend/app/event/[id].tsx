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
    if (autoPrice && (pricing || extrasTotal > 0)) {
      setRevenue(String(combinedTotal));
      // Also propose it as the "Całkowita cena imprezy" if empty
      setPriceTotal(prev => (!prev || prev === "0" || prev === String(revenueNum)) ? String(combinedTotal) : prev);
    }
  }, [combinedTotal, autoPrice]);

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

  const save = async () => {
    if (!name.trim() || !date) return;
    // Detect transition to "zakonczona" for EXISTING events → show thanks confirm
    const isTransitionToCompleted = !isNew && status === "zakonczona" && prevStatus !== "zakonczona";
    if (isTransitionToCompleted) {
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
      venue: "Biesiada pod lasem",
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
        role: sh.role || "",
        note: sh.note || "",
      })),
      image_url: imageUrl,
    };
    try {
      if (isNew) await api.createEvent(body);
      else await api.updateEvent(id as string, body);
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
    if (isNew) return;
    Alert.alert(
      "Usunąć imprezę?",
      `Ta operacja jest nieodwracalna.\n\n${name || "Impreza"}${date ? "\n" + date : ""}\n\nCzy na pewno chcesz usunąć?`,
      [
        { text: "Anuluj", style: "cancel" },
        {
          text: "Usuń",
          style: "destructive",
          onPress: async () => {
            try {
              await api.deleteEvent(id as string);
              router.back();
            } catch (e: any) {
              Alert.alert("Błąd", e?.message || "Nie udało się usunąć imprezy.");
            }
          },
        },
      ],
    );
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
    event_type: "okolicznosciowe" as const,
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
      else if (category.startsWith("dzieci/wycieczki")) eventType = "warsztaty";
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
          {!isNew ? (
            <Pressable testID="event-send-summary-btn" onPress={openSummaryModal} hitSlop={12} style={s.backBtn}>
              <Feather name="file-text" size={17} color="#fff" />
            </Pressable>
          ) : null}
          {(isAdult || category.startsWith("dzieci/urodzinki") || category.startsWith("dzieci/wycieczki") || category === "dzieci/wycieczki_rodzice") ? (
            <Pressable testID="event-send-offer-btn" onPress={openOfferModal} hitSlop={12} style={s.backBtn}>
              <Feather name="mail" size={18} color="#fff" />
            </Pressable>
          ) : null}
          {!isNew ? (
            <Pressable testID="event-delete-btn" onPress={remove} hitSlop={12} style={[s.backBtn, { backgroundColor: "rgba(220,38,38,0.35)" }]}>
              <Feather name="trash-2" size={18} color="#fff" />
            </Pressable>
          ) : <View style={{ width: 36 }} />}
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 160 }} keyboardShouldPersistTaps="handled">
          {/* Finance import banner */}
          {financeMeta?.import_batch_id ? (
            <View style={s.financeBanner}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Feather name="info" size={14} color={v2.color.warning} />
                <Text style={s.financeBannerTitle}>Dane finansowe zaimportowane</Text>
                {(financeMeta.is_revenue_estimated || financeMeta.is_cost_estimated) ? (
                  <View style={s.estPill}><Text style={s.estPillText}>SZACUNEK</Text></View>
                ) : null}
              </View>
              {!!financeMeta.notes && (
                <Text style={s.financeBannerNotes}>{financeMeta.notes}</Text>
              )}
            </View>
          ) : null}

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
                    <Feather name="camera" size={14} color={'#fff'} />
                    <Text style={s.imageBadgeText}>Zmień zdjęcie</Text>
                  </View>
                  <Pressable testID="event-image-remove" onPress={(e) => { e.stopPropagation?.(); setImageUrl(""); }} hitSlop={10} style={s.imageRemoveBtn}>
                    <Feather name="x" size={16} color={v2.color.text} />
                  </Pressable>
                </View>
              </>
            ) : (
              <View style={s.imagePlaceholder}>
                <Feather name="camera" size={28} color={v2.color.forest} />
                <Text style={s.imagePlaceholderText}>Dodaj zdjęcie imprezy</Text>
                <Text style={s.imagePlaceholderSub}>Galeria lub aparat</Text>
              </View>
            )}
          </Pressable>

          {/* Template chips - shown for new events */}
          {isNew && templates.length > 0 && (
            <Pressable testID="tpl-load-btn" onPress={() => setTplPickerOpen(true)} style={s.tplLoadBtn}>
              <Feather name="copy" size={16} color={v2.color.forest} />
              <Text style={s.tplLoadText}>Wczytaj z szablonu ({templates.length})</Text>
            </Pressable>
          )}

          {/* Info */}
          <Section title="Informacje">
            <Field label="Nazwa">
              <TextInput testID="event-name-input" value={name} onChangeText={setName} placeholder="Wesele Kowalscy" placeholderTextColor={v2.color.textMuted} style={s.input} />
            </Field>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Field label="Data (RRRR-MM-DD)">
                  <TextInput testID="event-date-input" value={date} onChangeText={setDate} placeholder="2026-05-15" placeholderTextColor={v2.color.textMuted} style={s.input} autoCapitalize="none" />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Godzina od">
                  <TextInput testID="event-time-start-input" value={timeStart} onChangeText={setTimeStart} placeholder="18:00" placeholderTextColor={v2.color.textMuted} style={s.input} />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Godzina do">
                  <TextInput testID="event-time-end-input" value={timeEnd} onChangeText={setTimeEnd} placeholder="22:00" placeholderTextColor={v2.color.textMuted} style={s.input} />
                </Field>
              </View>
            </View>
            <Field label="Kategoria">
              <Pressable testID="event-category-btn" onPress={() => setCatPickerOpen(true)} style={[s.input, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}>
                <Text style={{ color: category ? v2.color.text : v2.color.textMuted, fontSize: 15 }}>
                  {category ? categoryLabel(category) : "Wybierz kategorię"}
                </Text>
                <Feather name="chevron-down" size={18} color={v2.color.textMuted} />
              </Pressable>
            </Field>
            <Field label="Notatki">
              <TextInput testID="event-notes-input" value={notes} onChangeText={setNotes} placeholder="Notatki, kontakt do klienta, uwagi..." placeholderTextColor={v2.color.textMuted} style={[s.input, { height: 140, textAlignVertical: "top" }]} multiline />
            </Field>
          </Section>

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
            </View>
          ))}

          {/* Organizacja — widoczne dla obsługi */}
          <Section title="Organizacja — widoczne dla obsługi">
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Field label="Dzieci (liczba)">
                  <TextInput
                    value={org.kids_count != null ? String(org.kids_count) : ""}
                    onChangeText={t => setOrgField("kids_count", t ? parseInt(t.replace(/\D/g, ""), 10) || 0 : null)}
                    placeholder="np. 12" placeholderTextColor={v2.color.textMuted} style={s.input} keyboardType="numeric"
                  />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Dorośli (liczba)">
                  <TextInput
                    value={org.adults_count != null ? String(org.adults_count) : ""}
                    onChangeText={t => setOrgField("adults_count", t ? parseInt(t.replace(/\D/g, ""), 10) || 0 : null)}
                    placeholder="np. 20" placeholderTextColor={v2.color.textMuted} style={s.input} keyboardType="numeric"
                  />
                </Field>
              </View>
            </View>
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

            {/* Thank-you status card — only for existing events that are already completed */}
            {!isNew && status === "zakonczona" && thanksStatus && (
              <View style={{ marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: thanksStatus.sent ? v2.color.successBg : v2.color.warningBg, borderWidth: 1, borderColor: thanksStatus.sent ? v2.color.success + "55" : v2.color.warning + "55" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <Feather name={thanksStatus.sent ? "check-circle" : "alert-circle"} size={14} color={thanksStatus.sent ? v2.color.success : v2.color.warning} />
                  <Text style={{ color: v2.color.text, fontSize: 13, fontWeight: "800" }}>
                    {thanksStatus.sent ? "Wysłano podziękowanie z rabatem" : (thanksStatus.log?.status === "no_email" ? "Nie wysłano — brak e-maila klienta" : (thanksStatus.log?.status === "failed" ? "Błąd wysyłki" : "Podziękowanie niewysłane"))}
                  </Text>
                </View>
                {thanksStatus.sent && thanksStatus.code ? (
                  <>
                    <Text style={{ color: v2.color.textMuted, fontSize: 12 }}>Kod: <Text style={{ fontWeight: "800", color: v2.color.text }}>{thanksStatus.code.code}</Text> · ważny do {thanksStatus.code.expires_at_date}</Text>
                    <Text style={{ color: v2.color.textMuted, fontSize: 11, marginTop: 2 }}>Odbiorca: {thanksStatus.log?.recipient} · {thanksStatus.log?.sent_at ? new Date(thanksStatus.log.sent_at).toLocaleString("pl-PL") : ""}</Text>
                  </>
                ) : null}
                {thanksStatus.log?.status === "failed" ? (
                  <Text style={{ color: v2.color.error, fontSize: 11, marginTop: 2 }}>{thanksStatus.log?.error || ""}</Text>
                ) : null}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                  <Pressable
                    testID="thanks-preview"
                    onPress={async () => {
                      try {
                        const p: any = await api.eventThanksPreview(id as string);
                        Alert.alert(p.subject, p.body);
                      } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
                    }}
                    style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border }}
                  >
                    <Feather name="eye" size={13} color={v2.color.text} />
                    <Text style={{ color: v2.color.text, fontWeight: "800", fontSize: 12 }}>Podgląd</Text>
                  </Pressable>
                  <Pressable
                    testID="thanks-resend"
                    onPress={async () => {
                      Alert.alert(
                        thanksStatus.sent ? "Wysłać ponownie?" : "Wysłać teraz?",
                        thanksStatus.sent ? "Zostanie użyty ten sam kod rabatowy." : "Wyślemy podziękowanie na e-mail klienta.",
                        [
                          { text: "Anuluj", style: "cancel" },
                          { text: "Wyślij", onPress: async () => {
                            try {
                              if (thanksStatus.sent) {
                                await api.eventResendThanks(id as string);
                              } else {
                                await api.eventComplete(id as string, true);
                              }
                              const ts: any = await api.eventThanksStatus(id as string);
                              setThanksStatus(ts);
                              Alert.alert("Wysłano", "Podziękowanie zostało wysłane.");
                            } catch (e: any) { Alert.alert("Błąd", e?.message || "Nie udało się wysłać"); }
                          }},
                        ]
                      );
                    }}
                    style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: v2.color.forest }}
                  >
                    <Feather name="send" size={13} color="#fff" />
                    <Text style={{ color: "#fff", fontWeight: "800", fontSize: 12 }}>{thanksStatus.sent ? "Wyślij ponownie" : "Wyślij teraz"}</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </Section>

          {!isNew && preEventEmail && (
            <Section title="Wiadomość przed imprezą">
              <View testID="pre-event-email-card" style={s.preEmailCard}>
                <PreEmailRow label="Rodzaj imprezy" value={categoryLabel(preEventEmail.event_category)} testID="pre-event-email-category" />
                <PreEmailRow label="Regulamin" value={preEventEmail.regulation_label} testID="pre-event-email-regulation" />
                <PreEmailRow
                  label="Planowana wysyłka"
                  value={preEventEmail.scheduled_at ? new Date(preEventEmail.scheduled_at).toLocaleString("pl-PL") : "—"}
                  testID="pre-event-email-scheduled-at"
                />
                <PreEmailRow label="Adres e-mail" value={preEventEmail.address || "Brak"} testID="pre-event-email-address" />
                <PreEmailRow
                  label="Status"
                  value={({ scheduled: "Oczekuje", sent: "Wysłano", failed: "Błąd", cancelled: "Anulowano", not_scheduled: "Oczekuje" } as Record<string, string>)[preEventEmail.status] || preEventEmail.status}
                  testID="pre-event-email-status"
                />
                <View testID="pre-event-email-attachments" style={s.preEmailAttachments}>
                  <Text style={s.preEmailAttachmentsTitle}>Załączniki</Text>
                  {(preEventEmail.attachments || []).map((attachment: any) => (
                    <View key={attachment.kind} testID={`pre-event-email-attachment-${attachment.kind}`} style={s.preEmailAttachmentRow}>
                      <Feather name="check-circle" size={16} color={v2.color.success} />
                      <Text style={s.preEmailAttachmentText}>{attachment.label}</Text>
                    </View>
                  ))}
                </View>
                {!!preEventEmail.notice && (
                  <View testID="pre-event-email-notice" style={s.preEmailNotice}>
                    <Feather name="alert-circle" size={16} color={v2.color.error} />
                    <Text style={s.preEmailNoticeText}>{preEventEmail.notice}</Text>
                  </View>
                )}
                {!!preEventEmail.error && !preEventEmail.notice && (
                  <Text testID="pre-event-email-error" style={s.preEmailError}>{preEventEmail.error}</Text>
                )}
                <View style={s.preEmailActions}>
                  <Pressable
                    testID="pre-event-email-preview-button"
                    onPress={async () => {
                      try {
                        const preview: any = await api.preEventEmailPreview(id as string);
                        Alert.alert(preview.subject, preview.body);
                      } catch (e: any) { Alert.alert("Błąd", e?.message || "Nie udało się pobrać podglądu."); }
                    }}
                    style={s.preEmailSecondaryButton}
                  >
                    <Feather name="mail" size={14} color={v2.color.forest} />
                    <Text style={s.preEmailSecondaryText}>Podgląd maila</Text>
                  </Pressable>
                  <Pressable
                    testID="pre-event-regulation-preview-button"
                    onPress={previewPreEventRegulation}
                    disabled={preEventEmailBusy || !preEventEmail.regulation_type}
                    style={[s.preEmailSecondaryButton, (!preEventEmail.regulation_type || preEventEmailBusy) && { opacity: 0.5 }]}
                  >
                    <Feather name="file-text" size={14} color={v2.color.forest} />
                    <Text style={s.preEmailSecondaryText}>Podgląd regulaminu</Text>
                  </Pressable>
                </View>
                <View style={s.preEmailActions}>
                  <Pressable
                    testID="pre-event-email-send-now-button"
                    onPress={() => sendPreEventEmail(false)}
                    disabled={preEventEmailBusy || preEventEmail.status === "sent" || status !== "potwierdzona"}
                    style={[s.preEmailPrimaryButton, (preEventEmailBusy || preEventEmail.status === "sent" || status !== "potwierdzona") && { opacity: 0.45 }]}
                  >
                    {preEventEmailBusy ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="send" size={14} color="#fff" />}
                    <Text style={s.preEmailPrimaryText}>Wyślij teraz</Text>
                  </Pressable>
                  <Pressable
                    testID="pre-event-email-resend-button"
                    onPress={() => sendPreEventEmail(true)}
                    disabled={preEventEmailBusy || preEventEmail.status !== "sent" || status !== "potwierdzona"}
                    style={[s.preEmailPrimaryButton, (preEventEmailBusy || preEventEmail.status !== "sent" || status !== "potwierdzona") && { opacity: 0.45 }]}
                  >
                    <Feather name="repeat" size={14} color="#fff" />
                    <Text style={s.preEmailPrimaryText}>Wyślij ponownie</Text>
                  </Pressable>
                </View>
              </View>
            </Section>
          )}

          {/* Client */}
          <Section title="Klient">
            <Field label="Imię i nazwisko / nazwa firmy">
              <TextInput testID="client-name" value={clientName} onChangeText={setClientName}
                placeholder="Jan Kowalski / XYZ Sp. z o.o." placeholderTextColor={v2.color.textMuted} style={s.input} />
            </Field>
            <Field label="Telefon">
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <TextInput testID="client-phone" value={clientPhone} onChangeText={setClientPhone}
                  placeholder="+48 123 456 789" placeholderTextColor={v2.color.textMuted}
                  keyboardType="phone-pad" style={[s.input, { flex: 1 }]} />
                <Pressable
                  testID="client-call"
                  disabled={!clientPhone.trim()}
                  onPress={() => Linking.openURL(`tel:${clientPhone.replace(/\s/g, "")}`)}
                  style={{ padding: 12, borderRadius: 10, backgroundColor: clientPhone.trim() ? v2.color.forest : v2.color.cardMuted }}
                >
                  <Feather name="phone" size={18} color={clientPhone.trim() ? '#fff' : v2.color.textMuted} />
                </Pressable>
                <Pressable
                  testID="client-sms"
                  disabled={!clientPhone.trim()}
                  onPress={() => Linking.openURL(`sms:${clientPhone.replace(/\s/g, "")}`)}
                  style={{ padding: 12, borderRadius: 10, backgroundColor: clientPhone.trim() ? v2.color.forest : v2.color.cardMuted }}
                >
                  <Feather name="message-circle" size={18} color={clientPhone.trim() ? '#fff' : v2.color.textMuted} />
                </Pressable>
              </View>
            </Field>
            <Field label="E-mail">
              <TextInput testID="client-email" value={clientEmail} onChangeText={setClientEmail}
                placeholder="klient@example.com" placeholderTextColor={v2.color.textMuted}
                keyboardType="email-address" autoCapitalize="none" style={s.input} />
            </Field>

            {/* Manual discount code generator — always available if client info is filled */}
            {!!(clientName.trim() || clientEmail.trim()) && clientDiscounts.length === 0 && !appliedDiscount && (
              <Pressable
                testID="manual-discount-btn"
                onPress={() => setManualCodeOpen(true)}
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.forest + "55", marginTop: 6 }}
              >
                <Feather name="gift" size={13} color={v2.color.forest} />
                <Text style={{ color: v2.color.forest, fontWeight: "800", fontSize: 12 }}>Wygeneruj kod rabatowy dla klienta</Text>
              </Pressable>
            )}

            {/* Active discount banner — for NEW event when client has an active code */}
            {isNew && clientDiscounts.length > 0 && !appliedDiscount && (
              <View style={{ marginTop: 6, padding: 12, borderRadius: 12, backgroundColor: v2.color.mint, borderWidth: 1, borderColor: v2.color.forest + "55" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Feather name="tag" size={16} color={v2.color.forest} />
                  <Text style={{ flex: 1, color: v2.color.forest, fontWeight: "800", fontSize: 13 }}>
                    Klient posiada aktywny rabat {clientDiscounts[0].amount_pct || 10}%
                  </Text>
                </View>
                <Text style={{ color: v2.color.textMuted, fontSize: 11, marginTop: 4 }}>
                  Kod {clientDiscounts[0].code} · ważny do {clientDiscounts[0].expires_at_date}
                </Text>
                <Text style={{ color: v2.color.textSubtle, fontSize: 10, marginTop: 2, fontStyle: "italic" }}>
                  💡 Aby zastosować, zapisz najpierw imprezę — potem otwórz ponownie i użyj przycisku „Zastosuj rabat".
                </Text>
              </View>
            )}
            {/* Apply discount button — only for EXISTING event (need event_id) when client has active discount */}
            {!isNew && clientDiscounts.length > 0 && !appliedDiscount && (
              <Pressable
                testID="apply-discount-btn"
                onPress={() => {
                  const d = clientDiscounts[0];
                  Alert.alert(
                    "Zastosować rabat?",
                    `Kod: ${d.code}\nRabat: ${d.amount_pct}% od ceny pakietu\nWażny do: ${d.expires_at_date}\n\nRabat zostanie zapisany w tej imprezie i naliczony od ceny podstawowego pakietu.`,
                    [
                      { text: "Anuluj", style: "cancel" },
                      { text: "Zastosuj", onPress: async () => {
                        try {
                          const r: any = await api.applyDiscount(id as string, d.code);
                          setAppliedDiscount({ code: r.code, amount_zl: r.applied_amount, amount_pct: d.amount_pct });
                          if (r.applied_amount > 0 && priceTotal) {
                            const newTotal = Math.max(0, parseAmt(priceTotal) - r.applied_amount);
                            setPriceTotal(String(newTotal));
                          }
                          setClientDiscounts([]);
                          Alert.alert("Zastosowano", `Rabat ${r.code}: -${r.applied_amount.toFixed(2)} zł`);
                        } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
                      }},
                    ]
                  );
                }}
                style={{ marginTop: 6, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 12, backgroundColor: v2.color.forest }}
              >
                <Feather name="tag" size={14} color="#fff" />
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>
                  Zastosuj rabat {clientDiscounts[0].code} (-{clientDiscounts[0].amount_pct}%)
                </Text>
              </Pressable>
            )}
            {/* Applied discount info */}
            {appliedDiscount && (
              <View style={{ marginTop: 6, padding: 12, borderRadius: 12, backgroundColor: v2.color.successBg, borderWidth: 1, borderColor: v2.color.success + "55" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Feather name="check-circle" size={14} color={v2.color.success} />
                  <Text style={{ flex: 1, color: v2.color.text, fontWeight: "800", fontSize: 13 }}>
                    Zastosowano rabat {appliedDiscount.code}
                  </Text>
                  {!isNew && (
                    <Pressable
                      testID="remove-discount-btn"
                      onPress={() => {
                        Alert.alert("Cofnąć rabat?", "Kod wróci na listę dostępnych, cena zostanie przywrócona.", [
                          { text: "Anuluj", style: "cancel" },
                          { text: "Cofnij", style: "destructive", onPress: async () => {
                            try {
                              await api.removeDiscount(id as string);
                              if (appliedDiscount.amount_zl && priceTotal) {
                                setPriceTotal(String(parseAmt(priceTotal) + appliedDiscount.amount_zl));
                              }
                              setAppliedDiscount(null);
                              // Refresh discounts
                              const r: any = await api.discountsForClient(clientEmail);
                              setClientDiscounts(r?.active || []);
                            } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
                          }},
                        ]);
                      }}
                      hitSlop={10}
                    >
                      <Feather name="x" size={16} color={v2.color.textMuted} />
                    </Pressable>
                  )}
                </View>
                <Text style={{ color: v2.color.textMuted, fontSize: 12, marginTop: 4 }}>
                  Wartość: -{Number(appliedDiscount.amount_zl || 0).toFixed(2)} zł ({appliedDiscount.amount_pct}% od ceny pakietu)
                </Text>
              </View>
            )}

            <Field label="Notatki o kliencie">
              <TextInput testID="client-notes" value={clientNotes} onChangeText={setClientNotes}
                placeholder="Preferencje, historia współpracy..." placeholderTextColor={v2.color.textMuted}
                style={[s.input, { height: 60, textAlignVertical: "top" }]} multiline />
            </Field>
          </Section>

          {/* Payment */}
          <Section title="Płatność">
            {/* Auto forecast — Przewidywane rozliczenie */}
            <View style={{
              marginBottom: 14, padding: 14, borderRadius: 14,
              borderWidth: 1, borderColor: v2.color.forest + "55",
              backgroundColor: v2.color.forest + "0A",
            }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <Feather name="target" size={13} color={v2.color.forest} />
                <Text style={{ color: v2.color.forest, fontSize: 11, fontWeight: "800", letterSpacing: 0.5 }}>
                  PRZEWIDYWANE ROZLICZENIE
                </Text>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
                <Text style={{ color: v2.color.text, fontSize: 12 }}>Wartość / rezerwacja</Text>
                <Text style={{ color: v2.color.success, fontSize: 12, fontWeight: "700" }}>
                  +{discountedValue.toFixed(0)} zł
                </Text>
              </View>
              {cateringCost > 0 && (
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
                  <Text style={{ color: v2.color.text, fontSize: 12 }}>Koszt cateringu (auto)</Text>
                  <Text style={{ color: v2.color.error, fontSize: 12, fontWeight: "700" }}>
                    −{cateringCost.toFixed(0)} zł
                  </Text>
                </View>
              )}
              {grillCost > 0 && (
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
                  <Text style={{ color: v2.color.text, fontSize: 12 }}>
                    Koszt grilla ({grillCostPerPerson} zł × {peopleNum || 0})
                  </Text>
                  <Text style={{ color: v2.color.error, fontSize: 12, fontWeight: "700" }}>
                    −{grillCost.toFixed(0)} zł
                  </Text>
                </View>
              )}
              {beveragesCost > 0 && (
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
                  <Text style={{ color: v2.color.text, fontSize: 12 }}>
                    Napoje (8 zł × {peopleNum || 0})
                  </Text>
                  <Text style={{ color: v2.color.error, fontSize: 12, fontWeight: "700" }}>
                    −{beveragesCost.toFixed(0)} zł
                  </Text>
                </View>
              )}
              {otherPlannedCosts > 0 && (
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
                  <Text style={{ color: v2.color.text, fontSize: 12 }}>Pozostałe koszty</Text>
                  <Text style={{ color: v2.color.error, fontSize: 12, fontWeight: "700" }}>
                    −{otherPlannedCosts.toFixed(0)} zł
                  </Text>
                </View>
              )}
              <View style={{ height: 1, backgroundColor: v2.color.forest + "44", marginVertical: 6 }} />
              <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
                <Text style={{ color: v2.color.text, fontSize: 12, fontWeight: "700" }}>Łączny koszt</Text>
                <Text style={{ color: v2.color.error, fontSize: 13, fontWeight: "800" }}>
                  −{totalPlannedCost.toFixed(0)} zł
                </Text>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
                <Text style={{ color: v2.color.text, fontSize: 13, fontWeight: "800" }}>Przewidywany zysk</Text>
                <Text style={{
                  color: plannedProfit >= 0 ? v2.color.forest : v2.color.error,
                  fontSize: 18, fontWeight: "800",
                }}>
                  {plannedProfit >= 0 ? "+" : ""}{plannedProfit.toFixed(0)} zł
                </Text>
              </View>
              {discountedValue > 0 && (
                <Text style={{ color: v2.color.textMuted, fontSize: 10, marginTop: 4 }}>
                  Marża: {((plannedProfit / discountedValue) * 100).toFixed(1)}%
                </Text>
              )}
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 2 }}>
                <Field label="Całkowita cena imprezy">
                  <TextInput testID="price-total" value={priceTotal} onChangeText={setPriceTotal}
                    placeholder="0" placeholderTextColor={v2.color.textMuted}
                    keyboardType="decimal-pad" style={s.input} />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Rabat %">
                  <TextInput testID="discount-pct" value={discountPct} onChangeText={setDiscountPct}
                    placeholder="0" placeholderTextColor={v2.color.textMuted}
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
                  <View style={{ marginTop: 6, padding: 10, borderRadius: 10, backgroundColor: v2.color.forest + "10", borderWidth: 1, borderColor: v2.color.forest + "44" }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ fontSize: 11, color: v2.color.textMuted, letterSpacing: 0.5 }}>
                        RABAT −{disc.toFixed(0)}% ({discAmt.toFixed(2)} zł)
                      </Text>
                      <Text style={{ fontSize: 16, fontWeight: "800", color: v2.color.forest }}>
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
                      backgroundColor: active ? (o.v ? v2.color.success : v2.color.cardMuted) : v2.color.cardMuted,
                      borderWidth: 1, borderColor: active ? (o.v ? v2.color.success : v2.color.borderStrong) : v2.color.border,
                    }}
                  >
                    <Text style={{ color: active && o.v ? "#022C22" : v2.color.text, fontWeight: "700", fontSize: 13 }}>{o.lbl}</Text>
                  </Pressable>
                );
              })}
            </View>
            {depositPaid && (
              <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                <View style={{ flex: 1 }}>
                  <Field label="Kwota zaliczki">
                    <TextInput testID="deposit-amount" value={depositAmount} onChangeText={setDepositAmount}
                      placeholder="0" placeholderTextColor={v2.color.textMuted}
                      keyboardType="decimal-pad" style={s.input} />
                  </Field>
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="Data wpłaty">
                    <TextInput testID="deposit-date" value={depositDate} onChangeText={setDepositDate}
                      placeholder="YYYY-MM-DD" placeholderTextColor={v2.color.textMuted}
                      style={s.input} />
                  </Field>
                </View>
              </View>
            )}
            {parseAmt(priceTotal) > 0 && (
              <View style={{
                marginTop: 14, padding: 14, borderRadius: 12,
                backgroundColor: v2.color.cardMuted,
                borderWidth: 1, borderColor: v2.color.forest,
              }}>
                <Text style={{ color: v2.color.textMuted, fontSize: 11, letterSpacing: 1 }}>POZOSTAŁO DO ZAPŁATY</Text>
                {(() => {
                  const total = parseAmt(priceTotal);
                  const disc = parseAmt(discountPct);
                  const afterDisc = disc > 0 ? total * (1 - disc / 100) : total;
                  const remaining = afterDisc - (depositPaid ? parseAmt(depositAmount) : 0);
                  return (
                    <Text style={{
                      color: remaining > 0 ? v2.color.forest : v2.color.success,
                      fontSize: 24, fontWeight: "800", marginTop: 4,
                    }}>
                      {remaining.toFixed(2)} zł
                    </Text>
                  );
                })()}
              </View>
            )}
          </Section>

          {/* Wpłaty klienta (Faza 2 v2.0) — historia wpłat */}
          {!isNew && (
            <Section title="Wpłaty klienta">
              <EventPayments eventId={String(id)} priceTotalOverride={parseAmt(priceTotal)} />
              <Text style={{ color: v2.color.textMuted, fontSize: 11, marginTop: 8, fontStyle: "italic" }}>
                💡 Pole „Zaliczka wpłacona" powyżej pozostaje na razie dla kompatybilności — nowe wpłaty rejestruj tutaj.
              </Text>
            </Section>
          )}

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
                backgroundColor: v2.color.cardMuted, borderWidth: 1, borderColor: v2.color.forest,
              }}
            >
              {weatherLoading ? (
                <ActivityIndicator color={v2.color.forest} size="small" />
              ) : (
                <>
                  <Feather name="cloud" size={16} color={v2.color.forest} />
                  <Text style={{ color: v2.color.forest, fontWeight: "700", fontSize: 13 }}>
                    {weather ? "Odśwież prognozę" : "Sprawdź prognozę pogody"}
                  </Text>
                </>
              )}
            </Pressable>
            {weather && !weather.available && (
              <Text style={{ color: v2.color.textMuted, fontSize: 12, marginTop: 10, textAlign: "center", fontStyle: "italic" }}>
                {weather.message || "Prognoza niedostępna"}
              </Text>
            )}
            {weather && weather.available && (
              <View style={{ marginTop: 12, padding: 14, borderRadius: 12, backgroundColor: v2.color.cardMuted, borderWidth: 1, borderColor: v2.color.border }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Feather name={weather.icon || "cloud"} size={40} color={v2.color.forest} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: v2.color.text, fontSize: 18, fontWeight: "800" }}>
                      {weather.temp_min !== null ? `${weather.temp_min}°` : "—"}
                      {" – "}
                      {weather.temp_max !== null ? `${weather.temp_max}°C` : "—"}
                    </Text>
                    <Text style={{ color: v2.color.textMuted, fontSize: 12, marginTop: 2 }}>{`${weather.description || ""} · ${weather.time_window || ""}`}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: "row", gap: 16, marginTop: 12 }}>
                  <View>
                    <Text style={{ color: v2.color.textMuted, fontSize: 10, letterSpacing: 0.5 }}>OPADY</Text>
                    <Text style={{ color: v2.color.text, fontSize: 14, fontWeight: "700" }}>{weather.precipitation_prob}%</Text>
                  </View>
                  <View>
                    <Text style={{ color: v2.color.textMuted, fontSize: 10, letterSpacing: 0.5 }}>WIATR</Text>
                    <Text style={{ color: v2.color.text, fontSize: 14, fontWeight: "700" }}>{weather.wind_kmh} km/h</Text>
                  </View>
                  <View>
                    <Text style={{ color: v2.color.textMuted, fontSize: 10, letterSpacing: 0.5 }}>LOKALIZACJA</Text>
                    <Text style={{ color: v2.color.text, fontSize: 12, fontWeight: "600" }}>Kielce, Zastawie 4</Text>
                  </View>
                </View>
              {!!weather.warning && (
                  <View style={{ marginTop: 10, padding: 10, borderRadius: 8, backgroundColor: "rgba(245,158,11,0.15)", borderWidth: 1, borderColor: v2.color.warning }}>
                    <Text style={{ color: v2.color.warning, fontSize: 12, fontWeight: "700" }}>{weather.warning}</Text>
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
                    placeholderTextColor={v2.color.textMuted}
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
                    placeholderTextColor={v2.color.textMuted}
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
                      <Text style={[s.zestawName, sel && { color: '#fff' }]}>{zs.name}</Text>
                      <Text style={[s.zestawPrice, sel && { color: '#fff' }]}>{zs.price_per_person} zł/os.</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
            {isAdult && !!packageSet && findAdultSet(packageSet) && (
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
                    placeholderTextColor={v2.color.textMuted}
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

            {/* Oferta obiadowa — quick picker with auto-margin (collapsible — not always needed for pricing) */}
            {(() => {
              const dinnerCount = Object.values(dinnerQty).reduce((sum, q) => sum + (Number(q) || 0), 0);
              const dinnerItemsCount = Object.values(dinnerQty).filter(q => (Number(q) || 0) > 0).length;
              return (
                <View style={{ marginTop: 20 }}>
                  <Pressable
                    testID="dinner-toggle"
                    onPress={() => setDinnerExpanded(v => !v)}
                    style={{
                      flexDirection: "row", alignItems: "center", gap: 10,
                      paddingVertical: 12, paddingHorizontal: 14,
                      backgroundColor: dinnerCount > 0 ? v2.color.mint : v2.color.cardMuted,
                      borderRadius: 12,
                      borderWidth: 1, borderColor: dinnerCount > 0 ? v2.color.forest + "44" : v2.color.border,
                    }}
                  >
                    <Feather name="coffee" size={16} color={v2.color.forest} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: v2.color.text, fontSize: 14, fontWeight: "800" }}>
                        Oferta obiadowa {dinnerCount > 0 ? `· ${dinnerItemsCount} poz. · ${dinnerRevenue.toFixed(0)} zł` : "(opcjonalnie)"}
                      </Text>
                      {!dinnerExpanded && dinnerCount === 0 && (
                        <Text style={{ color: v2.color.textMuted, fontSize: 11, marginTop: 2 }}>
                          Kliknij, żeby rozwinąć menu i wybrać porcje
                        </Text>
                      )}
                    </View>
                    <Feather name={dinnerExpanded ? "chevron-up" : "chevron-down"} size={18} color={v2.color.textMuted} />
                  </Pressable>
                </View>
              );
            })()}
            {dinnerExpanded && (
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
            {dinnerExpanded && dinnerRevenue > 0 && (
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
            {dinnerExpanded && Object.values(dinnerQty).some(q => (q || 0) > 0) && !isNew ? (
              <Pressable onPress={openCateringModal} style={{ marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 12, backgroundColor: v2.color.forest + "18", borderWidth: 1, borderColor: v2.color.forest }}>
                <Feather name="send" size={16} color={v2.color.forest} />
                <Text style={{ color: v2.color.forest, fontWeight: "800", fontSize: 13 }}>Wyślij zamówienie do cateringu (Yubari)</Text>
              </Pressable>
            ) : null}
            {costs.map((c, i) => (
              <View key={i} style={s.costRow}>
                <TextInput
                  testID={`cost-label-${i}`}
                  value={c.label}
                  onChangeText={v => setCosts(costs.map((x, ix) => ix === i ? { ...x, label: v } : x))}
                  placeholder="np. Catering"
                  placeholderTextColor={v2.color.textMuted}
                  style={[s.input, { flex: 2 }]}
                />
                <TextInput
                  testID={`cost-amount-${i}`}
                  value={String(c.amount || "")}
                  onChangeText={v => setCosts(costs.map((x, ix) => ix === i ? { ...x, amount: parseAmt(v) } : x))}
                  placeholder="0"
                  placeholderTextColor={v2.color.textMuted}
                  keyboardType="decimal-pad"
                  style={[s.input, { flex: 1 }]}
                />
                <Pressable testID={`cost-del-${i}`} onPress={() => setCosts(costs.filter((_, ix) => ix !== i))} hitSlop={8} style={s.iconBtn}>
                  <Feather name="x" size={16} color={v2.color.textMuted} />
                </Pressable>
              </View>
            ))}
            <Pressable testID="cost-add-btn" onPress={() => setCosts([...costs, { label: "", amount: 0 }])} style={s.addRow}>
              <Feather name="plus" size={16} color={v2.color.forest} />
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
                      <Feather name="x" size={16} color={v2.color.textMuted} />
                    </Pressable>
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
            {availStaff.length > 0 ? (
              <Pressable testID="shift-add-btn" onPress={() => setPickerOpen(true)} style={s.addRow}>
                <Feather name="plus" size={16} color={v2.color.forest} />
                <Text style={s.addRowText}>Dodaj pracownika</Text>
              </Pressable>
            ) : staffAll.length === 0 ? (
              <Text style={s.hint}>Najpierw dodaj pracowników w zakładce Pracownicy</Text>
            ) : null}
          </Section>

          {/* Checklist (Zadania imprezy) — only for saved events */}
          {!isNew && (
            <Pressable
              onPress={() => router.push({ pathname: "/checklist/[id]", params: { id: String(id) } } as any)}
              style={s.checklistLink}
              testID="event-checklist-link"
            >
              <View style={s.checklistIconBox}>
                <Feather name="check-square" size={20} color={v2.color.forest} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.checklistLabel}>Zadania imprezy</Text>
                <Text style={s.checklistSub}>Checklista przygotowań · widoczna dla pracowników</Text>
              </View>
              <Feather name="chevron-right" size={20} color={v2.color.textMuted} />
            </Pressable>
          )}

          {/* Summary */}
          <View style={s.summary}>
            <SummaryRow label="Przychód" value={revenueNum} />
            <SummaryRow label="Koszty materiałowe" value={-materialCost} />
            <SummaryRow label="Koszty pracy" value={-laborCost} />
            <View style={s.sep} />
            <SummaryRow label="Zysk" value={profit} bold />
          </View>

          <Pressable testID="save-as-template-btn" onPress={saveAsTemplate} disabled={!name.trim()} style={[s.tplSaveBtn, !name.trim() && { opacity: 0.5 }]}>
            <Feather name="bookmark" size={16} color={v2.color.forest} />
            <Text style={s.tplLoadText}>Zapisz jako szablon</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable testID="event-save-btn" onPress={save} disabled={saving || !name.trim() || !date} style={[s.saveBtn, (saving || !name.trim() || !date) && { opacity: 0.5 }]}>
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

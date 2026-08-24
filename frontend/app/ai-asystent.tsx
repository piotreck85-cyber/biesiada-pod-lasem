import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform, Alert, Modal,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { v2 } from "@/src/designTokensV2";
import { api } from "@/src/api";
import { formatPLN } from "@/src/theme";

type Tab = "tips" | "offer" | "chat" | "coach";
type Tip = { severity: "error" | "warning" | "info" | "success"; text: string; action?: string };
type ChatMsg = { role: "user" | "assistant"; content: string; created_at?: string; id?: string };

const CHAT_SESSION_KEY = "ai-chat-default";

export default function AiAsystent() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("tips");

  return (
    <View style={{ flex: 1, backgroundColor: v2.color.bg }}>
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={s.iconBtn}>
          <Feather name="chevron-left" size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={s.brand}>ASYSTENT AI · GPT 5.6</Text>
          <Text style={s.title}>Twój AI do Biesiady</Text>
        </View>
        <View style={s.aiDot}>
          <Feather name="cpu" size={16} color={v2.color.moss} />
        </View>
      </View>

      <View style={s.segRow}>
        {([
          ["tips",  "Wskazówki", "zap"],
          ["offer", "Oferty",    "edit-3"],
          ["coach", "Koszty",    "trending-down"],
          ["chat",  "Czat",      "message-circle"],
        ] as const).map(([k, l, icon]) => (
          <Pressable key={k} onPress={() => setTab(k as Tab)} style={[s.seg, tab === k && s.segActive]}>
            <Feather name={icon as any} size={13} color={tab === k ? v2.color.forest : "#fff"} />
            <Text style={[s.segText, tab === k && s.segTextActive]}>{l}</Text>
          </Pressable>
        ))}
      </View>

      {tab === "tips"  && <TipsTab />}
      {tab === "offer" && <OfferTab />}
      {tab === "coach" && <CoachTab />}
      {tab === "chat"  && <ChatTab />}
    </View>
  );
}

/* ---------------- TIPS TAB ---------------- */
function TipsTab() {
  const [loading, setLoading] = useState(false);
  const [tips, setTips] = useState<Tip[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState<number>(14);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r: any = await api.aiAssistantTips(days);
      setTips(Array.isArray(r?.tips) ? r.tips : []);
    } catch (e: any) {
      setErr(String(e?.message || "Nie udało się połączyć z AI"));
    } finally { setLoading(false); }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const tone = (t: string) => ({ error: v2.color.error, warning: v2.color.warning, info: v2.color.info, success: v2.color.success } as any)[t] || v2.color.info;
  const toneBg = (t: string) => ({ error: v2.color.errorBg, warning: v2.color.warningBg, info: v2.color.infoBg, success: v2.color.successBg } as any)[t] || v2.color.infoBg;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <View style={s.hint}>
        <Feather name="info" size={14} color={v2.color.info} />
        <Text style={s.hintText}>AI analizuje Twoje nadchodzące imprezy z najbliższych {days} dni.</Text>
      </View>

      <View style={s.chipRow}>
        {[7, 14, 30].map(d => (
          <Pressable key={d} onPress={() => setDays(d)} style={[s.chip, days === d && s.chipActive]}>
            <Text style={[s.chipText, days === d && s.chipTextActive]}>Najbliższe {d} dni</Text>
          </Pressable>
        ))}
        <Pressable onPress={load} style={s.chipIcon}>
          <Feather name="refresh-cw" size={13} color={v2.color.forest} />
        </Pressable>
      </View>

      {loading && (
        <View style={s.loading}>
          <ActivityIndicator color={v2.color.forest} />
          <Text style={s.loadingText}>AI analizuje Twoje dane…</Text>
        </View>
      )}

      {!loading && err && (
        <View style={[s.emptyBox, { borderColor: v2.color.error }]}>
          <Feather name="alert-triangle" size={24} color={v2.color.error} />
          <Text style={s.emptyTitle}>Błąd</Text>
          <Text style={s.emptyText}>{err}</Text>
          <Pressable style={s.primaryBtn} onPress={load}>
            <Feather name="refresh-cw" size={14} color="#fff" />
            <Text style={s.primaryBtnText}>Spróbuj ponownie</Text>
          </Pressable>
        </View>
      )}

      {!loading && !err && tips.length === 0 && (
        <View style={s.emptyBox}>
          <Feather name="check-circle" size={28} color={v2.color.success} />
          <Text style={s.emptyTitle}>Wszystko pod kontrolą 🟢</Text>
          <Text style={s.emptyText}>AI nie znalazł niczego wymagającego uwagi.</Text>
        </View>
      )}

      {!loading && tips.map((t, i) => (
        <View key={i} style={[s.tipCard, { backgroundColor: toneBg(t.severity), borderLeftColor: tone(t.severity) }]}>
          <View style={[s.tipDot, { backgroundColor: tone(t.severity) }]}>
            <Feather
              name={t.severity === "error" ? "alert-triangle" : t.severity === "warning" ? "clock" : "info"}
              size={12} color="#fff"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.tipText}>{t.text}</Text>
            {!!t.action && <Text style={[s.tipAction, { color: tone(t.severity) }]}>→ {t.action}</Text>}
          </View>
        </View>
      ))}

      {!loading && tips.length > 0 && (
        <Pressable style={s.regenBtn} onPress={load}>
          <Feather name="refresh-cw" size={14} color={v2.color.forest} />
          <Text style={s.regenBtnText}>Wygeneruj ponownie</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

/* ---------------- OFFER TAB ---------------- */
function OfferTab() {
  const [brief, setBrief] = useState("");
  const [tone, setTone] = useState<"profesjonalny" | "ciepły" | "krótki">("profesjonalny");
  const [loading, setLoading] = useState(false);
  const [offer, setOffer] = useState("");
  const [err, setErr] = useState<string | null>(null);
  // Send state
  const [eventKind, setEventKind] = useState<"okolicznosciowa" | "firmowa">("okolicznosciowa");
  const [autoDetected, setAutoDetected] = useState<boolean>(false);
  const [toEmail, setToEmail] = useState("");
  const [clientName, setClientName] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [clients, setClients] = useState<any[]>([]);
  const [clientsQ, setClientsQ] = useState("");
  const [sending, setSending] = useState(false);
  const [subject, setSubject] = useState("");

  const generate = async () => {
    if (brief.trim().length < 5) {
      Alert.alert("Za krótki brief", "Napisz przynajmniej kilka słów o imprezie.");
      return;
    }
    setLoading(true); setErr(null); setOffer("");
    try {
      const r: any = await api.aiGenerateOffer(brief.trim(), tone);
      setOffer(String(r?.offer || ""));
      // Autodetect kind
      try {
        const k: any = await api.aiDetectKind(brief.trim());
        if (k?.event_kind === "firmowa") { setEventKind("firmowa"); setAutoDetected(true); }
        else { setEventKind("okolicznosciowa"); setAutoDetected(true); }
      } catch {}
    } catch (e: any) {
      setErr(String(e?.message || "Błąd AI"));
    } finally { setLoading(false); }
  };

  const copy = async () => {
    if (!offer) return;
    await Clipboard.setStringAsync(offer);
    Alert.alert("Skopiowano", "Tekst oferty jest w schowku.");
  };

  const clear = () => { setBrief(""); setOffer(""); setErr(null); setToEmail(""); setClientName(""); setSubject(""); setAutoDetected(false); };

  const openPicker = async () => {
    setPickerOpen(true);
    try { const r: any = await api.listKnownClients(); setClients(Array.isArray(r) ? r : []); } catch { setClients([]); }
  };
  const searchClients = async (q: string) => {
    setClientsQ(q);
    try { const r: any = await api.listKnownClients(q); setClients(Array.isArray(r) ? r : []); } catch { setClients([]); }
  };
  const pickClient = (c: any) => {
    setToEmail(c.email || "");
    setClientName(c.name || "");
    setPickerOpen(false);
  };

  const send = async () => {
    const email = toEmail.trim();
    if (!email || !email.includes("@")) { Alert.alert("Zły adres", "Podaj poprawny e-mail klienta."); return; }
    if (offer.trim().length < 20) { Alert.alert("Brak treści", "Najpierw wygeneruj ofertę."); return; }
    setSending(true);
    try {
      const r: any = await api.aiSendOfferEmail({
        to_email: email,
        client_name: clientName.trim(),
        subject: subject.trim(),
        body_text: offer.trim(),
        event_kind: eventKind,
        mode: "offer",
      });
      Alert.alert("Wysłano ✅",
        `Oferta poszła na ${email}${r?.attached_pdf ? "\n\n📎 Załączono ofertę cateringową (PDF)" : ""}`
      );
    } catch (e: any) {
      Alert.alert("Nie udało się wysłać", String(e?.message || "Sprawdź konfigurację e-mail"));
    } finally { setSending(false); }
  };

  const willAttachPdf = eventKind === "firmowa";

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={s.fieldLabel}>Brief klienta</Text>
        <TextInput
          value={brief}
          onChangeText={setBrief}
          placeholder="np. Urodziny 30 os., sobota 15.09, ognisko, kiełbaski + sałatki, 5h"
          placeholderTextColor={v2.color.textSubtle}
          style={s.briefInput}
          multiline
          textAlignVertical="top"
        />

        <Text style={[s.fieldLabel, { marginTop: 12 }]}>Ton wypowiedzi</Text>
        <View style={s.chipRow}>
          {(["profesjonalny", "ciepły", "krótki"] as const).map(t => (
            <Pressable key={t} onPress={() => setTone(t)} style={[s.chip, tone === t && s.chipActive]}>
              <Text style={[s.chipText, tone === t && s.chipTextActive]}>{t}</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
          <Pressable onPress={generate} disabled={loading || brief.trim().length < 5}
            style={[s.primaryBtn, { flex: 2, opacity: loading || brief.trim().length < 5 ? 0.6 : 1 }]}>
            {loading ? <ActivityIndicator color="#fff" /> : <Feather name="zap" size={14} color="#fff" />}
            <Text style={s.primaryBtnText}>{loading ? "Generuję…" : "Wygeneruj ofertę"}</Text>
          </Pressable>
          <Pressable onPress={clear} style={s.secBtn}>
            <Feather name="x" size={14} color={v2.color.forest} />
            <Text style={s.secBtnText}>Wyczyść</Text>
          </Pressable>
        </View>

        {err && (
          <View style={[s.emptyBox, { borderColor: v2.color.error, marginTop: 14 }]}>
            <Feather name="alert-triangle" size={24} color={v2.color.error} />
            <Text style={s.emptyText}>{err}</Text>
          </View>
        )}

        {offer.length > 0 && (
          <>
            <View style={s.offerBox}>
              <View style={s.offerHead}>
                <Feather name="file-text" size={16} color={v2.color.forest} />
                <Text style={s.offerTitle}>Gotowy tekst oferty</Text>
                <View style={{ flex: 1 }} />
                <Pressable onPress={copy} style={s.copyBtn}>
                  <Feather name="copy" size={12} color={v2.color.forest} />
                  <Text style={s.copyBtnText}>Kopiuj</Text>
                </Pressable>
              </View>
              <TextInput
                value={offer}
                onChangeText={setOffer}
                multiline
                style={sendS.offerEditable}
                textAlignVertical="top"
              />
            </View>

            {/* SEND SECTION */}
            <View style={sendS.sendCard}>
              <View style={sendS.sendHead}>
                <Feather name="send" size={16} color={v2.color.forest} />
                <Text style={s.offerTitle}>Wyślij do klienta</Text>
              </View>

              <Text style={s.fieldLabel}>Typ imprezy</Text>
              <View style={s.chipRow}>
                {([
                  ["okolicznosciowa", "Okolicznościowa"],
                  ["firmowa",         "Firmowa (wieczorna) 📎"],
                ] as const).map(([k, l]) => (
                  <Pressable key={k} onPress={() => { setEventKind(k as any); setAutoDetected(false); }}
                    style={[s.chip, eventKind === k && s.chipActive]}>
                    <Text style={[s.chipText, eventKind === k && s.chipTextActive]}>{l}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={sendS.hintSmall}>
                {autoDetected && <Text style={{ color: v2.color.info, fontWeight: "800" }}>🤖 AI wykryło z briefu · </Text>}
                {willAttachPdf ? "📎 Do maila zostanie dołączony PDF Oferty Gastronomicznej 2026" : "Wysyłam sam tekst — bez załącznika"}
              </Text>

              <Text style={[s.fieldLabel, { marginTop: 14 }]}>Adres e-mail klienta</Text>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <TextInput
                  value={toEmail}
                  onChangeText={setToEmail}
                  placeholder="klient@example.com"
                  placeholderTextColor={v2.color.textSubtle}
                  style={[sendS.inputRow, { flex: 1 }]}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <Pressable onPress={openPicker} style={sendS.pickBtn}>
                  <Feather name="users" size={14} color={v2.color.forest} />
                </Pressable>
              </View>

              <Text style={[s.fieldLabel, { marginTop: 10 }]}>Imię klienta (opcjonalnie)</Text>
              <TextInput
                value={clientName}
                onChangeText={setClientName}
                placeholder="np. Anna Kowalska"
                placeholderTextColor={v2.color.textSubtle}
                style={sendS.inputRow}
              />

              <Text style={[s.fieldLabel, { marginTop: 10 }]}>Temat (opcjonalnie)</Text>
              <TextInput
                value={subject}
                onChangeText={setSubject}
                placeholder='Domyślnie: „Oferta — Biesiada pod Lasem"'
                placeholderTextColor={v2.color.textSubtle}
                style={sendS.inputRow}
              />

              <Pressable onPress={send} disabled={sending || !toEmail || offer.trim().length < 20}
                style={[s.primaryBtn, { marginTop: 14, opacity: sending || !toEmail || offer.trim().length < 20 ? 0.6 : 1 }]}>
                {sending ? <ActivityIndicator color="#fff" /> : <Feather name="send" size={14} color="#fff" />}
                <Text style={s.primaryBtnText}>{sending ? "Wysyłam…" : "Wyślij e-mail"}</Text>
              </Pressable>
            </View>
          </>
        )}

        {/* Client picker modal */}
        <Modal visible={pickerOpen} animationType="slide" transparent onRequestClose={() => setPickerOpen(false)}>
          <View style={sendS.modalBg}>
            <View style={sendS.modalSheet}>
              <View style={sendS.modalHead}>
                <Text style={s.offerTitle}>Wybierz klienta</Text>
                <Pressable onPress={() => setPickerOpen(false)}>
                  <Feather name="x" size={20} color={v2.color.text} />
                </Pressable>
              </View>
              <TextInput
                value={clientsQ}
                onChangeText={searchClients}
                placeholder="Szukaj po nazwisku / e-mailu…"
                placeholderTextColor={v2.color.textSubtle}
                style={sendS.inputRow}
              />
              <ScrollView style={{ maxHeight: 420, marginTop: 10 }}>
                {clients.length === 0 ? (
                  <Text style={[s.emptyText, { padding: 20 }]}>Brak zapisanych klientów</Text>
                ) : clients.map((c, i) => (
                  <Pressable key={i} onPress={() => pickClient(c)} style={sendS.clientRow}>
                    <View style={sendS.avatar}>
                      <Text style={sendS.avatarText}>{(c.name || c.email || "?")[0]?.toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={sendS.clientName}>{c.name || "Bez nazwy"}</Text>
                      <Text style={sendS.clientMeta}>{c.email || "brak e-mail"} · {c.count || 1} imprez</Text>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* ---------------- COACH TAB (Koszty AI) ---------------- */
function CoachTab() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [month, setMonth] = useState<number>(new Date().getMonth() + 1);
  const [year, setYear] = useState<number>(new Date().getFullYear());

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r: any = await api.aiCostCoach(year, month);
      setData(r);
    } catch (e: any) {
      setErr(String(e?.message || "Nie udało się połączyć z AI"));
    } finally { setLoading(false); }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const MONTHS = ["Styczeń","Luty","Marzec","Kwiecień","Maj","Czerwiec","Lipiec","Sierpień","Wrzesień","Październik","Listopad","Grudzień"];
  const shift = (delta: number) => {
    let m = month + delta; let y = year;
    if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    setMonth(m); setYear(y);
  };

  const impactColor = (imp: string) => imp === "wysoki" ? v2.color.error : imp === "średni" ? v2.color.warning : v2.color.info;
  const impactBg = (imp: string) => imp === "wysoki" ? v2.color.errorBg : imp === "średni" ? v2.color.warningBg : v2.color.infoBg;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <View style={s.hint}>
        <Feather name="trending-down" size={14} color={v2.color.info} />
        <Text style={s.hintText}>AI analizuje Twoje koszty i wskazuje gdzie tracisz pieniądze.</Text>
      </View>

      <View style={[s.chipRow, { justifyContent: "center", alignItems: "center", marginTop: 12 }]}>
        <Pressable onPress={() => shift(-1)} style={s.chipIcon}>
          <Feather name="chevron-left" size={13} color={v2.color.forest} />
        </Pressable>
        <View style={[s.chip, s.chipActive, { minWidth: 160, alignItems: "center" }]}>
          <Text style={[s.chipText, s.chipTextActive]}>{MONTHS[month - 1]} {year}</Text>
        </View>
        <Pressable onPress={() => shift(1)} style={s.chipIcon}>
          <Feather name="chevron-right" size={13} color={v2.color.forest} />
        </Pressable>
      </View>

      {loading && (
        <View style={s.loading}>
          <ActivityIndicator color={v2.color.forest} />
          <Text style={s.loadingText}>AI analizuje koszty…</Text>
        </View>
      )}

      {!loading && err && (
        <View style={[s.emptyBox, { borderColor: v2.color.error }]}>
          <Feather name="alert-triangle" size={24} color={v2.color.error} />
          <Text style={s.emptyText}>{err}</Text>
          <Pressable style={s.primaryBtn} onPress={load}>
            <Feather name="refresh-cw" size={14} color="#fff" />
            <Text style={s.primaryBtnText}>Spróbuj ponownie</Text>
          </Pressable>
        </View>
      )}

      {!loading && data && (
        <>
          {/* Hero total */}
          <View style={coachS.heroCard}>
            <Text style={coachS.heroLabel}>Koszty miesiąca</Text>
            <Text style={coachS.heroValue}>{formatPLN(data.current_total || 0)}</Text>
            {data.change_pct !== null && data.change_pct !== undefined && (
              <View style={[coachS.changeBadge, {
                backgroundColor: data.change_pct >= 0 ? "rgba(220,38,38,0.15)" : "rgba(22,163,74,0.15)",
              }]}>
                <Feather name={data.change_pct >= 0 ? "trending-up" : "trending-down"} size={12} color={data.change_pct >= 0 ? "#FCA5A5" : "#86EFAC"} />
                <Text style={[coachS.changeText, { color: data.change_pct >= 0 ? "#FCA5A5" : "#86EFAC" }]}>
                  {data.change_pct > 0 ? "+" : ""}{data.change_pct}% vs poprzedni
                </Text>
              </View>
            )}
            <Text style={coachS.heroPrev}>poprzednio: {formatPLN(data.previous_total || 0)}</Text>
          </View>

          {/* AI summary */}
          {!!data.summary && (
            <View style={coachS.summary}>
              <Feather name="cpu" size={14} color={v2.color.forest} />
              <Text style={coachS.summaryText}>{data.summary}</Text>
            </View>
          )}

          {/* Breakdown */}
          {(data.breakdown || []).length > 0 && (
            <>
              <Text style={[s.fieldLabel, { marginTop: 16 }]}>Podział kategorii</Text>
              {(data.breakdown || []).slice(0, 6).map((b: any, i: number) => {
                const maxCur = Math.max(...(data.breakdown || []).map((x: any) => x.current || 0));
                const w = maxCur > 0 ? Math.max(4, (b.current / maxCur) * 100) : 0;
                const up = b.change_pct !== null && b.change_pct > 0;
                return (
                  <View key={i} style={coachS.catRow}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                      <Text style={coachS.catName}>{b.category}</Text>
                      <Text style={coachS.catVal}>{formatPLN(b.current)}</Text>
                    </View>
                    <View style={coachS.catBg}>
                      <View style={[coachS.catFill, { width: `${w}%` }]} />
                    </View>
                    {b.change_pct !== null && (
                      <Text style={[coachS.catDelta, { color: up ? v2.color.error : v2.color.success }]}>
                        {up ? "▲" : "▼"} {Math.abs(b.change_pct)}% vs poprzedni ({formatPLN(b.previous)})
                      </Text>
                    )}
                  </View>
                );
              })}
            </>
          )}

          {/* Suggestions */}
          {(data.suggestions || []).length > 0 && (
            <>
              <Text style={[s.fieldLabel, { marginTop: 16 }]}>💡 Sugestie AI</Text>
              {(data.suggestions || []).map((sg: any, i: number) => (
                <View key={i} style={[coachS.suggestion, { backgroundColor: impactBg(sg.impact), borderLeftColor: impactColor(sg.impact) }]}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <Text style={coachS.suggCat}>{sg.category || "Ogólne"}</Text>
                    <View style={[coachS.impactPill, { backgroundColor: impactColor(sg.impact) + "22" }]}>
                      <Text style={[coachS.impactText, { color: impactColor(sg.impact) }]}>Impakt: {sg.impact || "—"}</Text>
                    </View>
                  </View>
                  <Text style={coachS.suggText}>{sg.text}</Text>
                  {!!sg.action && <Text style={[coachS.suggAction, { color: impactColor(sg.impact) }]}>→ {sg.action}</Text>}
                </View>
              ))}
            </>
          )}

          <Pressable style={s.regenBtn} onPress={load}>
            <Feather name="refresh-cw" size={14} color={v2.color.forest} />
            <Text style={s.regenBtnText}>Odśwież analizę</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

/* ---------------- CHAT TAB ---------------- */
function ChatTab() {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => `${CHAT_SESSION_KEY}-${Date.now()}`);
  const scrollRef = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const userMsg: ChatMsg = { role: "user", content: text };
    setMsgs(m => [...m, userMsg]);
    setLoading(true);
    try {
      const r: any = await api.aiChat(sessionId, text);
      setMsgs(m => [...m, { role: "assistant", content: String(r?.reply || "") }]);
    } catch (e: any) {
      setMsgs(m => [...m, { role: "assistant", content: `⚠️ Błąd: ${String(e?.message || "AI niedostępne")}` }]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  const clear = () => {
    Alert.alert("Wyczyścić czat?", "Utracisz historię tej rozmowy.", [
      { text: "Anuluj", style: "cancel" },
      {
        text: "Wyczyść", style: "destructive",
        onPress: async () => { try { await api.aiChatClear(sessionId); } catch {} setMsgs([]); },
      },
    ]);
  };

  const suggestions = useMemo(() => [
    "Ile imprez mam w tym miesiącu?",
    "Które imprezy nie mają jeszcze zaliczki?",
    "Jaki jest wynik miesiąca?",
    "Które koszty były największe?",
  ], []);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }} keyboardVerticalOffset={80}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: 16, paddingBottom: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        {msgs.length === 0 && (
          <>
            <View style={s.hint}>
              <Feather name="cpu" size={14} color={v2.color.info} />
              <Text style={s.hintText}>Zadaj pytanie o swoje imprezy, koszty, przychody. AI zna Twoje dane.</Text>
            </View>
            <Text style={[s.fieldLabel, { marginTop: 12 }]}>Sugestie</Text>
            {suggestions.map(sq => (
              <Pressable key={sq} onPress={() => setInput(sq)} style={s.suggestion}>
                <Feather name="message-circle" size={14} color={v2.color.forest} />
                <Text style={s.suggestionText}>{sq}</Text>
              </Pressable>
            ))}
          </>
        )}

        {msgs.map((m, i) => (
          <View key={i} style={[s.msg, m.role === "user" ? s.msgUser : s.msgAI]}>
            {m.role === "assistant" && (
              <View style={s.aiAvatar}><Feather name="cpu" size={12} color="#fff" /></View>
            )}
            <View style={[s.bubble, m.role === "user" ? s.bubbleUser : s.bubbleAI]}>
              <Text style={m.role === "user" ? s.bubbleTextUser : s.bubbleTextAI}>{m.content}</Text>
            </View>
          </View>
        ))}

        {loading && (
          <View style={[s.msg, s.msgAI]}>
            <View style={s.aiAvatar}><Feather name="cpu" size={12} color="#fff" /></View>
            <View style={[s.bubble, s.bubbleAI]}>
              <ActivityIndicator size="small" color={v2.color.forest} />
            </View>
          </View>
        )}
      </ScrollView>

      <View style={[s.chatBar, { paddingBottom: insets.bottom + 8 }]}>
        <Pressable onPress={clear} style={s.chatIconBtn}>
          <Feather name="trash-2" size={16} color={v2.color.textMuted} />
        </Pressable>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Zapytaj o coś…"
          placeholderTextColor={v2.color.textSubtle}
          style={s.chatInput}
          onSubmitEditing={send}
          returnKeyType="send"
          editable={!loading}
        />
        <Pressable onPress={send} disabled={loading || !input.trim()} style={[s.chatSend, (!input.trim() || loading) && { opacity: 0.4 }]}>
          <Feather name="send" size={16} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 14, backgroundColor: v2.color.forestDeep },
  iconBtn: { width: 36, height: 36, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  brand: { color: v2.color.moss, letterSpacing: 3, fontSize: 10, fontWeight: "800" },
  title: { color: "#fff", fontSize: 18, fontWeight: "800" },
  aiDot: { width: 36, height: 36, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },

  segRow: { flexDirection: "row", padding: 12, gap: 8, backgroundColor: v2.color.forestDeep },
  seg: { flex: 1, flexDirection: "row", gap: 5, alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRadius: v2.radius.md, backgroundColor: "rgba(255,255,255,0.1)" },
  segActive: { backgroundColor: v2.color.card },
  segText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  segTextActive: { color: v2.color.forest },

  hint: { flexDirection: "row", gap: 8, padding: 12, borderRadius: v2.radius.md, backgroundColor: v2.color.infoBg + "60", borderLeftWidth: 3, borderLeftColor: v2.color.info, alignItems: "center" },
  hintText: { flex: 1, color: v2.color.text, fontSize: 12, lineHeight: 17 },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: v2.color.border, backgroundColor: v2.color.card },
  chipActive: { borderColor: v2.color.forest, backgroundColor: v2.color.forest },
  chipText: { color: v2.color.text, fontSize: 12, fontWeight: "700", textTransform: "capitalize" },
  chipTextActive: { color: "#fff" },
  chipIcon: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: v2.color.border, backgroundColor: v2.color.mint },

  loading: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  loadingText: { color: v2.color.textMuted, fontSize: 13 },

  emptyBox: { padding: 24, alignItems: "center", gap: 8, borderRadius: v2.radius.md, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, marginTop: 12 },
  emptyTitle: { color: v2.color.text, fontSize: 15, fontWeight: "800" },
  emptyText: { color: v2.color.textMuted, fontSize: 12, textAlign: "center" },

  tipCard: { flexDirection: "row", gap: 10, padding: 12, marginTop: 10, borderRadius: v2.radius.md, borderLeftWidth: 4 },
  tipDot: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", marginTop: 2 },
  tipText: { color: v2.color.text, fontSize: 13, fontWeight: "700", lineHeight: 18 },
  tipAction: { fontSize: 11, fontWeight: "800", marginTop: 4 },

  regenBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 16, padding: 12, borderRadius: v2.radius.md, backgroundColor: v2.color.mint },
  regenBtnText: { color: v2.color.forest, fontSize: 13, fontWeight: "800" },

  fieldLabel: { color: v2.color.textSubtle, fontSize: 10, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 },
  briefInput: { backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, borderRadius: v2.radius.md, padding: 12, minHeight: 100, color: v2.color.text, fontSize: 14 },

  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderRadius: v2.radius.md, backgroundColor: v2.color.forest },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  secBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: v2.radius.md, borderWidth: 1, borderColor: v2.color.borderStrong, backgroundColor: v2.color.card },
  secBtnText: { color: v2.color.forest, fontWeight: "800", fontSize: 13 },

  offerBox: { marginTop: 14, padding: 14, borderRadius: v2.radius.md, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border },
  offerHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  offerTitle: { color: v2.color.text, fontSize: 13, fontWeight: "800" },
  offerText: { color: v2.color.text, fontSize: 14, lineHeight: 21 },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: v2.color.mint },
  copyBtnText: { color: v2.color.forest, fontSize: 11, fontWeight: "800" },

  suggestion: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, marginTop: 6, borderRadius: v2.radius.md, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border },
  suggestionText: { color: v2.color.text, fontSize: 13, fontWeight: "600" },

  msg: { flexDirection: "row", alignItems: "flex-end", gap: 6, marginTop: 10 },
  msgUser: { justifyContent: "flex-end" },
  msgAI: { justifyContent: "flex-start" },
  aiAvatar: { width: 26, height: 26, borderRadius: 999, backgroundColor: v2.color.forest, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  bubble: { maxWidth: "78%", paddingHorizontal: 12, paddingVertical: 10, borderRadius: v2.radius.lg },
  bubbleUser: { backgroundColor: v2.color.forest, borderTopRightRadius: 4 },
  bubbleAI: { backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, borderTopLeftRadius: 4 },
  bubbleTextUser: { color: "#fff", fontSize: 14, lineHeight: 20 },
  bubbleTextAI: { color: v2.color.text, fontSize: 14, lineHeight: 20 },

  chatBar: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: v2.color.border, backgroundColor: v2.color.card },
  chatIconBtn: { width: 36, height: 36, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  chatInput: { flex: 1, height: 42, paddingHorizontal: 14, borderRadius: 999, backgroundColor: v2.color.bg, borderWidth: 1, borderColor: v2.color.border, color: v2.color.text, fontSize: 14 },
  chatSend: { width: 42, height: 42, borderRadius: 999, backgroundColor: v2.color.forest, alignItems: "center", justifyContent: "center" },
});

const coachS = StyleSheet.create({
  heroCard: { padding: 18, borderRadius: v2.radius.xl, backgroundColor: v2.color.forestDeep, marginTop: 16, ...v2.shadow.md },
  heroLabel: { color: v2.color.sage, fontSize: 10, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  heroValue: { color: "#fff", fontSize: 30, fontWeight: "800", marginTop: 4, letterSpacing: -1 },
  heroPrev: { color: v2.color.sage, fontSize: 11, marginTop: 6 },
  changeBadge: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, marginTop: 8 },
  changeText: { fontSize: 11, fontWeight: "800" },

  summary: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, marginTop: 12, borderRadius: v2.radius.md, backgroundColor: v2.color.mint, borderLeftWidth: 3, borderLeftColor: v2.color.forest },
  summaryText: { flex: 1, color: v2.color.text, fontSize: 13, lineHeight: 18, fontWeight: "600" },

  catRow: { padding: 12, marginTop: 8, borderRadius: v2.radius.md, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border },
  catName: { color: v2.color.text, fontSize: 13, fontWeight: "800" },
  catVal: { color: v2.color.text, fontSize: 13, fontWeight: "800" },
  catBg: { height: 6, borderRadius: 3, backgroundColor: v2.color.divider, overflow: "hidden" },
  catFill: { height: "100%", borderRadius: 3, backgroundColor: v2.color.forest },
  catDelta: { fontSize: 10, fontWeight: "700", marginTop: 4 },

  suggestion: { padding: 12, marginTop: 8, borderRadius: v2.radius.md, borderLeftWidth: 4 },
  suggCat: { color: v2.color.text, fontSize: 13, fontWeight: "800" },
  suggText: { color: v2.color.text, fontSize: 13, lineHeight: 18, marginTop: 2 },
  suggAction: { fontSize: 11, fontWeight: "800", marginTop: 4 },
  impactPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  impactText: { fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },
});

const sendS = StyleSheet.create({
  offerEditable: { color: v2.color.text, fontSize: 14, lineHeight: 21, minHeight: 120, padding: 0 },
  sendCard: { marginTop: 14, padding: 14, borderRadius: v2.radius.xl, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.borderStrong },
  sendHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  hintSmall: { color: v2.color.textMuted, fontSize: 11, marginTop: 6, lineHeight: 15 },
  inputRow: { height: 44, paddingHorizontal: 12, borderRadius: v2.radius.md, borderWidth: 1, borderColor: v2.color.border, backgroundColor: v2.color.bg, color: v2.color.text, fontSize: 14 },
  pickBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: v2.radius.md, backgroundColor: v2.color.mint },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: v2.color.card, borderTopLeftRadius: v2.radius.xl, borderTopRightRadius: v2.radius.xl, padding: 16, maxHeight: "80%" },
  modalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  clientRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: v2.color.divider },
  avatar: { width: 34, height: 34, borderRadius: 999, backgroundColor: v2.color.mint, alignItems: "center", justifyContent: "center" },
  avatarText: { color: v2.color.forest, fontSize: 14, fontWeight: "800" },
  clientName: { color: v2.color.text, fontSize: 14, fontWeight: "800" },
  clientMeta: { color: v2.color.textMuted, fontSize: 11, marginTop: 2 },
});

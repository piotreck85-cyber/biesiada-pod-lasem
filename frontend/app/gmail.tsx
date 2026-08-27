import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator,
  Alert, StatusBar, Modal, Linking, KeyboardAvoidingView, Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { v2 } from "@/src/designTokensV2";
import { api } from "@/src/api";

type Msg = {
  id: string; thread_id: string;
  subject: string; from_name: string; from_email: string; to_email: string;
  snippet: string; date: string; date_iso?: string; unread: boolean;
  label_ids?: string[];
};

type FullMsg = Msg & { body_text?: string; body_html?: string };

function fmtDate(iso?: string) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
    }
    const y = new Date(now); y.setDate(y.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "wczoraj";
    return d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });
  } catch { return iso; }
}

function initials(name: string, email: string) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s|@/).filter(Boolean);
  return parts.slice(0, 2).map(p => p[0]?.toUpperCase() || "").join("") || "?";
}

export default function GmailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState<any | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<FullMsg | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const s: any = await api.gmailStatus();
      setStatus(s);
      return s;
    } catch { setStatus({ connected: false }); return { connected: false }; }
  }, []);

  const loadMessages = useCallback(async () => {
    try {
      const r: any = await api.gmailMessages(25);
      setMessages(r?.messages || []);
      setKeywords(r?.keywords || []);
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "Nie udało się pobrać wiadomości");
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const s = await loadStatus();
      if (s?.connected) await loadMessages();
      setLoading(false);
    })();
  }, [loadStatus, loadMessages]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const s = await loadStatus();
    if (s?.connected) await loadMessages();
    setRefreshing(false);
  }, [loadStatus, loadMessages]);

  const connectGmail = async () => {
    setConnecting(true);
    try {
      const r: any = await api.gmailOauthStart();
      if (!r?.auth_url) throw new Error("Brak URL autoryzacji");
      await Linking.openURL(r.auth_url);
      Alert.alert(
        "Autoryzacja w Google",
        "Otworzono okno logowania Google. Po zakończeniu wróć do aplikacji i odśwież ekran.",
        [{ text: "OK" }]
      );
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "Nie udało się rozpocząć autoryzacji");
    } finally { setConnecting(false); }
  };

  const disconnectGmail = () => {
    Alert.alert(
      "Odłączyć Gmail?",
      "Aplikacja przestanie mieć dostęp do skrzynki. Możesz podłączyć ponownie w każdej chwili.",
      [
        { text: "Anuluj", style: "cancel" },
        { text: "Odłącz", style: "destructive", onPress: async () => {
          try {
            await api.gmailDisconnect();
            setMessages([]);
            await loadStatus();
          } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
        }},
      ]
    );
  };

  const openMessage = async (id: string) => {
    setDetailOpen(true);
    setDetail(null);
    setDetailLoading(true);
    try {
      const m: any = await api.gmailMessage(id);
      setDetail(m);
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "");
      setDetailOpen(false);
    } finally { setDetailLoading(false); }
  };

  if (loading) return <View style={s.rootLoading}><ActivityIndicator color={v2.color.forest} /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: v2.color.bg }}>
      <StatusBar barStyle="light-content" />

      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.headerBtn}>
          <Feather name="arrow-left" size={18} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.brand}>INTEGRACJA</Text>
          <Text style={s.title}>Gmail (tylko odczyt)</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={v2.color.forest} />}
      >
        {/* Connection state */}
        {status?.connected ? (
          <View style={s.connectedCard}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={s.iconCircle}>
                <Feather name="mail" size={16} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.connLabel}>Podłączono jako</Text>
                <Text style={s.connEmail}>{status.email}</Text>
                <Text style={s.connSub}>
                  Tylko odczyt · brak wysyłki · brak modyfikacji Gmaila
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <Pressable onPress={onRefresh} style={s.actionBtn}>
                <Feather name="refresh-cw" size={13} color={v2.color.forest} />
                <Text style={s.actionBtnText}>Odśwież</Text>
              </Pressable>
              <Pressable onPress={disconnectGmail} style={[s.actionBtn, { borderColor: v2.color.error + "44" }]}>
                <Feather name="log-out" size={13} color={v2.color.error} />
                <Text style={[s.actionBtnText, { color: v2.color.error }]}>Odłącz</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={s.discCard}>
            <View style={s.discIcon}>
              <Feather name="mail" size={30} color={v2.color.forest} />
            </View>
            <Text style={s.discTitle}>Podłącz Gmail Biesiady</Text>
            <Text style={s.discSub}>
              Aplikacja będzie odczytywać wiadomości z Twojej skrzynki i pokazywać zapytania klientów.
            </Text>
            <View style={s.privacyBox}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <Feather name="shield" size={12} color={v2.color.success} />
                <Text style={s.privacyTitle}>Bezpieczeństwo</Text>
              </View>
              <Text style={s.privacyItem}>✓ Tylko konto biesiadapodlasem@gmail.com</Text>
              <Text style={s.privacyItem}>✓ Uprawnienie: tylko odczyt (gmail.readonly)</Text>
              <Text style={s.privacyItem}>✓ Aplikacja nie wysyła, nie usuwa i nie zmienia wiadomości</Text>
              <Text style={s.privacyItem}>✓ Token jest zaszyfrowany na serwerze</Text>
            </View>
            <Pressable onPress={connectGmail} disabled={connecting} style={[s.primaryBtn, connecting && { opacity: 0.5 }]}>
              {connecting ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Feather name="link" size={16} color="#fff" />
                  <Text style={s.primaryBtnText}>Połącz Gmail</Text>
                </>
              )}
            </Pressable>
          </View>
        )}

        {/* Keywords info */}
        {status?.connected && keywords.length > 0 && (
          <View style={s.kwCard}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Feather name="filter" size={12} color={v2.color.info} />
              <Text style={s.kwTitle}>Widoczne wiadomości</Text>
            </View>
            <Text style={s.kwSub}>
              INBOX z ostatnich 6 miesięcy pasujące do słów kluczowych + wszystkie odpowiedzi w wątkach.
            </Text>
            <View style={s.kwChipsRow}>
              {keywords.slice(0, 10).map(k => (
                <View key={k} style={s.kwChip}>
                  <Text style={s.kwChipText}>{k}</Text>
                </View>
              ))}
              {keywords.length > 10 && (
                <View style={s.kwChip}><Text style={s.kwChipText}>+{keywords.length - 10}</Text></View>
              )}
            </View>
          </View>
        )}

        {/* Messages list */}
        {status?.connected && (
          <View style={{ marginTop: 20 }}>
            <Text style={s.sectionTitle}>Wiadomości ({messages.length})</Text>
            {messages.length === 0 ? (
              <View style={s.emptyBox}>
                <Feather name="inbox" size={22} color={v2.color.sage} />
                <Text style={s.emptyText}>Brak wiadomości pasujących do filtrów</Text>
                <Text style={s.emptySub}>
                  Napisz do siebie testowego maila ze słowem „oferta”, żeby przetestować.
                </Text>
              </View>
            ) : messages.map(m => (
              <Pressable key={m.id} onPress={() => openMessage(m.id)} style={[s.msgRow, m.unread && s.msgRowUnread]}>
                <View style={s.avatar}>
                  <Text style={s.avatarText}>{initials(m.from_name, m.from_email)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={[s.msgFrom, m.unread && { fontWeight: "800" }]} numberOfLines={1}>
                      {m.from_name || m.from_email}
                    </Text>
                    {m.unread && <View style={s.unreadDot} />}
                  </View>
                  <Text style={[s.msgSubject, m.unread && { fontWeight: "800", color: v2.color.text }]} numberOfLines={1}>
                    {m.subject || "(bez tematu)"}
                  </Text>
                  <Text style={s.msgSnippet} numberOfLines={2}>{m.snippet}</Text>
                </View>
                <Text style={s.msgDate}>{fmtDate(m.date_iso)}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Detail modal */}
      <Modal visible={detailOpen} animationType="slide" onRequestClose={() => setDetailOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: v2.color.bg }}>
          <View style={[s.header, { paddingTop: insets.top + 12 }]}>
            <Pressable onPress={() => setDetailOpen(false)} hitSlop={10} style={s.headerBtn}>
              <Feather name="x" size={18} color="#fff" />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={s.brand}>WIADOMOŚĆ</Text>
              <Text style={s.title} numberOfLines={1}>{detail?.subject || "…"}</Text>
            </View>
          </View>
          {detailLoading ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator color={v2.color.forest} />
            </View>
          ) : detail ? (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
              <View style={s.detailHead}>
                <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                  <View style={s.avatar}>
                    <Text style={s.avatarText}>{initials(detail.from_name, detail.from_email)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.detFrom}>{detail.from_name || "(bez imienia)"}</Text>
                    <Text style={s.detEmail}>{detail.from_email}</Text>
                  </View>
                </View>
                <Text style={s.detDate}>{detail.date}</Text>
                {detail.to_email ? (
                  <Text style={s.detToLine}>Do: {detail.to_email}</Text>
                ) : null}
              </View>

              <View style={s.bodyBox}>
                <Text style={s.bodyText} selectable>
                  {detail.body_text || detail.snippet || "(brak treści tekstowej)"}
                </Text>
              </View>

              {detail.body_html && !detail.body_text ? (
                <Text style={s.helpNote}>ℹ️ Wiadomość zawiera tylko HTML — pokazano fragment.</Text>
              ) : null}
            </ScrollView>
          ) : null}
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  rootLoading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: v2.color.bg },

  header: {
    flexDirection: "row", alignItems: "flex-end", gap: 10,
    paddingHorizontal: 16, paddingBottom: 14,
    backgroundColor: v2.color.forestDeep,
  },
  headerBtn: {
    width: 38, height: 38, borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  brand: { color: v2.color.moss, letterSpacing: 3, fontSize: 10, fontWeight: "800", marginBottom: 2 },
  title: { color: v2.color.onDark, fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },

  connectedCard: {
    padding: 14, borderRadius: v2.radius.xl,
    backgroundColor: v2.color.card,
    borderWidth: 1, borderColor: v2.color.forest + "44",
    ...v2.shadow.sm,
  },
  iconCircle: {
    width: 40, height: 40, borderRadius: 999,
    backgroundColor: v2.color.forest,
    alignItems: "center", justifyContent: "center",
  },
  connLabel: { color: v2.color.textSubtle, fontSize: 10, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase" },
  connEmail: { color: v2.color.text, fontSize: 15, fontWeight: "800", marginTop: 2 },
  connSub: { color: v2.color.textMuted, fontSize: 11, marginTop: 2 },
  actionBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 10, borderRadius: v2.radius.md,
    backgroundColor: v2.color.card,
    borderWidth: 1, borderColor: v2.color.forest + "44",
  },
  actionBtnText: { color: v2.color.forest, fontWeight: "800", fontSize: 12 },

  discCard: {
    padding: 20, borderRadius: v2.radius.xl,
    backgroundColor: v2.color.card,
    borderWidth: 1, borderColor: v2.color.border,
    alignItems: "center",
    ...v2.shadow.sm,
  },
  discIcon: {
    width: 68, height: 68, borderRadius: 999,
    backgroundColor: v2.color.mint,
    alignItems: "center", justifyContent: "center",
    marginBottom: 10,
  },
  discTitle: { color: v2.color.text, fontSize: 18, fontWeight: "800" },
  discSub: { color: v2.color.textMuted, fontSize: 13, textAlign: "center", marginTop: 6, lineHeight: 18 },

  privacyBox: {
    marginTop: 16, padding: 12, borderRadius: v2.radius.md,
    backgroundColor: v2.color.successBg,
    borderWidth: 1, borderColor: v2.color.success + "33",
    width: "100%",
  },
  privacyTitle: { color: v2.color.success, fontSize: 11, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase" },
  privacyItem: { color: v2.color.text, fontSize: 11, marginTop: 2, lineHeight: 16 },

  primaryBtn: {
    marginTop: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, paddingHorizontal: 24, borderRadius: v2.radius.md,
    backgroundColor: v2.color.forest,
    minWidth: 200,
  },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },

  kwCard: {
    marginTop: 12, padding: 12, borderRadius: v2.radius.md,
    backgroundColor: v2.color.infoBg,
    borderWidth: 1, borderColor: v2.color.info + "33",
  },
  kwTitle: { color: v2.color.text, fontSize: 12, fontWeight: "800" },
  kwSub: { color: v2.color.textMuted, fontSize: 11, marginTop: 4, lineHeight: 15 },
  kwChipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 8 },
  kwChip: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
    backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border,
  },
  kwChipText: { color: v2.color.text, fontSize: 10, fontWeight: "700" },

  sectionTitle: { color: v2.color.text, fontSize: 16, fontWeight: "800", marginBottom: 10 },

  msgRow: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    padding: 12, marginBottom: 6, borderRadius: v2.radius.md,
    backgroundColor: v2.color.card,
    borderWidth: 1, borderColor: v2.color.border,
  },
  msgRowUnread: {
    backgroundColor: v2.color.card,
    borderColor: v2.color.forest + "44",
  },
  avatar: {
    width: 36, height: 36, borderRadius: 999,
    backgroundColor: v2.color.mint,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: v2.color.forest, fontSize: 12, fontWeight: "800" },
  msgFrom: { color: v2.color.text, fontSize: 13, fontWeight: "700" },
  unreadDot: { width: 6, height: 6, borderRadius: 999, backgroundColor: v2.color.forest },
  msgSubject: { color: v2.color.textMuted, fontSize: 12, fontWeight: "700", marginTop: 2 },
  msgSnippet: { color: v2.color.textMuted, fontSize: 11, marginTop: 3, lineHeight: 15 },
  msgDate: { color: v2.color.textSubtle, fontSize: 10, fontWeight: "700" },

  emptyBox: {
    padding: 24, alignItems: "center", gap: 6,
    borderRadius: v2.radius.md,
    backgroundColor: v2.color.card,
    borderWidth: 1, borderColor: v2.color.border, borderStyle: "dashed",
  },
  emptyText: { color: v2.color.text, fontSize: 13, fontWeight: "700" },
  emptySub: { color: v2.color.textMuted, fontSize: 11, textAlign: "center" },

  detailHead: {
    padding: 12, borderRadius: v2.radius.md,
    backgroundColor: v2.color.card,
    borderWidth: 1, borderColor: v2.color.border,
    marginBottom: 12,
  },
  detFrom: { color: v2.color.text, fontSize: 14, fontWeight: "800" },
  detEmail: { color: v2.color.textMuted, fontSize: 12, marginTop: 2 },
  detDate: { color: v2.color.textSubtle, fontSize: 11, marginTop: 8 },
  detToLine: { color: v2.color.textMuted, fontSize: 11, marginTop: 2 },
  bodyBox: {
    padding: 14, borderRadius: v2.radius.md,
    backgroundColor: v2.color.card,
    borderWidth: 1, borderColor: v2.color.border,
  },
  bodyText: { color: v2.color.text, fontSize: 14, lineHeight: 22 },
  helpNote: { color: v2.color.textMuted, fontSize: 11, marginTop: 10, fontStyle: "italic" },
});

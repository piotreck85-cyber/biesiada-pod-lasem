import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  Alert, ActivityIndicator, StatusBar, KeyboardAvoidingView, Platform, Switch,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { v2 } from "@/src/designTokensV2";
import { api } from "@/src/api";

const DEFAULT_BODY = `Dzień dobry {{client_name}},

serdecznie dziękujemy za wspólnie spędzony czas w Biesiadzie pod Lasem – Dolinie Przygód. Mamy nadzieję, że przyjęcie pozostawiło Państwu wiele pięknych wspomnień.

W ramach podziękowania przyznajemy 10% rabatu na organizację kolejnej imprezy.

Kod rabatowy: {{discount_code}}
Ważny do: {{discount_expiry}}

Będzie nam również bardzo miło, jeżeli podzielą się Państwo swoją opinią:
{{google_review_url}}

Do zobaczenia ponownie!
Biesiada pod Lasem – Dolina Przygód`;

export default function ThankYouSettings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [googleUrl, setGoogleUrl] = useState("");
  const [pct, setPct] = useState("10");
  const [months, setMonths] = useState("12");

  const [discounts, setDiscounts] = useState<any[]>([]);
  const [tab, setTab] = useState<"active" | "used" | "expired">("active");

  const load = useCallback(async () => {
    try {
      const s: any = await api.getThankYouSettings();
      setEnabled(s.enabled !== false);
      setSubject(s.subject || "");
      setBody(s.body_template || DEFAULT_BODY);
      setGoogleUrl(s.google_review_url || "");
      setPct(String(s.discount_pct ?? 10));
      setMonths(String(s.valid_months ?? 12));
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "Nie udało się załadować ustawień");
    } finally { setLoading(false); }
  }, []);

  const loadDiscounts = useCallback(async () => {
    try {
      const rows: any = await api.listDiscounts(tab);
      setDiscounts(Array.isArray(rows) ? rows : []);
    } catch {}
  }, [tab]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadDiscounts(); }, [loadDiscounts]);

  const save = async () => {
    setSaving(true);
    try {
      await api.saveThankYouSettings({
        enabled,
        subject: subject.trim(),
        body_template: body,
        google_review_url: googleUrl.trim(),
        discount_pct: parseFloat(pct.replace(",", ".")) || 10,
        valid_months: parseInt(months, 10) || 12,
      });
      Alert.alert("Zapisano", "Ustawienia podziękowania zaktualizowane.");
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "Nie udało się zapisać");
    } finally { setSaving(false); }
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
          <Text style={s.brand}>USTAWIENIA</Text>
          <Text style={s.title}>Podziękowanie + rabaty</Text>
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 200 }}>
          {/* Enable toggle */}
          <View style={s.card}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>Automatyczna wysyłka</Text>
                <Text style={s.cardSub}>Wysyłaj podziękowanie automatycznie po zmianie statusu na „Zakończone”</Text>
              </View>
              <Switch
                testID="thank-you-enabled"
                value={enabled}
                onValueChange={setEnabled}
                trackColor={{ false: v2.color.borderStrong, true: v2.color.forest }}
                thumbColor="#fff"
              />
            </View>
          </View>

          {/* Discount rules */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Zasady rabatu</Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Wysokość (%)</Text>
                <TextInput
                  testID="discount-pct"
                  value={pct}
                  onChangeText={setPct}
                  keyboardType="decimal-pad"
                  placeholder="10"
                  placeholderTextColor={v2.color.textSubtle}
                  style={s.input}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Ważność (miesięcy)</Text>
                <TextInput
                  testID="discount-months"
                  value={months}
                  onChangeText={setMonths}
                  keyboardType="number-pad"
                  placeholder="12"
                  placeholderTextColor={v2.color.textSubtle}
                  style={s.input}
                />
              </View>
            </View>
            <Text style={s.helpText}>
              💡 Rabat jednorazowy, naliczany od ceny podstawowego pakietu. Nie łączy się z innymi promocjami.
            </Text>
          </View>

          {/* Google review URL */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Link do opinii Google</Text>
            <TextInput
              testID="google-review-url"
              value={googleUrl}
              onChangeText={setGoogleUrl}
              placeholder="https://g.page/r/..../review"
              placeholderTextColor={v2.color.textSubtle}
              autoCapitalize="none"
              style={[s.input, { marginTop: 8 }]}
            />
            <Text style={s.helpText}>
              Klienci klikną w ten link w mailu, aby zostawić opinię o Biesiadzie.
            </Text>
          </View>

          {/* Subject */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Temat wiadomości</Text>
            <TextInput
              testID="thank-you-subject"
              value={subject}
              onChangeText={setSubject}
              placeholder="Dziękujemy za wspólny czas..."
              placeholderTextColor={v2.color.textSubtle}
              style={[s.input, { marginTop: 8 }]}
            />
          </View>

          {/* Body template */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Treść wiadomości</Text>
            <Text style={s.helpText}>
              Zmienne: {"{{client_name}}"} · {"{{discount_code}}"} · {"{{discount_expiry}}"} · {"{{google_review_url}}"}
            </Text>
            <TextInput
              testID="thank-you-body"
              value={body}
              onChangeText={setBody}
              multiline
              placeholder="Treść maila..."
              placeholderTextColor={v2.color.textSubtle}
              style={[s.input, { minHeight: 260, textAlignVertical: "top", marginTop: 8 }]}
            />
            <Pressable onPress={() => setBody(DEFAULT_BODY)} style={s.resetLink}>
              <Feather name="rotate-ccw" size={12} color={v2.color.forest} />
              <Text style={{ color: v2.color.forest, fontWeight: "700", fontSize: 12 }}>Przywróć domyślną treść</Text>
            </Pressable>
          </View>

          <Pressable onPress={save} disabled={saving} style={[s.saveBtn, saving && { opacity: 0.5 }]} testID="save-thank-you">
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Feather name="check" size={16} color="#fff" />
                <Text style={s.saveBtnText}>Zapisz ustawienia</Text>
              </>
            )}
          </Pressable>

          {/* Discounts list */}
          <View style={{ marginTop: 24 }}>
            <Text style={s.sectionTitle}>Historia kodów rabatowych</Text>
            <View style={s.tabsRow}>
              {(["active", "used", "expired"] as const).map(t => (
                <Pressable key={t} onPress={() => setTab(t)} style={[s.tab, tab === t && s.tabActive]}>
                  <Text style={[s.tabText, tab === t && s.tabTextActive]}>
                    {t === "active" ? "Aktywne" : t === "used" ? "Wykorzystane" : "Wygasłe"}
                  </Text>
                </Pressable>
              ))}
            </View>
            {discounts.length === 0 ? (
              <View style={s.emptyBox}>
                <Feather name="tag" size={22} color={v2.color.sage} />
                <Text style={s.emptyText}>Brak kodów w tej kategorii</Text>
              </View>
            ) : discounts.map(d => (
              <View key={d.id} style={s.discountRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.discountCode}>{d.code}</Text>
                  <Text style={s.discountMeta}>
                    {d.client_name || "(brak imienia)"} · {d.client_email || "(brak e-maila)"}
                  </Text>
                  <Text style={s.discountMeta}>
                    {d.amount_pct}% · ważny do {d.expires_at_date}
                    {d.source_event_name ? ` · z: ${d.source_event_name}` : ""}
                  </Text>
                </View>
                <View style={[
                  s.statusBadge,
                  d.status === "active" ? { backgroundColor: v2.color.successBg } :
                  d.status === "used"   ? { backgroundColor: v2.color.infoBg } :
                                           { backgroundColor: v2.color.errorBg }
                ]}>
                  <Text style={[
                    s.statusText,
                    d.status === "active" ? { color: v2.color.success } :
                    d.status === "used"   ? { color: v2.color.info } :
                                             { color: v2.color.error }
                  ]}>
                    {d.status === "active" ? "AKTYWNY" : d.status === "used" ? "UŻYTY" : "WYGASŁ"}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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

  card: {
    marginBottom: 12, padding: 14, borderRadius: v2.radius.lg,
    backgroundColor: v2.color.card,
    borderWidth: 1, borderColor: v2.color.border,
    ...v2.shadow.sm,
  },
  cardTitle: { color: v2.color.text, fontSize: 14, fontWeight: "800" },
  cardSub: { color: v2.color.textMuted, fontSize: 12, marginTop: 2 },

  label: { color: v2.color.textSubtle, fontSize: 11, fontWeight: "800", letterSpacing: 0.3, textTransform: "uppercase", marginBottom: 6 },
  input: {
    backgroundColor: v2.color.cardMuted,
    borderWidth: 1, borderColor: v2.color.border,
    borderRadius: v2.radius.md,
    paddingHorizontal: 12, paddingVertical: 10,
    color: v2.color.text, fontSize: 14,
  },
  helpText: { color: v2.color.textMuted, fontSize: 11, marginTop: 8, lineHeight: 16, fontStyle: "italic" },

  resetLink: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, alignSelf: "flex-start" },

  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: v2.radius.md,
    backgroundColor: v2.color.forest,
    marginTop: 6,
  },
  saveBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },

  sectionTitle: { color: v2.color.text, fontSize: 16, fontWeight: "800", marginBottom: 10 },
  tabsRow: { flexDirection: "row", gap: 6, marginBottom: 12 },
  tab: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: v2.radius.md, backgroundColor: v2.color.cardMuted, borderWidth: 1, borderColor: v2.color.border },
  tabActive: { backgroundColor: v2.color.forest, borderColor: v2.color.forest },
  tabText: { color: v2.color.textMuted, fontSize: 12, fontWeight: "800" },
  tabTextActive: { color: "#fff" },

  discountRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 12, marginBottom: 6, borderRadius: v2.radius.md,
    backgroundColor: v2.color.card,
    borderWidth: 1, borderColor: v2.color.border,
  },
  discountCode: { color: v2.color.forest, fontSize: 14, fontWeight: "800", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  discountMeta: { color: v2.color.textMuted, fontSize: 11, marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  statusText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.4 },

  emptyBox: { padding: 24, alignItems: "center", gap: 6, borderRadius: v2.radius.md, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, borderStyle: "dashed" },
  emptyText: { color: v2.color.textMuted, fontSize: 12 },
});

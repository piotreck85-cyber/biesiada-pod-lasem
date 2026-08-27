import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TextInput, Modal, Pressable, ScrollView,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Switch,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { v2 } from "@/src/designTokensV2";
import { api } from "@/src/api";

type Props = {
  visible: boolean;
  onClose: () => void;
  onCreated?: (code: any) => void;
  initialClientName?: string;
  initialClientEmail?: string;
  initialNote?: string;
};

/**
 * Modal for manually generating a discount code for a client.
 * Reused from both Settings screen and Event form.
 */
export default function ManualDiscountModal({
  visible, onClose, onCreated,
  initialClientName = "", initialClientEmail = "", initialNote = "",
}: Props) {
  const [clientName, setClientName] = useState(initialClientName);
  const [clientEmail, setClientEmail] = useState(initialClientEmail);
  const [pct, setPct] = useState("10");
  const [months, setMonths] = useState("12");
  const [note, setNote] = useState(initialNote);
  const [sendEmail, setSendEmail] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setClientName(initialClientName || "");
      setClientEmail(initialClientEmail || "");
      setNote(initialNote || "");
      setPct("10");
      setMonths("12");
      setSendEmail(!!(initialClientEmail || "").includes("@"));
    }
  }, [visible, initialClientName, initialClientEmail, initialNote]);

  const submit = async () => {
    if (!clientName.trim()) {
      Alert.alert("Brak danych", "Podaj imię/nazwę klienta.");
      return;
    }
    if (sendEmail && !clientEmail.includes("@")) {
      Alert.alert("Brak e-maila", "Aby wysłać kod mailem, podaj adres e-mail klienta.");
      return;
    }
    setSaving(true);
    try {
      const r: any = await api.createManualDiscount({
        client_name: clientName.trim(),
        client_email: clientEmail.trim(),
        amount_pct: parseFloat(pct.replace(",", ".")) || 10,
        valid_months: parseInt(months, 10) || 12,
        note: note.trim(),
        send_email: sendEmail,
      });
      const emailInfo = r?.email || {};
      let msg = `Kod: ${r.code.code}\nWażny do: ${r.code.expires_at_date}`;
      if (emailInfo.attempted) {
        msg += emailInfo.sent ? `\n\n✓ Wysłano na ${emailInfo.recipient}` : `\n\n✗ Błąd wysyłki: ${emailInfo.error || ""}`;
      }
      Alert.alert("Kod wygenerowany", msg);
      onCreated?.(r.code);
      onClose();
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "Nie udało się utworzyć kodu");
    } finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={s.backdrop}>
          <Pressable style={{ flex: 1 }} onPress={onClose} />
          <View style={s.sheet}>
            <View style={s.handle} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <Feather name="tag" size={18} color={v2.color.forest} />
              <Text style={s.title}>Wygeneruj kod rabatowy</Text>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={s.label}>Imię / nazwa klienta *</Text>
              <TextInput
                testID="manual-code-name"
                value={clientName}
                onChangeText={setClientName}
                placeholder="np. Jan Kowalski"
                placeholderTextColor={v2.color.textSubtle}
                style={s.input}
              />

              <Text style={[s.label, { marginTop: 12 }]}>E-mail klienta {sendEmail ? "*" : "(opcjonalny)"}</Text>
              <TextInput
                testID="manual-code-email"
                value={clientEmail}
                onChangeText={setClientEmail}
                placeholder="klient@example.com"
                placeholderTextColor={v2.color.textSubtle}
                keyboardType="email-address"
                autoCapitalize="none"
                style={s.input}
              />

              <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>Rabat (%)</Text>
                  <TextInput
                    testID="manual-code-pct"
                    value={pct}
                    onChangeText={setPct}
                    keyboardType="decimal-pad"
                    style={s.input}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>Ważność (mc)</Text>
                  <TextInput
                    testID="manual-code-months"
                    value={months}
                    onChangeText={setMonths}
                    keyboardType="number-pad"
                    style={s.input}
                  />
                </View>
              </View>

              <Text style={[s.label, { marginTop: 12 }]}>Notatka wewnętrzna (widoczna tylko dla właściciela)</Text>
              <TextInput
                testID="manual-code-note"
                value={note}
                onChangeText={setNote}
                placeholder="np. urodziny stałego klienta"
                placeholderTextColor={v2.color.textSubtle}
                style={s.input}
              />

              <View style={s.sendRow}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: v2.color.text, fontWeight: "800", fontSize: 13 }}>Wyślij od razu</Text>
                  <Text style={{ color: v2.color.textMuted, fontSize: 11, marginTop: 2 }}>
                    Klient dostanie mail z podziękowaniem i kodem (ten sam szablon)
                  </Text>
                </View>
                <Switch
                  testID="manual-code-send"
                  value={sendEmail}
                  onValueChange={setSendEmail}
                  trackColor={{ false: v2.color.borderStrong, true: v2.color.forest }}
                  thumbColor="#fff"
                />
              </View>

              <Pressable
                testID="manual-code-submit"
                onPress={submit}
                disabled={saving}
                style={[s.submitBtn, saving && { opacity: 0.5 }]}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Feather name="check" size={16} color="#fff" />
                    <Text style={s.submitBtnText}>Wygeneruj kod</Text>
                  </>
                )}
              </Pressable>

              <Pressable onPress={onClose} style={s.cancelBtn}>
                <Text style={s.cancelBtnText}>Anuluj</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: v2.color.card,
    borderTopLeftRadius: v2.radius.xl,
    borderTopRightRadius: v2.radius.xl,
    padding: 20, paddingTop: 12, paddingBottom: 30,
    maxHeight: "88%",
  },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: v2.color.borderStrong, marginBottom: 12 },
  title: { color: v2.color.text, fontSize: 18, fontWeight: "800", letterSpacing: -0.2 },
  label: { color: v2.color.textSubtle, fontSize: 11, fontWeight: "800", letterSpacing: 0.3, textTransform: "uppercase", marginBottom: 6 },
  input: {
    backgroundColor: v2.color.cardMuted,
    borderWidth: 1, borderColor: v2.color.border,
    borderRadius: v2.radius.md,
    paddingHorizontal: 12, paddingVertical: 10,
    color: v2.color.text, fontSize: 14,
  },
  sendRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    marginTop: 16, padding: 12, borderRadius: v2.radius.md,
    backgroundColor: v2.color.mint,
    borderWidth: 1, borderColor: v2.color.forest + "44",
  },
  submitBtn: {
    marginTop: 20, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: v2.radius.md,
    backgroundColor: v2.color.forest,
  },
  submitBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  cancelBtn: { alignItems: "center", padding: 10, marginTop: 6 },
  cancelBtnText: { color: v2.color.textMuted, fontSize: 13, fontWeight: "700" },
});

import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { v2 } from "@/src/designTokensV2";

const STEPS = ["Podstawowe", "Klient", "Pakiet i cena", "Zespół", "Uwagi"];

export default function EditEventMockup() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [step, setStep] = useState(0);
  return (
    <View style={{ flex: 1, backgroundColor: v2.color.bg }}>
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={s.iconBtn}><Feather name="x" size={20} color="#fff" /></Pressable>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={s.brand}>DODAJ IMPREZĘ</Text>
          <Text style={s.title}>Krok {step + 1} z {STEPS.length}</Text>
        </View>
      </View>
      {/* Progress steps */}
      <View style={s.stepsRow}>
        {STEPS.map((_, i) => (
          <View key={i} style={[s.step, i <= step && s.stepDone]} />
        ))}
      </View>
      <View style={s.stepTitleRow}>
        <Text style={s.stepTitle}>{STEPS[step]}</Text>
        <Text style={s.stepHint}>{step + 1} / {STEPS.length}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 130, gap: 12 }}>
        {step === 0 && (
          <>
            <Field label="Nazwa imprezy" placeholder="np. Urodziny Zosi" />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}><Field label="Data" placeholder="2026-09-15" icon="calendar" /></View>
              <View style={{ flex: 1 }}><Field label="Rodzaj" placeholder="Urodzinki" icon="tag" /></View>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}><Field label="Od" placeholder="14:00" icon="clock" /></View>
              <View style={{ flex: 1 }}><Field label="Do" placeholder="18:00" icon="clock" /></View>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}><Field label="Dorośli" placeholder="20" icon="users" /></View>
              <View style={{ flex: 1 }}><Field label="Dzieci" placeholder="8" icon="smile" /></View>
            </View>
          </>
        )}
        {step === 1 && (
          <>
            <Field label="Imię i nazwisko klienta" placeholder="np. Anna Nowak" icon="user" />
            <Field label="Telefon" placeholder="+48…" icon="phone" />
            <Field label="E-mail" placeholder="opcjonalny" icon="mail" />
          </>
        )}
        {step === 2 && (
          <>
            <Text style={s.sectionLabel}>PAKIET</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {["Biesiada Standard","Biesiada Premium","Warsztaty","Ognisko","Własny"].map(p => (
                <Pressable key={p} style={s.pkgChip}><Text style={s.pkgChipText}>{p}</Text></Pressable>
              ))}
            </View>
            <Field label="Cena całkowita (zł)" placeholder="0.00" icon="dollar-sign" />
            <Field label="Wymagana zaliczka (zł)" placeholder="20% ceny" icon="percent" />
            <View style={s.infoBox}>
              <Feather name="info" size={14} color={v2.color.info} />
              <Text style={s.infoText}>Zaliczki dodasz później w sekcji „Wpłaty klienta" na karcie imprezy.</Text>
            </View>
          </>
        )}
        {step === 3 && (
          <>
            <Text style={s.sectionLabel}>ZESPÓŁ NA IMPREZIE</Text>
            <Pressable style={s.addRow}><Feather name="plus" size={14} color={v2.color.forest} /><Text style={s.addRowText}>Dodaj pracownika</Text></Pressable>
            <Text style={[s.sectionLabel, { marginTop: 10 }]}>ANIMATORZY</Text>
            <Pressable style={s.addRow}><Feather name="plus" size={14} color={v2.color.forest} /><Text style={s.addRowText}>Dodaj animatora</Text></Pressable>
          </>
        )}
        {step === 4 && (
          <>
            <Field label="Uwagi (widoczne dla zespołu)" placeholder="Alergie · dojazd · życzenia" icon="edit-3" multi />
            <Field label="Notatka wewnętrzna (tylko admin)" placeholder="Widoczna tylko dla właściciela" icon="lock" multi />
          </>
        )}
      </ScrollView>

      {/* Sticky bottom bar */}
      <View style={[s.bottomBar, { paddingBottom: insets.bottom + 10 }]}>
        {step > 0 && (
          <Pressable onPress={() => setStep(step - 1)} style={s.secBtn}>
            <Feather name="chevron-left" size={16} color={v2.color.forest} />
            <Text style={s.secBtnText}>Wstecz</Text>
          </Pressable>
        )}
        <Pressable onPress={() => step < STEPS.length - 1 ? setStep(step + 1) : router.back()} style={s.primBtn}>
          <Text style={s.primBtnText}>{step < STEPS.length - 1 ? "Dalej" : "Zapisz"}</Text>
          <Feather name={step < STEPS.length - 1 ? "chevron-right" : "check"} size={16} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

function Field({ label, placeholder, icon, multi }: any) {
  return (
    <View>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={[s.input, multi && { minHeight: 76, alignItems: "flex-start", paddingVertical: 12 }]}>
        {icon && <Feather name={icon} size={16} color={v2.color.textSubtle} />}
        <TextInput placeholder={placeholder} placeholderTextColor={v2.color.textSubtle} style={s.inputText} multiline={!!multi} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 14, backgroundColor: v2.color.forestDeep },
  iconBtn: { width: 36, height: 36, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  brand: { color: v2.color.moss, letterSpacing: 3, fontSize: 10, fontWeight: "800" },
  title: { color: "#fff", fontSize: 18, fontWeight: "800" },

  stepsRow: { flexDirection: "row", gap: 4, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6, backgroundColor: v2.color.card },
  step: { flex: 1, height: 4, borderRadius: 2, backgroundColor: v2.color.divider },
  stepDone: { backgroundColor: v2.color.forest },
  stepTitleRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, backgroundColor: v2.color.card, borderBottomWidth: 1, borderBottomColor: v2.color.border },
  stepTitle: { color: v2.color.text, fontSize: 15, fontWeight: "800" },
  stepHint: { color: v2.color.textMuted, fontSize: 12, fontWeight: "700" },

  fieldLabel: { color: v2.color.textSubtle, fontSize: 10, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 },
  input: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, borderRadius: v2.radius.md, paddingHorizontal: 12, height: 46 },
  inputText: { flex: 1, color: v2.color.text, fontSize: 14 },

  sectionLabel: { color: v2.color.textSubtle, fontSize: 10, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  pkgChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: v2.color.border, backgroundColor: v2.color.card },
  pkgChipText: { color: v2.color.text, fontSize: 12, fontWeight: "700" },
  infoBox: { flexDirection: "row", gap: 8, padding: 12, borderRadius: v2.radius.md, backgroundColor: v2.color.infoBg + "60", borderLeftWidth: 3, borderLeftColor: v2.color.info },
  infoText: { flex: 1, color: v2.color.text, fontSize: 12, lineHeight: 17 },
  addRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 14, borderRadius: v2.radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: v2.color.borderStrong },
  addRowText: { color: v2.color.forest, fontWeight: "800", fontSize: 13 },

  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 10, backgroundColor: v2.color.card, borderTopWidth: 1, borderTopColor: v2.color.border },
  secBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14, borderRadius: v2.radius.md, borderWidth: 1, borderColor: v2.color.borderStrong },
  secBtnText: { color: v2.color.forest, fontWeight: "800", fontSize: 14 },
  primBtn: { flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14, borderRadius: v2.radius.md, backgroundColor: v2.color.forest },
  primBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
});

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView,
  Platform, ActivityIndicator, Modal,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme, formatPLN, initials } from "@/src/theme";
import { api } from "@/src/api";

type Cost = { label: string; amount: number };
type Shift = { staff_id: string; hours: number };

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function EventDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, date: initDate } = useLocalSearchParams<{ id: string; date?: string }>();
  const isNew = id === "new";

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState(initDate || todayIso());
  const [time, setTime] = useState("");
  const [venue, setVenue] = useState("");
  const [notes, setNotes] = useState("");
  const [revenue, setRevenue] = useState("");
  const [costs, setCosts] = useState<Cost[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [staffAll, setStaffAll] = useState<any[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try { setStaffAll(await api.listStaff()); } catch {}
      if (!isNew) {
        try {
          const ev: any = await api.getEvent(id as string);
          setName(ev.name); setDate(ev.date); setTime(ev.time || ""); setVenue(ev.venue || "");
          setNotes(ev.notes || ""); setRevenue(String(ev.revenue || ""));
          setCosts(ev.costs || []); setShifts(ev.shifts || []);
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

  const parseAmt = (v: string) => parseFloat(v.replace(",", ".")) || 0;

  const save = async () => {
    if (!name.trim() || !date) return;
    setSaving(true);
    const body = {
      name: name.trim(), date, time, venue, notes,
      revenue: revenueNum,
      costs: costs.map(c => ({ label: c.label, amount: Number(c.amount) || 0 })),
      shifts: shifts.map(sh => ({ staff_id: sh.staff_id, hours: Number(sh.hours) || 0 })),
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
        {!isNew ? (
          <Pressable testID="event-delete-btn" onPress={remove} hitSlop={12} style={s.backBtn}>
            <Feather name="trash-2" size={18} color={theme.color.error} />
          </Pressable>
        ) : <View style={{ width: 36 }} />}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 160 }} keyboardShouldPersistTaps="handled">
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
                <Field label="Godzina">
                  <TextInput testID="event-time-input" value={time} onChangeText={setTime} placeholder="18:00" placeholderTextColor={theme.color.onSurfaceSecondary} style={s.input} />
                </Field>
              </View>
            </View>
            <Field label="Miejsce">
              <TextInput testID="event-venue-input" value={venue} onChangeText={setVenue} placeholder="Sala Bankietowa" placeholderTextColor={theme.color.onSurfaceSecondary} style={s.input} />
            </Field>
            <Field label="Notatki">
              <TextInput testID="event-notes-input" value={notes} onChangeText={setNotes} placeholder="..." placeholderTextColor={theme.color.onSurfaceSecondary} style={[s.input, { height: 80, textAlignVertical: "top" }]} multiline />
            </Field>
          </Section>

          {/* Financials */}
          <Section title="Finanse">
            <Field label="Przychód (PLN)">
              <TextInput testID="event-revenue-input" value={revenue} onChangeText={setRevenue} placeholder="0" placeholderTextColor={theme.color.onSurfaceSecondary} keyboardType="decimal-pad" style={s.input} />
            </Field>
            <View style={{ marginTop: 8, marginBottom: 4 }}>
              <Text style={s.label}>Koszty (materiały, wynajem itp.)</Text>
            </View>
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
                <View key={sh.staff_id} style={s.shiftRow}>
                  <View style={s.avatar}><Text style={s.avatarText}>{initials(s2?.name)}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.shiftName}>{s2?.name || "?"}</Text>
                    <Text style={s.shiftRate}>{formatPLN(s2?.hourly_rate || 0)}/godz.</Text>
                  </View>
                  <TextInput
                    testID={`shift-hours-${i}`}
                    value={String(sh.hours || "")}
                    onChangeText={v => setShifts(shifts.map((x, ix) => ix === i ? { ...x, hours: parseAmt(v) } : x))}
                    placeholder="godz."
                    placeholderTextColor={theme.color.onSurfaceSecondary}
                    keyboardType="decimal-pad"
                    style={s.hoursInput}
                  />
                  <Pressable testID={`shift-del-${i}`} onPress={() => setShifts(shifts.filter((_, ix) => ix !== i))} hitSlop={8} style={s.iconBtn}>
                    <Feather name="x" size={16} color={theme.color.onSurfaceSecondary} />
                  </Pressable>
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
  summary: { backgroundColor: theme.color.surfaceSecondary, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: theme.color.brandTertiary },
  sumRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  sumLabel: { color: theme.color.onSurfaceSecondary, fontSize: 13 },
  sumVal: { fontSize: 14, fontWeight: "600" },
  sep: { height: 1, backgroundColor: theme.color.divider, marginVertical: 8 },
  footer: {
    position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: theme.color.surface,
    padding: 16, borderTopWidth: 1, borderTopColor: theme.color.divider,
  },
  saveBtn: { backgroundColor: theme.color.brand, borderRadius: 12, paddingVertical: 15, alignItems: "center" },
  saveBtnText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 15, letterSpacing: 0.5 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { backgroundColor: theme.color.surfaceSecondary, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 12, maxHeight: "70%", borderWidth: 1, borderColor: theme.color.border },
  grip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.color.borderStrong, marginBottom: 12 },
  sheetTitle: { color: theme.color.onSurface, fontSize: 18, fontWeight: "700", marginBottom: 12 },
  pickerRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
});

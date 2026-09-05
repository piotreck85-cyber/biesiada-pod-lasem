import { useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, Modal, TextInput, Switch, Alert, ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { v2 } from "@/src/designTokensV2";
import { api } from "@/src/api";
import { MONTHS_PL } from "@/src/theme";

type Decl = {
  date: string;
  status: "available" | "unavailable";
  all_day?: boolean;
  time_from?: string;
  time_to?: string;
  note?: string;
};

const DAY_LABELS = ["pn", "wt", "śr", "cz", "pt", "sb", "nd"];
const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

const buildMonthCells = (y: number, m: number): (string | null)[] => {
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const startPad = (new Date(y, m, 1).getDay() + 6) % 7;
  const cells: (string | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
};

const fmtDay = (iso: string) => {
  try {
    return new Date(iso + "T12:00:00").toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" });
  } catch { return iso; }
};

export default function AvailabilityCalendar() {
  const insets = useSafeAreaInsets();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [ym, setYm] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [decls, setDecls] = useState<Record<string, Decl>>({});
  const [loading, setLoading] = useState(true);

  // Editor modal
  const [editDate, setEditDate] = useState<string | null>(null);
  const [status, setStatus] = useState<"available" | "unavailable" | "none">("none");
  const [allDay, setAllDay] = useState(true);
  const [timeFrom, setTimeFrom] = useState("");
  const [timeTo, setTimeTo] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const mm = String(ym.m + 1).padStart(2, "0");
    api.availabilityMy(`${ym.y}-${mm}-01`, `${ym.y}-${mm}-31`)
      .then((rows: any) => {
        if (cancelled) return;
        const map: Record<string, Decl> = {};
        (Array.isArray(rows) ? rows : []).forEach((r: any) => { map[r.date] = r; });
        setDecls(map);
      })
      .catch(() => { if (!cancelled) setDecls({}); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ym]);

  const gridCells = useMemo(() => buildMonthCells(ym.y, ym.m), [ym]);
  const monthDecls = useMemo(
    () => Object.values(decls).sort((a, b) => a.date.localeCompare(b.date)),
    [decls]
  );

  const shiftYm = (delta: number) => {
    setYm(({ y, m }) => { const d = new Date(y, m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  };

  const openDay = (date: string) => {
    if (date < today) return; // przeszłości nie edytujemy
    const d = decls[date];
    setEditDate(date);
    setStatus(d ? d.status : "none");
    setAllDay(d ? d.all_day !== false : true);
    setTimeFrom(d?.time_from || "");
    setTimeTo(d?.time_to || "");
    setNote(d?.note || "");
  };

  const saveDecl = async () => {
    if (!editDate) return;
    if (status !== "none" && !allDay && (!HHMM.test(timeFrom.trim()) || !HHMM.test(timeTo.trim()))) {
      Alert.alert("Błąd", "Podaj godziny od–do w formacie HH:MM (np. 16:00)");
      return;
    }
    setSaving(true);
    try {
      const r: any = await api.availabilitySet(editDate, {
        status,
        all_day: status === "none" ? true : allDay,
        time_from: allDay ? "" : timeFrom.trim(),
        time_to: allDay ? "" : timeTo.trim(),
        note: note.trim(),
      });
      setDecls(prev => {
        const next = { ...prev };
        if (status === "none") delete next[editDate];
        else next[editDate] = r;
        return next;
      });
      setEditDate(null);
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "Nie udało się zapisać deklaracji.");
    } finally { setSaving(false); }
  };

  const declPill = (d: Decl) => d.status === "available"
    ? { txt: d.all_day === false ? `🟢 Dostępny ${d.time_from}–${d.time_to}` : "🟢 Dostępny (cały dzień)", bg: v2.color.successBg, fg: v2.color.success }
    : { txt: d.all_day === false ? `🔴 Niedostępny ${d.time_from}–${d.time_to}` : "🔴 Niedostępny (cały dzień)", bg: v2.color.errorBg, fg: v2.color.error };

  if (loading) return <View style={{ padding: 32, alignItems: "center" }}><ActivityIndicator color={v2.color.forest} /></View>;

  return (
    <View>
      {/* Info */}
      <View style={s.infoBox}>
        <Feather name="info" size={14} color={v2.color.info} />
        <Text style={s.infoText}>
          Oznacz dni, w które możesz lub nie możesz pracować. Manager nie przypisze Cię do imprezy
          w dniu, w którym jesteś niedostępny. Deklarację możesz zmienić w każdej chwili.
        </Text>
      </View>

      {/* Month switcher */}
      <View style={s.monthRow}>
        <Pressable onPress={() => shiftYm(-1)} hitSlop={10} style={s.monthBtn} testID="avail-prev-month">
          <Feather name="chevron-left" size={18} color={v2.color.forest} />
        </Pressable>
        <Text style={s.monthLabel}>{MONTHS_PL[ym.m]} {ym.y}</Text>
        <Pressable onPress={() => shiftYm(1)} hitSlop={10} style={s.monthBtn} testID="avail-next-month">
          <Feather name="chevron-right" size={18} color={v2.color.forest} />
        </Pressable>
      </View>

      {/* Legend */}
      <View style={s.legendRow}>
        <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: v2.color.success }]} /><Text style={s.legendText}>Dostępny</Text></View>
        <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: v2.color.error }]} /><Text style={s.legendText}>Niedostępny</Text></View>
        <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: v2.color.borderStrong }]} /><Text style={s.legendText}>Brak deklaracji</Text></View>
      </View>

      {/* Month grid */}
      <View style={s.gridBox}>
        <View style={{ flexDirection: "row", marginBottom: 4 }}>
          {DAY_LABELS.map(d => <Text key={d} style={s.gridHeadText}>{d}</Text>)}
        </View>
        {Array.from({ length: gridCells.length / 7 }, (_, r) => (
          <View key={r} style={{ flexDirection: "row" }}>
            {gridCells.slice(r * 7, r * 7 + 7).map((date, i) => {
              if (!date) return <View key={i} style={s.gcell} />;
              const d = decls[date];
              const isToday = date === today;
              const isPast = date < today;
              return (
                <Pressable
                  key={i}
                  onPress={() => openDay(date)}
                  style={[
                    s.gcell,
                    d?.status === "available" && s.gcellAvail,
                    d?.status === "unavailable" && s.gcellUnavail,
                    isToday && s.gcellToday,
                    isPast && { opacity: 0.4 },
                  ]}
                  testID={`avail-day-${date}`}
                >
                  <Text style={[
                    s.gcellNum,
                    d?.status === "available" && { color: v2.color.success, fontWeight: "800" },
                    d?.status === "unavailable" && { color: v2.color.error, fontWeight: "800" },
                  ]}>
                    {parseInt(date.slice(-2), 10)}
                  </Text>
                  {d && d.all_day === false ? (
                    <Text style={[s.gcellHours, { color: d.status === "available" ? v2.color.success : v2.color.error }]}>
                      {d.time_from}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      {/* Month declarations list */}
      <View style={s.sectionHead}>
        <Text style={s.sectionLabel}>Twoje deklaracje w tym miesiącu ({monthDecls.length})</Text>
      </View>
      {monthDecls.length === 0 ? (
        <View style={s.emptyBox}>
          <Feather name="calendar" size={20} color={v2.color.sage} />
          <Text style={s.emptyText}>Brak deklaracji — dotknij dnia w kalendarzu, aby dodać</Text>
        </View>
      ) : monthDecls.map(d => {
        const pill = declPill(d);
        return (
          <Pressable key={d.date} style={s.declRow} onPress={() => openDay(d.date)} testID={`avail-decl-${d.date}`}>
            <View style={s.dateBox}>
              <Text style={s.dateBoxDay}>{d.date.slice(-2)}</Text>
              <Text style={s.dateBoxMon}>{["nd","pn","wt","śr","cz","pt","sb"][new Date(d.date + "T12:00:00").getDay()]}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={[s.declPill, { backgroundColor: pill.bg }]}>
                <Text style={[s.declPillText, { color: pill.fg }]}>{pill.txt}</Text>
              </View>
              {d.note ? <Text style={s.declNote} numberOfLines={1}>💬 {d.note}</Text> : null}
            </View>
            {d.date >= today ? <Feather name="edit-2" size={14} color={v2.color.textSubtle} /> : null}
          </Pressable>
        );
      })}

      {/* Editor modal */}
      <Modal visible={!!editDate} transparent animationType="slide" onRequestClose={() => setEditDate(null)}>
        <Pressable style={s.backdrop} onPress={() => setEditDate(null)} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={s.grip} />
          <Text style={s.sheetTitle}>{editDate ? fmtDay(editDate) : ""}</Text>
          <Text style={s.sheetSub}>Twoja dostępność tego dnia</Text>

          {([
            { key: "available", label: "🟢 Dostępny", desc: "Mogę pracować tego dnia" },
            { key: "unavailable", label: "🔴 Niedostępny", desc: "Nie mogę pracować tego dnia" },
            { key: "none", label: "⚪ Brak deklaracji", desc: "Usuń deklarację dla tego dnia" },
          ] as const).map(opt => (
            <Pressable
              key={opt.key}
              onPress={() => setStatus(opt.key)}
              style={[s.statusOpt, status === opt.key && s.statusOptActive]}
              testID={`avail-status-${opt.key}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.statusOptLabel}>{opt.label}</Text>
                <Text style={s.statusOptDesc}>{opt.desc}</Text>
              </View>
              <Feather
                name={status === opt.key ? "check-circle" : "circle"}
                size={20}
                color={status === opt.key ? v2.color.forest : v2.color.borderStrong}
              />
            </Pressable>
          ))}

          {status !== "none" ? (
            <>
              <View style={s.allDayRow}>
                <Text style={s.allDayLabel}>Cały dzień</Text>
                <Switch
                  value={allDay}
                  onValueChange={setAllDay}
                  trackColor={{ false: v2.color.borderStrong, true: v2.color.moss }}
                  thumbColor="#fff"
                  testID="avail-allday"
                />
              </View>
              {!allDay ? (
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.miniLabel}>Od (HH:MM)</Text>
                    <TextInput
                      value={timeFrom}
                      onChangeText={setTimeFrom}
                      placeholder="16:00"
                      placeholderTextColor={v2.color.textSubtle}
                      style={s.timeInput}
                      testID="avail-time-from"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.miniLabel}>Do (HH:MM)</Text>
                    <TextInput
                      value={timeTo}
                      onChangeText={setTimeTo}
                      placeholder="22:00"
                      placeholderTextColor={v2.color.textSubtle}
                      style={s.timeInput}
                      testID="avail-time-to"
                    />
                  </View>
                </View>
              ) : null}
              <Text style={s.miniLabel}>Notatka (opcjonalna)</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="np. wizyta u lekarza do 15:00"
                placeholderTextColor={v2.color.textSubtle}
                style={s.timeInput}
                testID="avail-note"
              />
            </>
          ) : null}

          <Pressable onPress={saveDecl} disabled={saving} style={[s.saveBtn, saving && { opacity: 0.6 }]} testID="avail-save">
            {saving ? <ActivityIndicator color="#fff" /> : (
              <>
                <Feather name="check" size={16} color="#fff" />
                <Text style={s.saveBtnText}>Zapisz deklarację</Text>
              </>
            )}
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  infoBox: {
    flexDirection: "row", gap: 8, alignItems: "flex-start",
    padding: 12, borderRadius: v2.radius.md, marginBottom: 12,
    backgroundColor: v2.color.infoBg, borderWidth: 1, borderColor: v2.color.info + "33",
  },
  infoText: { flex: 1, color: v2.color.text, fontSize: 12, lineHeight: 17 },

  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  monthBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: v2.color.mint, alignItems: "center", justifyContent: "center" },
  monthLabel: { color: v2.color.text, fontSize: 16, fontWeight: "800", textTransform: "capitalize" },

  legendRow: { flexDirection: "row", gap: 14, marginBottom: 8, paddingHorizontal: 2 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 999 },
  legendText: { color: v2.color.textMuted, fontSize: 11, fontWeight: "700" },

  gridBox: { borderRadius: 14, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, padding: 8 },
  gridHeadText: { flex: 1, textAlign: "center", color: v2.color.textMuted, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  gcell: { flex: 1, aspectRatio: 0.95, alignItems: "center", justifyContent: "center", borderRadius: 8, margin: 1 },
  gcellAvail: { backgroundColor: v2.color.successBg },
  gcellUnavail: { backgroundColor: v2.color.errorBg },
  gcellToday: { borderWidth: 1.5, borderColor: v2.color.forest },
  gcellNum: { color: v2.color.text, fontSize: 13 },
  gcellHours: { fontSize: 8, fontWeight: "800", marginTop: 1 },

  sectionHead: { marginTop: 18, marginBottom: 8 },
  sectionLabel: { color: v2.color.text, fontSize: 15, fontWeight: "800" },
  emptyBox: {
    padding: 20, alignItems: "center", gap: 6, borderRadius: v2.radius.md,
    backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, borderStyle: "dashed",
  },
  emptyText: { color: v2.color.textMuted, fontSize: 12, textAlign: "center" },

  declRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 12, marginBottom: 6, borderRadius: v2.radius.md,
    borderWidth: 1, borderColor: v2.color.border, backgroundColor: v2.color.card,
  },
  dateBox: {
    width: 44, height: 44, borderRadius: v2.radius.md,
    backgroundColor: v2.color.mint, alignItems: "center", justifyContent: "center",
  },
  dateBoxDay: { color: v2.color.forest, fontSize: 16, fontWeight: "800" },
  dateBoxMon: { color: v2.color.forest, fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  declPill: { alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  declPillText: { fontSize: 11, fontWeight: "800" },
  declNote: { color: v2.color.textMuted, fontSize: 11, marginTop: 4 },

  // Modal
  backdrop: { flex: 1, backgroundColor: "rgba(15,31,20,0.5)" },
  sheet: {
    backgroundColor: v2.color.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 10,
  },
  grip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: v2.color.borderStrong, marginBottom: 12 },
  sheetTitle: { color: v2.color.text, fontSize: 18, fontWeight: "800", textTransform: "capitalize" },
  sheetSub: { color: v2.color.textMuted, fontSize: 12, marginTop: 2, marginBottom: 14 },

  statusOpt: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 12, borderRadius: v2.radius.md, marginBottom: 8,
    borderWidth: 1.5, borderColor: v2.color.border, backgroundColor: v2.color.bg,
  },
  statusOptActive: { borderColor: v2.color.forest, backgroundColor: v2.color.mint },
  statusOptLabel: { color: v2.color.text, fontSize: 14, fontWeight: "800" },
  statusOptDesc: { color: v2.color.textMuted, fontSize: 11, marginTop: 2 },

  allDayRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 8, marginTop: 2,
  },
  allDayLabel: { color: v2.color.text, fontSize: 14, fontWeight: "700" },
  miniLabel: { color: v2.color.textMuted, fontSize: 11, fontWeight: "700", marginTop: 8, marginBottom: 4 },
  timeInput: {
    borderWidth: 1, borderColor: v2.color.border, borderRadius: v2.radius.md,
    paddingHorizontal: 12, paddingVertical: 10, color: v2.color.text,
    backgroundColor: v2.color.bg, fontSize: 14,
  },
  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: v2.radius.md, backgroundColor: v2.color.forest, marginTop: 16,
  },
  saveBtnText: { color: "#fff", fontWeight: "800", fontSize: 14, letterSpacing: 0.3 },
});

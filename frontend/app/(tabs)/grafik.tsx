import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator, Alert, StatusBar,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { v2 } from "@/src/designTokensV2";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { MONTHS_PL } from "@/src/theme";

type Ev = {
  id: string; date: string; name: string; time_start?: string; time_end?: string;
  people?: number; status?: string; location?: string; package_set?: string;
  notes_public?: string;
  my_shift?: { role?: string; hours?: number; from?: string; to?: string };
};

type ChecklistItem = { id: string; title: string; done: boolean };

const dow = (iso: string) => {
  try {
    const d = new Date(iso + "T12:00:00");
    return ["nd","pn","wt","śr","cz","pt","sb"][d.getDay()];
  } catch { return ""; }
};
const isSameDay = (iso: string, target: string) => iso === target;
const cardLinkStyle = {
  flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const,
  gap: 6, marginTop: 10, paddingVertical: 10, borderRadius: 10,
  backgroundColor: v2.color.mint,
};
const cardLinkTextStyle = { color: v2.color.forest, fontSize: 13, fontWeight: "800" as const };
const addDaysISO = (iso: string, days: number) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const DAY_LABELS = ["pn", "wt", "śr", "cz", "pt", "sb", "nd"];
const buildMonthCells = (y: number, m: number): (string | null)[] => {
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const startPad = (new Date(y, m, 1).getDay() + 6) % 7;
  const cells: (string | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
};

export default function GrafikScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [events, setEvents] = useState<Ev[]>([]);
  const [openSession, setOpenSession] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [todayChecklist, setTodayChecklist] = useState<ChecklistItem[] | null>(null);
  const [tomorrowChecklist, setTomorrowChecklist] = useState<ChecklistItem[] | null>(null);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const tomorrow = useMemo(() => addDaysISO(today, 1), [today]);

  // ---- Month view (own schedule only) ----
  const [view, setView] = useState<"lista" | "miesiac">("lista");
  const [ym, setYm] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [monthEvents, setMonthEvents] = useState<Ev[]>([]);
  const [selDay, setSelDay] = useState<string | null>(null);

  useEffect(() => {
    if (view !== "miesiac") return;
    const mm = String(ym.m + 1).padStart(2, "0");
    api.mySchedule(`${ym.y}-${mm}-01`, `${ym.y}-${mm}-31`)
      .then((r: any) => setMonthEvents(Array.isArray(r) ? r : []))
      .catch(() => setMonthEvents([]));
  }, [view, ym]);

  const monthByDate = useMemo(() => {
    const m: Record<string, Ev[]> = {};
    monthEvents.forEach(e => { (m[e.date] = m[e.date] || []).push(e); });
    return m;
  }, [monthEvents]);
  const gridCells = useMemo(() => buildMonthCells(ym.y, ym.m), [ym]);
  const shiftYm = (delta: number) => {
    setSelDay(null);
    setYm(({ y, m }) => { const d = new Date(y, m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  };

  // pending corrections awaiting MY approval (manager proposed a change)
  const [pendingMy, setPendingMy] = useState(0);
  useEffect(() => {
    api.timeCorrections({ status: "PENDING_EMPLOYEE" })
      .then((r: any) => setPendingMy(Array.isArray(r) ? r.length : 0))
      .catch(() => {});
  }, [loading]);

  const load = useCallback(async () => {
    try {
      const [sched, mine]: any[] = await Promise.all([
        api.mySchedule(today),
        api.timeMy(5),
      ]);
      setEvents(sched || []);
      const open = (mine || []).find((r: any) => !r.end_at);
      setOpenSession(open || null);
    } catch (e: any) { console.warn("moja-praca load", e); }
  }, [today]);

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);

  const todayEvent = useMemo(() => events.find(e => e.date === today), [events, today]);
  const tomorrowEvent = useMemo(() => events.find(e => e.date === tomorrow), [events, tomorrow]);
  const upcoming = useMemo(
    () => events.filter(e => e.date > tomorrow).slice(0, 10),
    [events, tomorrow]
  );

  // Load checklist snapshots for today + tomorrow events
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (todayEvent) {
        try {
          const r: any = await api.getEventChecklist(todayEvent.id);
          if (!cancelled) setTodayChecklist(Array.isArray(r?.items) ? r.items : Array.isArray(r) ? r : []);
        } catch { if (!cancelled) setTodayChecklist([]); }
      } else setTodayChecklist(null);
      if (tomorrowEvent) {
        try {
          const r: any = await api.getEventChecklist(tomorrowEvent.id);
          if (!cancelled) setTomorrowChecklist(Array.isArray(r?.items) ? r.items : Array.isArray(r) ? r : []);
        } catch { if (!cancelled) setTomorrowChecklist([]); }
      } else setTomorrowChecklist(null);
    })();
    return () => { cancelled = true; };
  }, [todayEvent, tomorrowEvent]);

  const clockIn = async () => {
    try {
      const row: any = await api.timeStart({ event_id: todayEvent?.id });
      setOpenSession(row);
      Alert.alert("Rozpoczęto pracę", new Date(row.start_at).toLocaleTimeString("pl-PL"));
    } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
  };
  const clockOut = async () => {
    if (!openSession) return;
    try {
      const row: any = await api.timeStop({ entry_id: openSession.id });
      setOpenSession(null);
      const h = Math.floor(row.hours);
      const m = Math.round((row.hours - h) * 60);
      Alert.alert("Zakończono pracę", `Przepracowano: ${h} godz. ${m} min`);
      await load();
    } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
  };

  if (loading) return <View style={s.rootLoading}><ActivityIndicator color={v2.color.forest} /></View>;

  const firstName = (user?.name || user?.email || "").split(/\s|@/)[0];

  const renderEventDetail = (ev: Ev) => (
    <>
      <Text style={s.eventName}>{ev.name}</Text>
      <View style={{ flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        {ev.time_start ? (
          <View style={s.metaChip}>
            <Feather name="clock" size={12} color={v2.color.forest} />
            <Text style={s.metaText}>{ev.time_start}{ev.time_end ? `–${ev.time_end}` : ""}</Text>
          </View>
        ) : null}
        {ev.people ? (
          <View style={s.metaChip}>
            <Feather name="users" size={12} color={v2.color.forest} />
            <Text style={s.metaText}>{ev.people} os.</Text>
          </View>
        ) : null}
        {ev.my_shift?.role ? (
          <View style={s.metaChip}>
            <Feather name="briefcase" size={12} color={v2.color.forest} />
            <Text style={s.metaText}>{ev.my_shift.role}</Text>
          </View>
        ) : null}
        {ev.location ? (
          <View style={s.metaChip}>
            <Feather name="map-pin" size={12} color={v2.color.forest} />
            <Text style={s.metaText}>{ev.location}</Text>
          </View>
        ) : null}
      </View>
      {ev.my_shift?.time_start ? (
        <View style={s.planBanner}>
          <Feather name="clock" size={14} color="#fff" />
          <Text style={s.planBannerText}>
            TWÓJ CZAS PRACY: {ev.my_shift.time_start}{ev.my_shift.time_end ? `–${ev.my_shift.time_end}` : ""}
          </Text>
        </View>
      ) : null}
      {ev.my_shift?.note ? (
        <Text style={{ color: v2.color.textMuted, fontSize: 12, marginTop: 4 }}>📝 {ev.my_shift.note}</Text>
      ) : null}
      {ev.notes_public ? (
        <View style={s.notesBox}>
          <Feather name="file-text" size={12} color={v2.color.info} />
          <Text style={s.notesText}>{ev.notes_public}</Text>
        </View>
      ) : null}
    </>
  );

  const renderChecklistSnapshot = (items: ChecklistItem[] | null, eventId?: string) => {
    if (!items) return null;
    if (items.length === 0) return (
      <View style={s.checklistEmpty}>
        <Feather name="check-square" size={14} color={v2.color.textSubtle} />
        <Text style={s.checklistEmptyText}>Brak zadań do tej imprezy</Text>
      </View>
    );
    const done = items.filter(i => i.done).length;
    const pct = Math.round((done / items.length) * 100);
    const shownItems = items.slice(0, 3);
    return (
      <Pressable
        onPress={() => eventId && router.push(`/checklist/${eventId}` as any)}
        style={s.checklistBox}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Feather name="check-square" size={14} color={v2.color.forest} />
            <Text style={s.checklistTitle}>Zadania</Text>
          </View>
          <Text style={s.checklistProgress}>{done}/{items.length} · {pct}%</Text>
        </View>
        <View style={s.progressBg}>
          <View style={[s.progressFill, { width: `${pct}%` }]} />
        </View>
        <View style={{ marginTop: 8, gap: 4 }}>
          {shownItems.map(it => (
            <View key={it.id} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Feather
                name={it.done ? "check-circle" : "circle"}
                size={13}
                color={it.done ? v2.color.success : v2.color.textSubtle}
              />
              <Text
                style={[
                  s.checklistItem,
                  it.done && { textDecorationLine: "line-through", color: v2.color.textSubtle }
                ]}
                numberOfLines={1}
              >
                {it.title}
              </Text>
            </View>
          ))}
          {items.length > 3 ? (
            <Text style={s.checklistMore}>+ {items.length - 3} więcej · dotknij, aby zobaczyć wszystkie ›</Text>
          ) : (
            <Text style={s.checklistMore}>Dotknij, aby otworzyć checklistę ›</Text>
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: v2.color.bg }}>
      <StatusBar barStyle="light-content" />

      {/* HEADER (dark forest) */}
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.brand}>MOJA PRACA</Text>
          <Text style={s.title}>Cześć, {firstName} 👋</Text>
        </View>
        <Pressable onPress={logout} hitSlop={10} style={s.headerBtn} testID="grafik-logout">
          <Feather name="log-out" size={16} color="#fff" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={v2.color.forest} />}
      >
        {/* Clock in/out card — floating */}
        <View style={s.clockCard}>
          {openSession ? (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: v2.color.error }} />
                <Text style={s.clockLabel}>W TRAKCIE PRACY</Text>
                <Text style={s.clockSince}>od {new Date(openSession.start_at).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}</Text>
              </View>
              <Pressable onPress={clockOut} style={[s.primaryBtn, { backgroundColor: v2.color.error, marginTop: 12 }]}>
                <Feather name="log-out" size={18} color="#fff" />
                <Text style={s.primaryBtnText}>KOŃCZĘ PRACĘ</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={s.clockLabel}>LISTA OBECNOŚCI</Text>
              <Pressable onPress={clockIn} style={[s.primaryBtn, { marginTop: 8 }]}>
                <Feather name="play" size={18} color="#fff" />
                <Text style={s.primaryBtnText}>ROZPOCZYNAM PRACĘ</Text>
              </Pressable>
            </>
          )}
          <Pressable onPress={() => router.push("/obecnosc")} style={s.linkBtn}>
            <Text style={s.linkBtnText}>Zobacz moją historię obecności ›</Text>
          </Pressable>
          <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
            <Pressable
              testID="grafik-report-correction"
              onPress={() => router.push((openSession ? `/korekty-czasu?mode=stop&entry=${openSession.id}` : "/korekty-czasu?mode=start") as any)}
              style={s.corrBtn}
            >
              <Feather name="alert-circle" size={13} color="#B45309" />
              <Text style={s.corrBtnText} numberOfLines={1}>
                {openSession ? "Popraw godzinę zakończenia" : "Zgłoś brak rozpoczęcia pracy"}
              </Text>
            </Pressable>
            <Pressable testID="grafik-open-corrections" onPress={() => router.push("/korekty-czasu" as any)} style={s.corrLink}>
              <Text style={s.corrLinkText}>Korekty{pendingMy > 0 ? ` (${pendingMy})` : ""} ›</Text>
            </Pressable>
          </View>
        </View>

        {/* View toggle: Lista | Miesiąc */}
        <View style={s.viewToggle}>
          <Pressable onPress={() => setView("lista")} style={[s.viewToggleBtn, view === "lista" && s.viewToggleBtnActive]} testID="grafik-view-lista">
            <Feather name="list" size={13} color={view === "lista" ? "#fff" : v2.color.forest} />
            <Text style={[s.viewToggleText, view === "lista" && s.viewToggleTextActive]}>Lista</Text>
          </Pressable>
          <Pressable onPress={() => setView("miesiac")} style={[s.viewToggleBtn, view === "miesiac" && s.viewToggleBtnActive]} testID="grafik-view-miesiac">
            <Feather name="calendar" size={13} color={view === "miesiac" ? "#fff" : v2.color.forest} />
            <Text style={[s.viewToggleText, view === "miesiac" && s.viewToggleTextActive]}>Miesiąc</Text>
          </Pressable>
        </View>

        {view === "miesiac" ? (
          <>
            {/* Month switcher */}
            <View style={s.monthRow}>
              <Pressable onPress={() => shiftYm(-1)} hitSlop={10} style={s.monthBtn} testID="grafik-prev-month">
                <Feather name="chevron-left" size={18} color={v2.color.forest} />
              </Pressable>
              <Text style={s.monthLabel}>{MONTHS_PL[ym.m]} {ym.y}</Text>
              <Pressable onPress={() => shiftYm(1)} hitSlop={10} style={s.monthBtn} testID="grafik-next-month">
                <Feather name="chevron-right" size={18} color={v2.color.forest} />
              </Pressable>
            </View>

            {/* Month grid — only own shifts */}
            <View style={s.gridBox}>
              <View style={{ flexDirection: "row", marginBottom: 4 }}>
                {DAY_LABELS.map(d => <Text key={d} style={s.gridHeadText}>{d}</Text>)}
              </View>
              {Array.from({ length: gridCells.length / 7 }, (_, r) => (
                <View key={r} style={{ flexDirection: "row" }}>
                  {gridCells.slice(r * 7, r * 7 + 7).map((date, i) => {
                    if (!date) return <View key={i} style={s.gcell} />;
                    const has = (monthByDate[date] || []).length > 0;
                    const isToday = date === today;
                    const isSel = date === selDay;
                    return (
                      <Pressable
                        key={i}
                        onPress={() => setSelDay(isSel ? null : date)}
                        style={[s.gcell, has && s.gcellHas, isToday && s.gcellToday, isSel && s.gcellSel]}
                        testID={`grafik-day-${date}`}
                      >
                        <Text style={[s.gcellNum, has && { color: v2.color.forest, fontWeight: "800" }, isSel && { color: "#fff" }]}>
                          {parseInt(date.slice(-2), 10)}
                        </Text>
                        {has ? <View style={[s.gcellDot, isSel && { backgroundColor: "#fff" }]} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>

            {/* Selected day detail */}
            {selDay ? (
              <View style={{ marginTop: 12 }}>
                <Text style={s.sectionLabel}>
                  {new Date(selDay + "T12:00:00").toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" })}
                </Text>
                {(monthByDate[selDay] || []).length === 0 ? (
                  <View style={s.emptyDay}>
                    <Feather name="coffee" size={18} color={v2.color.sage} />
                    <Text style={s.emptyDayText}>Nie pracujesz tego dnia</Text>
                  </View>
                ) : (monthByDate[selDay] || []).map(ev => (
                  <Pressable key={ev.id} style={s.evRow} onPress={() => router.push(`/moja-impreza/${ev.id}` as any)} testID={`grafik-month-event-${ev.id}`}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.evTitle} numberOfLines={1}>{ev.name}</Text>
                      <Text style={s.evMeta}>
                        {ev.time_start ? `${ev.time_start}${ev.time_end ? `–${ev.time_end}` : ""}` : ""}
                        {ev.my_shift?.role ? ` · ${ev.my_shift.role}` : ""}
                        {ev.my_shift?.hours ? ` · ${ev.my_shift.hours} h` : ""}
                      </Text>
                    </View>
                    <Feather name="chevron-right" size={16} color={v2.color.textSubtle} />
                  </Pressable>
                ))}
              </View>
            ) : null}

            {/* Month shifts list */}
            <View style={s.sectionHead}>
              <Text style={s.sectionLabel}>Twoje zmiany w tym miesiącu ({monthEvents.length})</Text>
            </View>
            {monthEvents.length === 0 ? (
              <View style={s.emptyDay}>
                <Feather name="calendar" size={20} color={v2.color.sage} />
                <Text style={s.emptyDayText}>Brak zmian w tym miesiącu</Text>
              </View>
            ) : monthEvents.map(ev => (
              <Pressable key={ev.id} style={s.evRow} onPress={() => router.push(`/moja-impreza/${ev.id}` as any)}>
                <View style={s.dateBox}>
                  <Text style={s.dateBoxDay}>{ev.date.slice(-2)}</Text>
                  <Text style={s.dateBoxMon}>{dow(ev.date)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.evTitle} numberOfLines={1}>{ev.name}</Text>
                  <Text style={s.evMeta}>
                    {ev.time_start ? `${ev.time_start}${ev.time_end ? `–${ev.time_end}` : ""}` : ""}
                    {ev.my_shift?.hours ? ` · ${ev.my_shift.hours} h` : ""}
                  </Text>
                </View>
                {ev.date === today ? (
                  <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: v2.color.mint }}>
                    <Text style={{ color: v2.color.forest, fontSize: 9, fontWeight: "800" }}>DZIŚ</Text>
                  </View>
                ) : null}
                <Feather name="chevron-right" size={16} color={v2.color.textSubtle} />
              </Pressable>
            ))}
          </>
        ) : (
        <>

        {/* TODAY card */}
        <View style={s.sectionHead}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={s.todayDot} />
            <Text style={s.sectionLabel}>Dzisiaj</Text>
            <Text style={s.sectionDate}>{dow(today)} · {today.slice(-2)}.{today.slice(5, 7)}</Text>
          </View>
        </View>
        {todayEvent ? (
          <View style={[s.card, { borderColor: v2.color.forest + "44" }]}>
            {renderEventDetail(todayEvent)}
            {renderChecklistSnapshot(todayChecklist, todayEvent.id)}
            <Pressable testID="today-event-card-link" onPress={() => router.push(`/moja-impreza/${todayEvent.id}` as any)} style={cardLinkStyle}>
              <Feather name="clipboard" size={13} color={v2.color.forest} />
              <Text style={cardLinkTextStyle}>Otwórz kartę imprezy ›</Text>
            </Pressable>
          </View>
        ) : (
          <View style={s.emptyDay}>
            <Feather name="coffee" size={24} color={v2.color.sage} />
            <Text style={s.emptyDayText}>Nie masz dziś zaplanowanej pracy</Text>
            <Text style={s.emptyDaySub}>Ciesz się wolnym dniem ☕</Text>
          </View>
        )}

        {/* TOMORROW section */}
        <View style={s.sectionHead}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={[s.todayDot, { backgroundColor: v2.color.info }]} />
            <Text style={s.sectionLabel}>Jutro</Text>
            <Text style={s.sectionDate}>{dow(tomorrow)} · {tomorrow.slice(-2)}.{tomorrow.slice(5, 7)}</Text>
          </View>
        </View>
        {tomorrowEvent ? (
          <View style={[s.card, { borderColor: v2.color.info + "44" }]}>
            {renderEventDetail(tomorrowEvent)}
            {renderChecklistSnapshot(tomorrowChecklist, tomorrowEvent.id)}
            <Pressable testID="tomorrow-event-card-link" onPress={() => router.push(`/moja-impreza/${tomorrowEvent.id}` as any)} style={cardLinkStyle}>
              <Feather name="clipboard" size={13} color={v2.color.forest} />
              <Text style={cardLinkTextStyle}>Otwórz kartę imprezy ›</Text>
            </Pressable>
          </View>
        ) : (
          <View style={s.emptyDay}>
            <Feather name="moon" size={20} color={v2.color.sage} />
            <Text style={s.emptyDayText}>Brak imprez jutro</Text>
          </View>
        )}

        {/* Upcoming shifts */}
        <View style={s.sectionHead}>
          <Text style={s.sectionLabel}>Nadchodzące ({upcoming.length})</Text>
        </View>
        {upcoming.length === 0 ? (
          <View style={s.emptyDay}>
            <Feather name="calendar" size={20} color={v2.color.sage} />
            <Text style={s.emptyDayText}>Brak zaplanowanych zmian</Text>
          </View>
        ) : upcoming.map(ev => (
          <Pressable key={ev.id} style={s.evRow} onPress={() => router.push(`/moja-impreza/${ev.id}` as any)} testID={`upcoming-event-${ev.id}`}>
            <View style={s.dateBox}>
              <Text style={s.dateBoxDay}>{ev.date.slice(-2)}</Text>
              <Text style={s.dateBoxMon}>{dow(ev.date)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.evTitle} numberOfLines={1}>{ev.name}</Text>
              <Text style={s.evMeta}>
                {ev.time_start ? `${ev.time_start}${ev.time_end ? `–${ev.time_end}` : ""}` : ""}
                {ev.my_shift?.role ? ` · ${ev.my_shift.role}` : ""}
                {ev.people ? ` · ${ev.people} os.` : ""}
              </Text>
            </View>
            {isSameDay(ev.date, today) ? (
              <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: v2.color.mint }}>
                <Text style={{ color: v2.color.forest, fontSize: 9, fontWeight: "800" }}>DZIŚ</Text>
              </View>
            ) : null}
            <Feather name="chevron-right" size={16} color={v2.color.textSubtle} />
          </Pressable>
        ))}
        </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  rootLoading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: v2.color.bg },

  // View toggle + month view
  viewToggle: {
    flexDirection: "row", gap: 6, marginBottom: 14, padding: 4,
    backgroundColor: v2.color.card, borderRadius: 12, borderWidth: 1, borderColor: v2.color.border,
  },
  viewToggleBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 9, borderRadius: 9,
  },
  viewToggleBtnActive: { backgroundColor: v2.color.forest },
  viewToggleText: { color: v2.color.forest, fontSize: 13, fontWeight: "800" },
  viewToggleTextActive: { color: "#fff" },
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  monthBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: v2.color.mint, alignItems: "center", justifyContent: "center" },
  monthLabel: { color: v2.color.text, fontSize: 16, fontWeight: "800", textTransform: "capitalize" },
  gridBox: { borderRadius: 14, backgroundColor: v2.color.card, borderWidth: 1, borderColor: v2.color.border, padding: 8 },
  gridHeadText: { flex: 1, textAlign: "center", color: v2.color.textMuted, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  gcell: { flex: 1, aspectRatio: 0.95, alignItems: "center", justifyContent: "center", borderRadius: 8, margin: 1 },
  gcellHas: { backgroundColor: v2.color.mint },
  gcellToday: { borderWidth: 1.5, borderColor: v2.color.forest },
  gcellSel: { backgroundColor: v2.color.forest },
  gcellNum: { color: v2.color.text, fontSize: 13 },
  gcellDot: { width: 5, height: 5, borderRadius: 999, backgroundColor: v2.color.forest, marginTop: 2 },
  planBanner: {
    flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10,
    backgroundColor: v2.color.forest, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10,
  },
  planBannerText: { color: "#fff", fontSize: 13, fontWeight: "900", letterSpacing: 0.3 },
  corrBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 9, borderRadius: 9, backgroundColor: "#FEF3C7", borderWidth: 1, borderColor: "#F59E0B66",
  },
  corrBtnText: { color: "#92400E", fontSize: 11, fontWeight: "800" },
  corrLink: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9, backgroundColor: v2.color.mint, alignItems: "center", justifyContent: "center" },
  corrLinkText: { color: v2.color.forest, fontSize: 11, fontWeight: "800" },

  // Header (dark forest)
  header: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    paddingHorizontal: 20, paddingBottom: 14,
    backgroundColor: v2.color.forestDeep,
  },
  brand: { color: v2.color.moss, letterSpacing: 3, fontSize: 10, fontWeight: "800", marginBottom: 2 },
  title: { color: v2.color.onDark, fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },
  headerBtn: {
    width: 38, height: 38, borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
  },

  // Clock card (floating)
  clockCard: {
    marginTop: -12, marginHorizontal: 0,
    padding: 16, borderRadius: v2.radius.xl,
    backgroundColor: v2.color.card,
    ...v2.shadow.md,
  },
  clockLabel: { color: v2.color.textSubtle, fontSize: 10, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  clockSince: { color: v2.color.text, fontSize: 12, fontWeight: "700" },
  primaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: v2.radius.md,
    backgroundColor: v2.color.forest,
  },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 14, letterSpacing: 0.5 },
  linkBtn: { alignItems: "center", padding: 8, marginTop: 4 },
  linkBtnText: { color: v2.color.forest, fontSize: 12, fontWeight: "700" },

  // Section headers
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 20, marginBottom: 8 },
  sectionLabel: { color: v2.color.text, fontSize: 15, fontWeight: "800" },
  sectionDate: { color: v2.color.textMuted, fontSize: 12, fontWeight: "700", textTransform: "capitalize" },
  todayDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: v2.color.forest },

  // Event card
  card: {
    padding: 14, borderRadius: v2.radius.xl,
    backgroundColor: v2.color.card,
    borderWidth: 1, borderColor: v2.color.border,
    ...v2.shadow.sm,
  },
  eventName: { color: v2.color.text, fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
  metaChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
    backgroundColor: v2.color.mint,
  },
  metaText: { color: v2.color.forest, fontSize: 11, fontWeight: "700" },

  notesBox: {
    flexDirection: "row", gap: 8, marginTop: 10,
    padding: 10, borderRadius: v2.radius.md,
    backgroundColor: v2.color.infoBg,
    borderWidth: 1, borderColor: v2.color.info + "33",
    alignItems: "flex-start",
  },
  notesText: { flex: 1, color: v2.color.text, fontSize: 12, lineHeight: 18 },

  // Checklist snapshot
  checklistBox: {
    marginTop: 12, padding: 12, borderRadius: v2.radius.md,
    backgroundColor: v2.color.cardMuted,
    borderWidth: 1, borderColor: v2.color.border,
  },
  checklistTitle: { color: v2.color.text, fontSize: 12, fontWeight: "800", letterSpacing: 0.3, textTransform: "uppercase" },
  checklistProgress: { color: v2.color.forest, fontSize: 12, fontWeight: "800" },
  progressBg: { height: 5, borderRadius: 3, backgroundColor: v2.color.divider, overflow: "hidden", marginTop: 6 },
  progressFill: { height: "100%", borderRadius: 3, backgroundColor: v2.color.forest },
  checklistItem: { flex: 1, color: v2.color.text, fontSize: 12 },
  checklistMore: { color: v2.color.forest, fontSize: 11, fontWeight: "700", marginTop: 4 },
  checklistEmpty: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 10, padding: 10, borderRadius: v2.radius.md,
    backgroundColor: v2.color.cardMuted,
  },
  checklistEmptyText: { color: v2.color.textMuted, fontSize: 12 },

  // Empty day
  emptyDay: {
    padding: 20, alignItems: "center", gap: 6,
    borderRadius: v2.radius.md,
    backgroundColor: v2.color.card,
    borderWidth: 1, borderColor: v2.color.border, borderStyle: "dashed",
  },
  emptyDayText: { color: v2.color.text, fontSize: 13, fontWeight: "700" },
  emptyDaySub: { color: v2.color.textMuted, fontSize: 11 },

  // Upcoming rows
  evRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 12, marginBottom: 6, borderRadius: v2.radius.md,
    borderWidth: 1, borderColor: v2.color.border,
    backgroundColor: v2.color.card,
  },
  dateBox: {
    width: 44, height: 44, borderRadius: v2.radius.md,
    backgroundColor: v2.color.mint,
    alignItems: "center", justifyContent: "center",
  },
  dateBoxDay: { color: v2.color.forest, fontSize: 16, fontWeight: "800" },
  dateBoxMon: { color: v2.color.forest, fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  evTitle: { color: v2.color.text, fontSize: 14, fontWeight: "800" },
  evMeta: { color: v2.color.textMuted, fontSize: 12, marginTop: 2 },
});

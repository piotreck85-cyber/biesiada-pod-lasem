import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, RefreshControl, Linking, Platform, Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import { theme, formatPLN, MONTHS_PL, initials } from "@/src/theme";
import { api, tokenStore } from "@/src/api";

export default function Statystyki() {
  const insets = useSafeAreaInsets();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [data, setData] = useState<any>(null);
  const [yearData, setYearData] = useState<any>(null);
  const [wages, setWages] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Google Calendar public feed URL
  const [feedUrl, setFeedUrl] = useState<string>("");
  const [feedBusy, setFeedBusy] = useState(false);

  const buildFullFeedUrl = (path: string) => {
    const base = (process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/\/$/, "");
    return `${base}${path}`;
  };

  const loadFeedUrl = useCallback(async () => {
    try {
      const r: any = await api.getCalendarFeedUrl();
      setFeedUrl(buildFullFeedUrl(r.path));
    } catch {}
  }, []);

  const copyFeedUrl = async () => {
    if (!feedUrl) return;
    try {
      await Clipboard.setStringAsync(feedUrl);
      Alert.alert("Skopiowano", "Link został skopiowany do schowka. Wklej go w Google Calendar → Inne kalendarze → Z adresu URL.");
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "Nie udało się skopiować");
    }
  };

  const rotateFeedUrl = async () => {
    setFeedBusy(true);
    try {
      const r: any = await api.rotateCalendarFeedUrl();
      setFeedUrl(buildFullFeedUrl(r.path));
      Alert.alert("Nowy link", "Wygenerowano nowy link. Poprzedni został unieważniony — pamiętaj zaktualizować subskrypcję w Google Calendar.");
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "Nie udało się");
    } finally { setFeedBusy(false); }
  };

  // Google Calendar auto-sync
  const [gcalConnected, setGcalConnected] = useState(false);
  const [gcalConfigured, setGcalConfigured] = useState(true);
  const [gcalCalName, setGcalCalName] = useState<string | null>(null);
  const [gcalBusy, setGcalBusy] = useState(false);

  const loadGcalStatus = useCallback(async () => {
    try {
      const r: any = await api.gcalStatus();
      setGcalConfigured(!!r.configured);
      setGcalConnected(!!r.connected);
      setGcalCalName((r.connection && r.connection.calendar_name) || null);
    } catch {}
  }, []);

  const connectGcal = async () => {
    setGcalBusy(true);
    try {
      const r: any = await api.gcalStart();
      const url = r.authorization_url;
      if (Platform.OS === "web") {
        window.location.assign(url);
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(url, undefined);
      // Refresh status regardless of result
      await loadGcalStatus();
      if (result.type === "success" || result.type === "dismiss") {
        // Give server a moment then show status
        setTimeout(loadGcalStatus, 800);
      }
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "Nie udało się rozpocząć połączenia");
    } finally { setGcalBusy(false); }
  };

  const disconnectGcal = async () => {
    Alert.alert(
      "Rozłączyć Google Calendar?",
      "Aplikacja przestanie zapisywać imprezy w Twoim kalendarzu Google. Istniejące wpisy w Google pozostaną.",
      [
        { text: "Anuluj", style: "cancel" },
        {
          text: "Rozłącz", style: "destructive",
          onPress: async () => {
            setGcalBusy(true);
            try { await api.gcalDisconnect(); await loadGcalStatus(); }
            catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
            finally { setGcalBusy(false); }
          },
        },
      ],
    );
  };

  const backfillGcal = async () => {
    setGcalBusy(true);
    try {
      const r: any = await api.gcalBackfill();
      Alert.alert("Synchronizacja zakończona", `Zapisano ${r.synced} z ${r.total} imprez do Google Calendar${r.failed > 0 ? ` (${r.failed} błędów)` : ""}.`);
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "Nie udało się");
    } finally { setGcalBusy(false); }
  };

  const load = useCallback(async () => {
    try {
      const [stats, w, ystats] = await Promise.all([
        api.stats(year, month + 1),
        api.wages(year, month + 1),
        api.yearStats(year),
      ]);
      setData(stats);
      setWages(w);
      setYearData(ystats);
    } catch {}
  }, [year, month]);

  useFocusEffect(useCallback(() => { setLoading(true); load().finally(() => setLoading(false)); loadFeedUrl(); loadGcalStatus(); }, [load, loadFeedUrl, loadGcalStatus]));

  const prev = () => { if (month === 0) { setMonth(11); setYear(year - 1); } else setMonth(month - 1); };
  const next = () => { if (month === 11) { setMonth(0); setYear(year + 1); } else setMonth(month + 1); };

  const doExport = async () => {
    const token = await tokenStore.get();
    const url = api.exportUrl(year, month + 1);
    if (Platform.OS === "web") {
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const blob = await res.blob();
        const dl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = dl; a.download = `imprezy-${year}-${month + 1}.csv`;
        a.click(); URL.revokeObjectURL(dl);
      } catch {}
    } else {
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const csv = await res.text();
        const path = `${FileSystem.cacheDirectory}imprezy-${year}-${month + 1}.csv`;
        await FileSystem.writeAsStringAsync(path, csv);
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: "text/csv" });
      } catch (e: any) { Alert.alert("Błąd", e.message || "Nie udało się"); }
    }
  };

  const [busyBackup, setBusyBackup] = useState(false);

  const doExportXlsx = async (mode: "month" | "all") => {
    const token = await tokenStore.get();
    const url = mode === "month" ? api.exportXlsxUrl(year, month + 1) : api.exportXlsxUrl();
    const fname = mode === "month"
      ? `eventa-stats-${year}-${String(month + 1).padStart(2, "0")}.xlsx`
      : `eventa-stats.xlsx`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (Platform.OS === "web") {
        const blob = await res.blob();
        const dl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = dl; a.download = fname; a.click(); URL.revokeObjectURL(dl);
      } else {
        const buf = await res.arrayBuffer();
        // Convert to base64 for file write (native)
        const bytes = new Uint8Array(buf);
        let bin = "";
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        // @ts-ignore btoa is available in RN
        const b64 = typeof btoa === "function" ? btoa(bin) : "";
        const path = `${FileSystem.cacheDirectory}${fname}`;
        await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(path, {
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            dialogTitle: fname,
          });
        }
      }
    } catch (e: any) {
      Alert.alert("Błąd eksportu Excel", e.message || "Nie udało się");
    }
  };

  const doImportWhatsAppProfits = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ["text/plain", "*/*"], copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      let text: string;
      if (Platform.OS === "web" && asset.file) text = await asset.file.text();
      else text = await FileSystem.readAsStringAsync(asset.uri);

      // Dry run first — preview
      const preview: any = await api.importWhatsAppProfits(text, true, 7);
      const matched = preview.matched?.length || 0;
      const unmatched = preview.unmatched?.length || 0;
      const skipped = preview.skipped?.length || 0;
      const total = preview.totals?.matched_amount || 0;

      Alert.alert(
        "Podgląd importu zysków WhatsApp",
        `Rozpoznano: ${preview.parsed || 0}\nDopasowanych do imprez: ${matched} (${total.toFixed(2)} zł)\nNiedopasowanych: ${unmatched}\nJuż zaimportowanych wcześniej (pominięte): ${skipped}\n\nZastosować dopasowania?`,
        [
          { text: "Anuluj", style: "cancel" },
          {
            text: "Zastosuj",
            onPress: async () => {
              try {
                const result: any = await api.importWhatsAppProfits(text, false, 7);
                Alert.alert("Import zakończony", `Przypisano zyski do ${result.matched?.length || 0} imprez.`);
                await load();
              } catch (e: any) {
                Alert.alert("Błąd", e.message || "Nie udało się");
              }
            }
          }
        ]
      );
    } catch (e: any) {
      Alert.alert("Błąd", e.message || "Nie udało się");
    }
  };

  const doBackup = async () => {
    setBusyBackup(true);
    try {
      const data: any = await api.backup();
      const json = JSON.stringify(data, null, 2);
      const fname = `eventa-backup-${new Date().toISOString().slice(0, 10)}.json`;
      if (Platform.OS === "web") {
        const blob = new Blob([json], { type: "application/json" });
        const dl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = dl; a.download = fname; a.click(); URL.revokeObjectURL(dl);
      } else {
        const path = `${FileSystem.cacheDirectory}${fname}`;
        await FileSystem.writeAsStringAsync(path, json);
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: "application/json" });
      }
    } catch (e: any) { Alert.alert("Błąd", e.message || "Nie udało się"); }
    finally { setBusyBackup(false); }
  };

  const doImport = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ["application/json", "*/*"], copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      let text: string;
      if (Platform.OS === "web" && asset.file) {
        text = await asset.file.text();
      } else {
        text = await FileSystem.readAsStringAsync(asset.uri);
      }
      let parsed: any;
      try { parsed = JSON.parse(text); }
      catch { Alert.alert("Błąd", "Nieprawidłowy plik JSON"); return; }

      const doImportWithMode = async (mode: string) => {
        try {
          const result: any = await api.importBackup({
            staff: parsed.staff || [],
            events: parsed.events || [],
            templates: parsed.templates || [],
            mode,
          });
          Alert.alert("Import zakończony", `Zaimportowano: ${result.imported.events} imprez, ${result.imported.staff} pracowników, ${result.imported.templates} szablonów.`);
          await load();
        } catch (e: any) { Alert.alert("Błąd", e.message || "Nie udało się"); }
      };

      Alert.alert("Import kopii", "Jak zaimportować dane?", [
        { text: "Anuluj", style: "cancel" },
        { text: "Scal (dodaj/zaktualizuj)", onPress: () => doImportWithMode("merge") },
        { text: "Zastąp wszystko", style: "destructive", onPress: () => doImportWithMode("replace") },
      ]);
    } catch (e: any) { Alert.alert("Błąd", e.message || "Nie udało się"); }
  };

  const doImportIcs = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: Platform.OS === "web" ? "*/*" : ["text/calendar", "*/*"],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      let text: string;
      if (Platform.OS === "web" && asset.file) {
        text = await asset.file.text();
      } else {
        text = await FileSystem.readAsStringAsync(asset.uri);
      }
      if (!text.includes("BEGIN:VCALENDAR") && !text.includes("BEGIN:VEVENT")) {
        Alert.alert("Błąd", "To nie jest prawidłowy plik iCal (.ics)");
        return;
      }
      const result: any = await api.importIcs(text, 5);
      Alert.alert(
        "Import zakończony",
        `Wczytano ${result.total_parsed} wydarzeń z pliku.\nZaimportowano: ${result.imported}.\nPominięto (starsze niż 5 lat): ${result.skipped_older_than_cutoff}.`
      );
      await load();
    } catch (e: any) { Alert.alert("Błąd", e.message || "Nie udało się"); }
  };

  const doImportWhatsApp = async (kind: "expenses" | "revenue") => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ["text/plain", "*/*"], copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      let text: string;
      if (Platform.OS === "web" && asset.file) {
        text = await asset.file.text();
      } else {
        text = await FileSystem.readAsStringAsync(asset.uri);
      }
      const result: any = await api.importWhatsApp(text, kind);
      Alert.alert(
        "Import zakończony",
        kind === "expenses"
          ? `Wczytano ${result.parsed_lines} linii.\nDodano ${result.created} kosztów firmowych.\nPominięto: ${result.skipped}.`
          : `Wczytano ${result.parsed_lines} linii.\nDopisano do ${result.matched_existing_events} istniejących imprez.\nUtworzono ${result.created} nowych imprez.\nPominięto: ${result.skipped}.`
      );
      await load();
    } catch (e: any) { Alert.alert("Błąd", e.message || "Nie udało się"); }
  };

  const doIcsExport = async () => {
    const token = await tokenStore.get();
    const url = api.icsUrl();
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const ics = await res.text();
      const fname = `eventa-kalendarz.ics`;
      if (Platform.OS === "web") {
        const blob = new Blob([ics], { type: "text/calendar" });
        const dl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = dl; a.download = fname; a.click(); URL.revokeObjectURL(dl);
      } else {
        const path = `${FileSystem.cacheDirectory}${fname}`;
        await FileSystem.writeAsStringAsync(path, ics);
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: "text/calendar" });
      }
    } catch (e: any) { Alert.alert("Błąd", e.message || "Nie udało się"); }
  };

  const revenue = data?.revenue || 0;
  const eventCost = data?.total_cost || 0;            // material + labor from shifts
  const companyExpenses = data?.company_expenses || 0; // separate expenses (Koszty tab)
  const totalCost = eventCost + companyExpenses;      // real "total costs"
  const profit = revenue - totalCost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

  // Forecast (planned future) values from backend
  const plannedRevenue = data?.planned_revenue || 0;
  const plannedCost = data?.planned_cost || 0;
  const plannedProfit = data?.planned_profit || 0;
  const projectedRevenue = revenue + plannedRevenue;
  const projectedCost = totalCost + plannedCost;
  const projectedProfit = projectedRevenue - projectedCost;

  const yearRevenue = yearData?.revenue || 0;
  const yearEventCost = yearData?.total_cost || 0;
  const yearCompanyExp = yearData?.company_expenses || 0;
  const yearTotalCost = yearEventCost + yearCompanyExp;
  const yearProfit = yearRevenue - yearTotalCost;
  const yearPlannedRev = yearData?.planned_revenue || 0;
  const yearPlannedCost = yearData?.planned_cost || 0;
  const yearProjectedProfit = (yearRevenue + yearPlannedRev) - (yearTotalCost + yearPlannedCost);

  return (
    <View style={[s.root, { paddingTop: insets.top }]} testID="stats-screen">
      <View style={s.header}>
        <Text style={s.brand}>Statystyki</Text>
        <View style={s.monthNav}>
          <Pressable testID="stats-prev-month" onPress={prev} style={s.navBtn} hitSlop={10}>
            <Feather name="chevron-left" size={20} color={theme.color.onSurface} />
          </Pressable>
          <Text style={s.monthTitle}>{MONTHS_PL[month]} {year}</Text>
          <Pressable testID="stats-next-month" onPress={next} style={s.navBtn} hitSlop={10}>
            <Feather name="chevron-right" size={20} color={theme.color.onSurface} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 120, paddingHorizontal: 20, paddingTop: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={theme.color.brand} />}
      >
        {loading ? (
          <ActivityIndicator color={theme.color.brand} style={{ marginTop: 40 }} />
        ) : (
          <>
            <View style={s.heroCard}>
              <Text style={s.heroLabel}>Całkowity zysk</Text>
              <Text style={[s.heroValue, { color: profit >= 0 ? theme.color.brand : theme.color.error }]}>{formatPLN(profit)}</Text>
              <Text style={s.heroSub}>{data?.event_count || 0} imprez · marża {margin.toFixed(1)}%</Text>
            </View>

            <View style={s.yearCard}>
              <View style={s.yearHeaderRow}>
                <Feather name="award" size={16} color={theme.color.brand} />
                <Text style={s.yearHeader}>Cały rok {year}</Text>
                <Text style={s.yearBadge}>{yearData?.event_count || 0} imprez</Text>
              </View>
              <View style={s.yearGrid}>
                <View style={s.yearCol}>
                  <Text style={s.yearColLabel}>Przychody</Text>
                  <Text style={[s.yearColValue, { color: theme.color.success }]}>{formatPLN(yearRevenue)}</Text>
                </View>
                <View style={s.yearCol}>
                  <Text style={s.yearColLabel}>Koszty</Text>
                  <Text style={[s.yearColValue, { color: theme.color.error }]}>{formatPLN(yearTotalCost)}</Text>
                </View>
                <View style={s.yearCol}>
                  <Text style={s.yearColLabel}>Zysk</Text>
                  <Text style={[s.yearColValue, { color: yearProfit >= 0 ? theme.color.brand : theme.color.error }]}>{formatPLN(yearProfit)}</Text>
                </View>
              </View>
            </View>

            <View style={s.gridRow}>
              <View style={[s.miniCard, { borderColor: "rgba(16,185,129,0.35)" }]}>
                <View style={s.miniHeader}>
                  <Feather name="trending-up" size={14} color={theme.color.success} />
                  <Text style={s.miniLabel}>Przychody</Text>
                </View>
                <Text style={s.miniValue}>{formatPLN(revenue)}</Text>
              </View>
              <View style={[s.miniCard, { borderColor: "rgba(239,68,68,0.35)" }]}>
                <View style={s.miniHeader}>
                  <Feather name="trending-down" size={14} color={theme.color.error} />
                  <Text style={s.miniLabel}>Koszty</Text>
                </View>
                <Text style={s.miniValue}>{formatPLN(totalCost)}</Text>
              </View>
            </View>

            <View style={s.breakdownCard}>
              <Text style={s.sectionTitle}>Podział kosztów</Text>
              <BreakdownRow label="Materiałowe (imprezy)" value={data?.material_cost || 0} />
              <BreakdownRow label="Praca (zmiany z grafiku)" value={data?.labor_cost || 0} />
              <BreakdownRow label="Firmowe (Koszty tab)" value={companyExpenses} />
              <View style={s.sep} />
              <BreakdownRow label="Razem" value={totalCost} bold />
            </View>

            {/* Forecast card — planned from tentative offers ("wstepne") */}
            <View style={[s.breakdownCard, { borderColor: theme.color.brand + "44", backgroundColor: theme.color.brand + "0A" }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Feather name="target" size={14} color={theme.color.brand} />
                <Text style={s.sectionTitle}>Prognoza z ofert — {MONTHS_PL[month]} {year}</Text>
              </View>
              <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 11, marginBottom: 6 }}>
                Bazuje wyłącznie na imprezach ze statusem „wstępne zapytanie" (oferty).
              </Text>
              <BreakdownRow label="Planowany przychód (z ofert)" value={plannedRevenue} />
              <BreakdownRow label="Planowany koszt (estymowany)" value={plannedCost} />
              <BreakdownRow label="Planowany zysk" value={plannedProfit} bold />
              <View style={s.sep} />
              <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4 }}>
                <Text style={{ flex: 1, color: theme.color.onSurfaceSecondary, fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase" }}>Prognoza łącznie (rzecz. + oferty)</Text>
              </View>
              <BreakdownRow label="Przychód razem" value={projectedRevenue} />
              <BreakdownRow label="Koszt razem" value={projectedCost} />
              <BreakdownRow label="Zysk razem" value={projectedProfit} bold />
            </View>

            {/* Forecast for full year */}
            <View style={[s.breakdownCard, { borderColor: theme.color.warning + "55", backgroundColor: theme.color.warning + "0A" }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Feather name="trending-up" size={14} color={theme.color.warning} />
                <Text style={s.sectionTitle}>Prognoza — cały rok {year}</Text>
              </View>
              <BreakdownRow label="Planowany przychód (z ofert)" value={yearPlannedRev} />
              <BreakdownRow label="Planowany koszt (estymowany)" value={yearPlannedCost} />
              <View style={s.sep} />
              <BreakdownRow label="Zysk prognozowany (rzecz. + oferty)" value={yearProjectedProfit} bold />
            </View>

            <Pressable testID="export-csv-btn" onPress={doExport} style={s.exportBtn}>
              <Feather name="download" size={18} color={theme.color.brand} />
              <Text style={s.exportText}>Eksportuj miesiąc do CSV</Text>
            </Pressable>

            <Pressable testID="export-xlsx-month-btn" onPress={() => doExportXlsx("month")} style={s.exportBtn}>
              <Feather name="grid" size={18} color={theme.color.brand} />
              <Text style={s.exportText}>Eksport Excel — {MONTHS_PL[month]} {year}</Text>
            </Pressable>

            <Pressable testID="export-xlsx-all-btn" onPress={() => doExportXlsx("all")} style={s.exportBtn}>
              <Feather name="grid" size={18} color={theme.color.brand} />
              <Text style={s.exportText}>Eksport Excel — wszystkie statystyki</Text>
            </Pressable>

            <Pressable testID="wa-profits-import-btn" onPress={doImportWhatsAppProfits} style={s.exportBtn}>
              <Feather name="message-circle" size={18} color={theme.color.brand} />
              <Text style={s.exportText}>Importuj zyski z WhatsApp</Text>
            </Pressable>

            <View style={s.backupCard}>
              <Text style={s.backupTitle}>Kalendarz — kopia zapasowa</Text>
              <Text style={s.backupSub}>Eksportuj wszystkie dane lub zaimportuj wcześniejszą kopię.</Text>
              <View style={s.backupRow}>
                <Pressable testID="ics-export-btn" onPress={doIcsExport} style={s.backupBtn}>
                  <Feather name="calendar" size={16} color={theme.color.brand} />
                  <Text style={s.backupBtnText}>Eksport iCal</Text>
                </Pressable>
                <Pressable testID="ics-import-btn" onPress={doImportIcs} style={s.backupBtn}>
                  <Feather name="calendar" size={16} color={theme.color.brand} />
                  <Text style={s.backupBtnText}>Import iCal (5 lat)</Text>
                </Pressable>
                <Pressable testID="backup-export-btn" onPress={doBackup} disabled={busyBackup} style={[s.backupBtn, busyBackup && { opacity: 0.5 }]}>
                  {busyBackup ? <ActivityIndicator size="small" color={theme.color.brand} /> : <Feather name="upload" size={16} color={theme.color.brand} />}
                  <Text style={s.backupBtnText}>Eksport JSON</Text>
                </Pressable>
                <Pressable testID="backup-import-btn" onPress={doImport} style={s.backupBtn}>
                  <Feather name="download" size={16} color={theme.color.brand} />
                  <Text style={s.backupBtnText}>Import JSON</Text>
                </Pressable>
                <Pressable testID="wa-expenses-btn" onPress={() => doImportWhatsApp("expenses")} style={s.backupBtn}>
                  <Feather name="message-square" size={16} color={theme.color.brand} />
                  <Text style={s.backupBtnText}>WhatsApp koszty</Text>
                </Pressable>
                <Pressable testID="wa-revenue-btn" onPress={() => doImportWhatsApp("revenue")} style={s.backupBtn}>
                  <Feather name="message-square" size={16} color={theme.color.brand} />
                  <Text style={s.backupBtnText}>WhatsApp zyski</Text>
                </Pressable>
              </View>
            </View>

            {/* Google Calendar OAuth auto-sync (app → Google, real-time) */}
            <View style={s.gcalCard}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <Feather name="refresh-cw" size={16} color={theme.color.brand} />
                <Text style={s.backupTitle}>Google Calendar — natychmiastowy sync (aplikacja → Google)</Text>
              </View>
              {!gcalConfigured ? (
                <Text style={s.backupSub}>
                  Integracja niedostępna — brakuje konfiguracji po stronie serwera. Skontaktuj się z administratorem.
                </Text>
              ) : gcalConnected ? (
                <>
                  <Text style={s.backupSub}>
                    ✅ Połączono z kalendarzem {gcalCalName ? `„${gcalCalName}”` : "Google"}. Każde utworzenie, edycja i usunięcie imprezy w aplikacji automatycznie synchronizuje się z Twoim Google Calendar.
                  </Text>
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    <Pressable testID="gcal-oauth-backfill-btn" onPress={backfillGcal} style={[s.backupBtn, gcalBusy && { opacity: 0.5 }]} disabled={gcalBusy}>
                      {gcalBusy ? <ActivityIndicator size="small" color={theme.color.brand} /> : <Feather name="upload-cloud" size={16} color={theme.color.brand} />}
                      <Text style={s.backupBtnText}>Wyślij wszystkie do Google</Text>
                    </Pressable>
                    <Pressable testID="gcal-oauth-disconnect-btn" onPress={disconnectGcal} style={[s.backupBtn, gcalBusy && { opacity: 0.5 }]} disabled={gcalBusy}>
                      <Feather name="link-2" size={16} color={theme.color.brand} />
                      <Text style={s.backupBtnText}>Rozłącz</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  <Text style={s.backupSub}>
                    Połącz swoje konto Google, żeby każda impreza z aplikacji zapisywała się natychmiast w Twoim Google Calendar w dedykowanym kalendarzu „Biesiada pod Lasem”. Utworzenie, edycja i usunięcie działają w obie strony.
                  </Text>
                  <Pressable testID="gcal-oauth-connect-btn" onPress={connectGcal} style={[s.backupBtn, gcalBusy && { opacity: 0.5 }]} disabled={gcalBusy}>
                    {gcalBusy ? <ActivityIndicator size="small" color={theme.color.brand} /> : <Feather name="log-in" size={16} color={theme.color.brand} />}
                    <Text style={s.backupBtnText}>Połącz Google Calendar</Text>
                  </Pressable>
                </>
              )}
            </View>

            {/* Google Calendar subscription (fallback: ICS URL) */}
            <View style={s.gcalCard}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <Feather name="calendar" size={16} color={theme.color.brand} />
                <Text style={s.backupTitle}>Google Calendar — auto-sync</Text>
              </View>
              <Text style={s.backupSub}>
                Wklej ten link w Google Calendar → Inne kalendarze → „Z adresu URL”. Google odświeży wydarzenia automatycznie (co ~8-24h). Link jest prywatny — nie udostępniaj nikomu.
              </Text>
              <View style={s.gcalUrlBox} testID="gcal-url-box">
                <Text style={s.gcalUrlText} numberOfLines={2} selectable>
                  {feedUrl || "Ładowanie…"}
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Pressable testID="gcal-copy-btn" onPress={copyFeedUrl} style={s.backupBtn} disabled={!feedUrl}>
                  <Feather name="copy" size={16} color={theme.color.brand} />
                  <Text style={s.backupBtnText}>Kopiuj link</Text>
                </Pressable>
                <Pressable
                  testID="gcal-open-btn"
                  onPress={() => Linking.openURL("https://calendar.google.com/calendar/u/0/r/settings/addbyurl")}
                  style={s.backupBtn}
                >
                  <Feather name="external-link" size={16} color={theme.color.brand} />
                  <Text style={s.backupBtnText}>Otwórz Google Calendar</Text>
                </Pressable>
                <Pressable
                  testID="gcal-rotate-btn"
                  onPress={() => Alert.alert(
                    "Wygenerować nowy link?",
                    "Poprzedni link przestanie działać. Będziesz musiał ponownie dodać kalendarz w Google.",
                    [
                      { text: "Anuluj", style: "cancel" },
                      { text: "Wygeneruj", style: "destructive", onPress: rotateFeedUrl },
                    ]
                  )}
                  style={[s.backupBtn, feedBusy && { opacity: 0.5 }]}
                  disabled={feedBusy}
                >
                  {feedBusy ? <ActivityIndicator size="small" color={theme.color.brand} /> : <Feather name="refresh-cw" size={16} color={theme.color.brand} />}
                  <Text style={s.backupBtnText}>Nowy link</Text>
                </Pressable>
              </View>
            </View>

            <Text style={[s.sectionTitle, { marginTop: 24 }]}>Wypłaty pracowników</Text>
            {(wages?.staff || []).length === 0 ? (
              <View style={s.emptyBox}>
                <Text style={s.emptyText}>Brak zmian pracowników w tym miesiącu</Text>
              </View>
            ) : (
              <>
                {(wages.staff as any[]).map((w) => (
                  <View key={w.staff_id} style={s.wageRow} testID={`wage-${w.staff_id}`}>
                    <View style={s.avatar}><Text style={s.avatarText}>{initials(w.name)}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.wageName}>{w.name}</Text>
                      <Text style={s.wageMeta}>
                        {(w.role || "—")}  ·  {w.hours.toFixed(1)} h  ·  {formatPLN(w.hourly_rate)}/h
                      </Text>
                    </View>
                    <Text style={s.wageAmount}>{formatPLN(w.amount)}</Text>
                  </View>
                ))}
                <View style={s.wageTotal}>
                  <Text style={s.wageTotalLabel}>Suma wypłat</Text>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={s.wageTotalHours}>{(wages?.total_hours || 0).toFixed(1)} h</Text>
                    <Text style={s.wageTotalAmount}>{formatPLN(wages?.total_amount || 0)}</Text>
                  </View>
                </View>
              </>
            )}

            <Text style={[s.sectionTitle, { marginTop: 24 }]}>Impreza po imprezie</Text>
            {(data?.events || []).length === 0 ? (
              <View style={s.emptyBox}>
                <Text style={s.emptyText}>Brak imprez w tym miesiącu</Text>
              </View>
            ) : (
              (data.events as any[]).map((e) => (
                <View key={e.id} style={s.evRow} testID={`stats-event-${e.id}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.evName}>{e.name}</Text>
                    <Text style={s.evDate}>{e.date}</Text>
                  </View>
                  <Text style={[s.evProfit, { color: e.profit >= 0 ? theme.color.brand : theme.color.error }]}>{formatPLN(e.profit)}</Text>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function BreakdownRow({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <View style={s.brRow}>
      <Text style={[s.brLabel, bold && { color: theme.color.onSurface, fontWeight: "700" }]}>{label}</Text>
      <Text style={[s.brValue, bold && { color: theme.color.onSurface, fontWeight: "700", fontSize: 16 }]}>{formatPLN(value)}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: 20, paddingBottom: 12, paddingTop: 8, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  brand: { color: theme.color.onSurfaceSecondary, letterSpacing: 3, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthTitle: { color: theme.color.onSurface, fontSize: 22, fontWeight: "700" },
  navBtn: { padding: 8, backgroundColor: theme.color.surfaceSecondary, borderRadius: 999 },
  heroCard: {
    backgroundColor: theme.color.surfaceSecondary, borderRadius: 20, padding: 22,
    borderWidth: 1, borderColor: theme.color.brandTertiary, marginBottom: 12,
  },
  heroLabel: { color: theme.color.onSurfaceSecondary, fontSize: 12, letterSpacing: 2, marginBottom: 6 },
  heroValue: { color: theme.color.brand, fontSize: 44, fontWeight: "800", letterSpacing: -1 },
  heroSub: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 6 },
  yearCard: {
    backgroundColor: theme.color.surfaceSecondary, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: theme.color.brandTertiary, marginBottom: 12,
  },
  yearHeaderRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  yearHeader: { color: theme.color.onSurface, fontSize: 14, fontWeight: "800", flex: 1 },
  yearBadge: {
    color: theme.color.brand, fontSize: 11, fontWeight: "700",
    borderWidth: 1, borderColor: theme.color.brand, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
  },
  yearGrid: { flexDirection: "row", gap: 8 },
  yearCol: { flex: 1 },
  yearColLabel: { color: theme.color.onSurfaceSecondary, fontSize: 10, letterSpacing: 1, marginBottom: 4 },
  yearColValue: { color: theme.color.onSurface, fontSize: 15, fontWeight: "800" },
  gridRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  miniCard: {
    flex: 1, backgroundColor: theme.color.surfaceSecondary, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: theme.color.border,
  },
  miniHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  miniLabel: { color: theme.color.onSurfaceSecondary, fontSize: 12, fontWeight: "600" },
  miniValue: { color: theme.color.onSurface, fontSize: 18, fontWeight: "700" },
  breakdownCard: {
    backgroundColor: theme.color.surfaceSecondary, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: theme.color.border, marginTop: 4,
  },
  sectionTitle: { color: theme.color.onSurface, fontSize: 15, fontWeight: "700", marginBottom: 12 },
  brRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  brLabel: { color: theme.color.onSurfaceSecondary, fontSize: 14 },
  brValue: { color: theme.color.onSurfaceTertiary, fontSize: 14 },
  sep: { height: 1, backgroundColor: theme.color.divider, marginVertical: 6 },
  exportBtn: {
    marginTop: 16, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.color.brand,
  },
  exportText: { color: theme.color.brand, fontWeight: "700", fontSize: 15 },
  backupCard: {
    marginTop: 16, backgroundColor: theme.color.surfaceSecondary, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: theme.color.border,
  },
  backupTitle: { color: theme.color.onSurface, fontSize: 14, fontWeight: "700", marginBottom: 4 },
  backupSub: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginBottom: 12 },
  backupRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  backupBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 999, borderWidth: 1, borderColor: theme.color.brandTertiary,
    backgroundColor: "rgba(212,175,55,0.06)",
  },
  backupBtnText: { color: theme.color.brand, fontWeight: "700", fontSize: 12 },
  gcalCard: {
    marginTop: 12, backgroundColor: theme.color.surfaceSecondary, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: theme.color.border,
  },
  gcalUrlBox: {
    backgroundColor: theme.color.surface, borderRadius: 10, padding: 12, marginBottom: 12,
    borderWidth: 1, borderColor: theme.color.border,
  },
  gcalUrlText: { color: theme.color.onSurface, fontSize: 11, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) },
  evRow: {
    flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: theme.color.surfaceSecondary, borderRadius: 12, marginBottom: 6,
    borderWidth: 1, borderColor: theme.color.border,
  },
  evName: { color: theme.color.onSurface, fontSize: 14, fontWeight: "600" },
  evDate: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  evProfit: { fontSize: 15, fontWeight: "700" },
  emptyBox: { padding: 20, alignItems: "center" },
  emptyText: { color: theme.color.onSurfaceSecondary },
  wageRow: {
    flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: theme.color.surfaceSecondary, borderRadius: 12, marginBottom: 6,
    borderWidth: 1, borderColor: theme.color.border,
  },
  avatar: {
    width: 38, height: 38, borderRadius: 999, backgroundColor: theme.color.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: theme.color.onBrandTertiary, fontWeight: "700", fontSize: 12 },
  wageName: { color: theme.color.onSurface, fontSize: 14, fontWeight: "700" },
  wageMeta: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  wageAmount: { color: theme.color.brand, fontSize: 15, fontWeight: "700" },
  wageTotal: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginTop: 6, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.color.brandTertiary,
    backgroundColor: "rgba(212,175,55,0.06)",
  },
  wageTotalLabel: { color: theme.color.onSurface, fontSize: 14, fontWeight: "700" },
  wageTotalHours: { color: theme.color.brand, fontSize: 18, fontWeight: "800" },
  wageTotalAmount: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
});

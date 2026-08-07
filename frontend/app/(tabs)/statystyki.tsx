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
import { theme, formatPLN, MONTHS_PL, initials } from "@/src/theme";
import { api } from "@/src/api";
import { tokenStore } from "@/src/api";

export default function Statystyki() {
  const insets = useSafeAreaInsets();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [data, setData] = useState<any>(null);
  const [wages, setWages] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [stats, w] = await Promise.all([
        api.stats(year, month + 1),
        api.wages(year, month + 1),
      ]);
      setData(stats);
      setWages(w);
    } catch {}
  }, [year, month]);

  useFocusEffect(useCallback(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]));

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
  const totalCost = data?.total_cost || 0;
  const profit = data?.profit || 0;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

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
              <BreakdownRow label="Materiałowe" value={data?.material_cost || 0} />
              <BreakdownRow label="Praca (pracownicy)" value={data?.labor_cost || 0} />
              <View style={s.sep} />
              <BreakdownRow label="Razem" value={totalCost} bold />
            </View>

            <Pressable testID="export-csv-btn" onPress={doExport} style={s.exportBtn}>
              <Feather name="download" size={18} color={theme.color.brand} />
              <Text style={s.exportText}>Eksportuj miesiąc do CSV</Text>
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

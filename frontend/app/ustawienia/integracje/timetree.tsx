import { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@/src/api';
import { useAuth } from '@/src/auth';
import { v2 } from '@/src/designTokensV2';

type Run = { id: string; started_at: string; status: string; trigger: string; fetched: number; added: number; updated: number; unchanged: number; skipped: number; missing: number; errors: number; error?: string };
type Status = { queued: boolean; use_worker: boolean; worker_running: boolean; worker_seen_at?: string; status: string; configured: boolean; running: boolean; error?: string; calendar_name?: string; last_success_at?: string; last_attempt_at?: string; next_scheduled_at?: string; scheduler_running: boolean; last_run?: Run; history: Run[]; workspace_id: string };
const stamp = (value?: string) => value ? new Date(value).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' }) : '—';
function Counts({ run }: { run: Run }) {
  return <View style={s.counts}>{[['Pobrano', run.fetched], ['Dodano', run.added], ['Zaktualizowano', run.updated], ['Bez zmian', run.unchanged], ['Pominięto', run.skipped], ['Brak w TimeTree', run.missing], ['Błędy', run.errors]].map(([label, count]) => <View key={label} style={s.count}><Text style={s.number}>{count}</Text><Text style={s.muted}>{label}</Text></View>)}</View>;
}
export default function TimeTreeSettings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, loading } = useAuth();
  const owner = !!user && user.role !== 'staff' && user.id === (user.workspace_id || user.id);
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (!owner || loading) return;
    const current = generation.current;
    try { const result = await api.timeTreeStatus() as Status; if (current === generation.current) { setData(result); setError(''); } }
    catch (e: any) { if (current === generation.current) setError(e.message || 'Nie udało się pobrać statusu.'); }
  }, [owner, loading, user?.id]);
  useFocusEffect(useCallback(() => {
    generation.current++; setData(null); void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => { generation.current++; clearInterval(timer); };
  }, [refresh]));
  const synchronize = async () => {
    const current = generation.current;
    setBusy(true); setError('');
    try { await api.timeTreeSync(); }
    catch (e: any) { if (current === generation.current) setError(e.message || 'Nie udało się uruchomić synchronizacji.'); }
    finally { if (current === generation.current) { setBusy(false); await refresh(); } }
  };
  return <View style={[s.root, { paddingTop: insets.top + 16 }]}>
    <View style={s.header}><Pressable accessibilityRole="button" onPress={() => router.back()}><Text style={s.link}>← Integracje</Text></Pressable><Text style={s.title}>TimeTree</Text></View>
    {loading ? <ActivityIndicator /> : !owner ? <Text style={s.message}>Ten panel jest dostępny tylko dla właściciela.</Text> : <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: insets.bottom + 40 }}>
      {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      {!data ? <Pressable accessibilityRole="button" onPress={refresh}><Text style={s.link}>Odśwież status</Text></Pressable> : <>
        <View style={s.card}>
          <Text style={s.heading}>{data.status}</Text>
          <Text style={s.body}>Kalendarz: {data.calendar_name || '—'}</Text>
          <Text style={s.body}>Ostatnia udana synchronizacja: {stamp(data.last_success_at)}</Text>
          <Text style={s.body}>Ostatnia próba: {stamp(data.last_attempt_at)}</Text>
          <Text style={s.body}>Synchronizacja co godzinę</Text>
          <Text style={s.muted}>{data.use_worker ? (data.worker_running ? `Worker działa. Ostatni sygnał: ${stamp(data.worker_seen_at)}` : 'Worker nie zgłasza gotowości. Sprawdź jego uruchomienie na hostingu.') : data.scheduler_running ? `Scheduler backendu działa. Następne uruchomienie: ${stamp(data.next_scheduled_at)}` : 'Scheduler backendu nie działa. Jeśli używasz osobnego workera, sprawdź jego historię poniżej.'}</Text>
          {!!data.error && <Text accessibilityRole="alert" style={s.error}>{data.error}</Text>}
          {data.queued && <Text style={s.body}>Synchronizacja oczekuje na worker.</Text>}
          {data.running && <Text style={s.body}>Trwa synchronizacja… Status odświeża się automatycznie.</Text>}
          <Pressable testID="timetree-sync-now" accessibilityRole="button" accessibilityState={{ disabled: busy || data.running || data.queued || !data.configured }} disabled={busy || data.running || data.queued || !data.configured} onPress={synchronize} style={[s.button, (busy || data.running || data.queued || !data.configured) && { opacity: 0.5 }]}>
            <Text style={s.buttonText}>{busy || data.running || data.queued ? 'Synchronizowanie…' : 'Synchronizuj teraz'}</Text>
          </Pressable>
          <Text style={s.muted}>Dane klienta, finanse, menu, zespół i checklisty pozostają w Biesiadzie. Brak wydarzenia w TimeTree nie powoduje usunięcia.</Text>
          {!data.configured && <Text selectable style={s.muted}>Identyfikator właściciela do konfiguracji hostingu: {data.workspace_id}. Dane logowania ustaw wyłącznie jako secrets backendu.</Text>}
        </View>
        {data.last_run && <View style={s.card}><Text style={s.heading}>Ostatnia próba</Text><Counts run={data.last_run} /></View>}
        <Text style={s.heading}>Historia synchronizacji</Text>
        {!data.history.length && <Text style={s.muted}>Nie uruchomiono jeszcze synchronizacji.</Text>}
        {data.history.map(run => <View key={run.id} style={s.card}>
          <Text style={s.body}>{stamp(run.started_at)}</Text>
          <Text style={s.muted}>{run.trigger === 'scheduled' ? 'Automatyczna' : run.trigger === 'worker' ? 'Worker' : 'Ręczna'} · {run.status === 'success' ? 'Zakończono' : run.status === 'running' ? 'W trakcie' : 'Błąd'}</Text>
          <Counts run={run} />{!!run.error && <Text style={s.error}>{run.error}</Text>}
        </View>)}
      </>}
    </ScrollView>}
  </View>;
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: v2.color.bg }, header: { paddingHorizontal: 20, gap: 12 }, title: { color: v2.color.forest, fontSize: 26, fontWeight: '800' },
  link: { color: v2.color.forest, fontSize: 16 }, card: { backgroundColor: v2.color.card, borderRadius: 14, padding: 18, gap: 12 },
  heading: { fontSize: 18, fontWeight: '700', color: v2.color.text }, body: { fontSize: 16, color: v2.color.text, lineHeight: 23 }, muted: { fontSize: 14, color: v2.color.textMuted, lineHeight: 21 },
  message: { padding: 20, fontSize: 16, color: v2.color.text }, error: { color: '#a52621', fontSize: 14, lineHeight: 21 }, button: { padding: 16, backgroundColor: v2.color.forest, borderRadius: 12, alignItems: 'center' }, buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  counts: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 }, count: { minWidth: 100 }, number: { fontSize: 22, fontWeight: '700', color: v2.color.forest },
});

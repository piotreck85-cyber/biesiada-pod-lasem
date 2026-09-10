import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { v2 } from '@/src/designTokensV2';
const labels: Record<string, string> = { name: 'Nazwa', date: 'Data', time_start: 'Początek', time_end: 'Koniec', end_date: 'Data zakończenia', notes: 'Opis/notatka', venue: 'Lokalizacja', all_day: 'Cały dzień' };
export default function TimeTreeEventInfo({ event, values }: { event: any; values: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  if (event?.external_source !== 'timetree') return null;
  const source = event.timetree_source || {};
  const manual = new Set(event.timetree_manual_fields || []);
  const show = (value: unknown) => typeof value === 'boolean' ? (value ? 'Tak' : 'Nie') : String(value || '—');
  return <View testID="timetree-event-source" style={{ backgroundColor: v2.color.card, borderRadius: 14, padding: 16, gap: 12, marginBottom: 16 }}>
    <Text style={{ color: v2.color.forest, fontSize: 18, fontWeight: '700' }}>Dane z TimeTree</Text>
    {event.missing_in_timetree && <Text accessibilityRole="alert" style={{ color: '#a52621', fontSize: 16 }}>To wydarzenie nie występuje już w TimeTree</Text>}
    <Text style={{ fontSize: 14, color: v2.color.textMuted }}>Ręczne zmiany w formularzu są chronione przed kolejną synchronizacją. Klient, ceny, zaliczki, koszty, menu, zespół i checklisty są danymi Biesiady.</Text>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)}><Text style={{ color: v2.color.forest, fontSize: 16 }}>{expanded ? 'Ukryj porównanie' : 'Porównaj dane TimeTree i Biesiady'}</Text></Pressable>
    {expanded && Object.entries(labels).map(([key, label]) => {
      const local = key in values ? values[key] : event[key];
      const protectedField = manual.has(key) || local !== source[key];
      return <View key={key} style={{ gap: 4 }}>
        <Text style={{ color: v2.color.text, fontSize: 14, fontWeight: '700' }}>{label} · {protectedField ? 'Ręcznie w Biesiadzie' : 'TimeTree'}</Text>
        <Text selectable style={{ color: v2.color.textMuted, fontSize: 14 }}>{show(local)}</Text>
        {protectedField && <Text selectable style={{ color: v2.color.forest, fontSize: 14 }}>TimeTree: {show(source[key])}</Text>}
      </View>;
    })}
    <Text style={{ fontSize: 14, color: v2.color.textMuted }}>Ostatni zapis synchronizacji: {event.last_synced_at ? new Date(event.last_synced_at).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' }) : '—'}. Wynik najnowszego sprawdzenia: Ustawienia → Integracje → TimeTree.</Text>
    {!!Object.keys(event.timetree_recurrence || {}).length && <Text style={{ fontSize: 14, color: v2.color.textMuted }}>Wydarzenie cykliczne. Zachowano regułę z ICS; karta pokazuje termin bazowy serii.</Text>}
  </View>;
}

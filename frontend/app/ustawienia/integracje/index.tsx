import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/src/auth';
import { v2 } from '@/src/designTokensV2';
export default function Integrations() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const owner = !!user && user.role !== 'staff' && user.id === (user.workspace_id || user.id);
  return <View style={{ flex: 1, padding: 20, paddingTop: insets.top + 20, gap: 18, backgroundColor: v2.color.bg }}>
    <Pressable accessibilityRole="button" onPress={() => router.back()}><Text style={{ color: v2.color.forest }}>← Ustawienia</Text></Pressable>
    <Text style={{ fontSize: 24, fontWeight: '800', color: v2.color.text }}>Integracje</Text>
    {owner ? <Pressable accessibilityRole="button" onPress={() => router.push('/ustawienia/integracje/timetree' as any)} style={{ padding: 20, borderRadius: 14, backgroundColor: v2.color.card }}>
      <Text style={{ color: v2.color.forest, fontSize: 18, fontWeight: '700' }}>TimeTree →</Text>
      <Text style={{ color: v2.color.textMuted, marginTop: 8, fontSize: 14 }}>Automatyczna synchronizacja kalendarza</Text>
    </Pressable> : <Text style={{ color: v2.color.text }}>Integracje są dostępne tylko dla właściciela.</Text>}
  </View>;
}

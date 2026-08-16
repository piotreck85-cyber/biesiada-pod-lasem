import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { theme } from "@/src/theme";

export default function ZadaniaScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Text style={s.brand}>Zadania</Text>
        <Text style={s.title}>Checklista imprezy</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140 }}>
        <View style={s.emptyCard}>
          <Feather name="check-square" size={44} color={theme.color.onSurfaceSecondary} />
          <Text style={s.emptyTitle}>Wkrótce dostępne</Text>
          <Text style={s.emptyText}>
            Tu pojawią się zadania przed imprezami: przygotowanie wiaty, ustawienie stołów,
            rozpalenie grilla i inne. Administrator może już definiować checklisty w panelu.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 8 },
  brand: { color: theme.color.onSurfaceSecondary, letterSpacing: 3, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  title: { color: theme.color.onSurface, fontSize: 24, fontWeight: "700" },
  emptyCard: { alignItems: "center", padding: 30, marginTop: 40, borderRadius: 16, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface, gap: 8 },
  emptyTitle: { color: theme.color.onSurface, fontSize: 16, fontWeight: "700", marginTop: 8 },
  emptyText: { color: theme.color.onSurfaceSecondary, fontSize: 12, textAlign: "center", lineHeight: 18 },
});

import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { v2 } from "@/src/designTokensV2";
import { api } from "@/src/api";

export default function EventAuditList({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => {
    let c = false;
    api.eventAudit(eventId)
      .then((r: any) => { if (!c) setRows(Array.isArray(r) ? r : []); })
      .catch(() => { if (!c) setRows([]); });
    return () => { c = true; };
  }, [eventId]);
  if (rows === null) return <ActivityIndicator color={v2.color.forest} style={{ marginVertical: 16 }} />;
  if (rows.length === 0) return <Text style={st.empty}>Brak zapisanych zmian</Text>;
  const fmt = (iso: string) => {
    try { return new Date(iso).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
    catch { return iso; }
  };
  return (
    <View style={st.card} testID="event-audit-list">
      {rows.slice(0, 60).map((r, i) => (
        <View key={r.id || i} style={[st.row, i > 0 && { borderTopWidth: 1, borderTopColor: v2.color.divider }]}>
          <Feather name={r.kind === "field" ? "edit-2" : "activity"} size={13} color={v2.color.sage} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <Text style={st.meta}>{fmt(r.at)}  ·  {r.user_name || "?"}</Text>
            {r.user_id === "system / TimeTree" && r.summary && <Text style={st.text}>{r.summary}</Text>}
            {r.kind === "field" ? (
              <Text style={st.text}>
                <Text style={{ fontWeight: "800" }}>{r.field_label || r.field}:</Text> {String(r.old ?? "—")} → <Text style={{ fontWeight: "800", color: v2.color.forest }}>{String(r.new ?? "—")}</Text>
              </Text>
            ) : (
              r.user_id !== "system / TimeTree" ? <Text style={st.text}>{r.summary || r.action}</Text> : null
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  card: { backgroundColor: v2.color.card, borderRadius: v2.radius.lg, borderWidth: 1, borderColor: v2.color.border, paddingHorizontal: 12 },
  row: { flexDirection: "row", gap: 8, paddingVertical: 10 },
  meta: { color: v2.color.textSubtle, fontSize: 10, fontWeight: "700", marginBottom: 2 },
  text: { color: v2.color.text, fontSize: 12, lineHeight: 17 },
  empty: { color: v2.color.textMuted, fontSize: 12, textAlign: "center", marginVertical: 12 },
});

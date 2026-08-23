import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, Alert,
  KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { useAuth } from "@/src/auth";

type Task = {
  id: string;
  title: string;
  done: boolean;
  done_by_name?: string | null;
  done_at?: string | null;
  source?: string;
  order?: number;
};

type EventInfo = { id: string };  // reserved for future
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _unused: EventInfo | null = null;


export default function EventChecklist({ eventId }: { eventId: string }) {
  const { user } = useAuth();
  const isAdmin = user?.role !== "staff";
  const [items, setItems] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const r: any = await api.getEventChecklist(eventId);
      setItems(r?.items || []);
    } catch (e: any) {
      setError(e?.message || "Błąd ładowania");
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (t: Task) => {
    if (pending[t.id]) return;
    setPending(p => ({ ...p, [t.id]: true }));
    // Optimistic update
    const newDone = !t.done;
    setItems(list => list.map(x => x.id === t.id ? { ...x,
      done: newDone,
      done_by_name: newDone ? (user?.name || user?.email || "") : null,
      done_at: newDone ? new Date().toISOString() : null,
    } : x));
    try {
      await api.patchChecklistTask(eventId, t.id, { done: newDone });
    } catch (e: any) {
      // Revert
      setItems(list => list.map(x => x.id === t.id ? t : x));
      Alert.alert("Błąd", e?.message || "");
    } finally {
      setPending(p => ({ ...p, [t.id]: false }));
    }
  };

  const addTask = async () => {
    const t = newTitle.trim();
    if (!t) return;
    setAdding(true);
    try {
      const r: any = await api.addChecklistTask(eventId, t);
      setItems(list => [...list, r]);
      setNewTitle("");
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "");
    } finally {
      setAdding(false);
    }
  };

  const removeTask = (t: Task) => {
    Alert.alert("Usunąć zadanie?", `„${t.title}"`, [
      { text: "Anuluj", style: "cancel" },
      { text: "Usuń", style: "destructive", onPress: async () => {
        try {
          await api.deleteChecklistTask(eventId, t.id);
          setItems(list => list.filter(x => x.id !== t.id));
        } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
      }},
    ]);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const t = editingText.trim();
    if (!t) { setEditingId(null); return; }
    try {
      const r: any = await api.patchChecklistTask(eventId, editingId, { title: t });
      setItems(list => list.map(x => x.id === editingId ? { ...x, title: r.title } : x));
      setEditingId(null);
    } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
  };

  const reInit = async () => {
    Alert.alert("Wczytać zadania z szablonów?",
      "Dodane zostaną tylko zadania z nowych szablonów. Istniejące zadania pozostaną bez zmian.",
      [
        { text: "Anuluj", style: "cancel" },
        { text: "Wczytaj", onPress: async () => {
          try {
            const r: any = await api.initEventChecklist(eventId);
            setItems(r?.items || []);
          } catch (e: any) { Alert.alert("Błąd", e?.message || ""); }
        }},
      ]);
  };

  const { total, done } = useMemo(() => ({
    total: items.length,
    done: items.filter(x => x.done).length,
  }), [items]);

  const pct = total > 0 ? Math.round(done * 100 / total) : 0;

  if (loading) {
    return <View style={{ padding: 24, alignItems: "center" }}>
      <ActivityIndicator color={theme.color.brand} />
    </View>;
  }
  if (error) {
    return <View style={{ padding: 20, alignItems: "center", gap: 8 }}>
      <Feather name="alert-triangle" size={28} color={theme.color.error} />
      <Text style={{ color: theme.color.error, fontSize: 13 }}>{error}</Text>
      <Pressable onPress={load} style={s.retryBtn}>
        <Text style={s.retryText}>Spróbuj ponownie</Text>
      </Pressable>
    </View>;
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1 }}
    >
      {/* Progress bar */}
      <View style={s.progressCard}>
        <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
          <Text style={s.progressLabel}>Postęp</Text>
          <Text style={s.progressCount}>{done}/{total} zadań</Text>
        </View>
        <View style={s.progressBg}>
          <View style={[s.progressFill, { width: `${pct}%` }]} />
        </View>
        <Text style={s.progressPct}>{pct}%</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {items.length === 0 ? (
          <View style={s.empty}>
            <Feather name="check-square" size={40} color={theme.color.onSurfaceSecondary} />
            <Text style={s.emptyTitle}>Brak zadań</Text>
            <Text style={s.emptyText}>
              {isAdmin
                ? "Dodaj pierwsze zadanie poniżej lub utwórz szablony w sekcji Więcej → Szablony zadań."
                : "Administrator jeszcze nie dodał zadań do tej imprezy."}
            </Text>
          </View>
        ) : (
          items.map(t => {
            const busy = !!pending[t.id];
            const isEditing = editingId === t.id;
            return (
              <View key={t.id} style={[s.row, t.done && s.rowDone]}>
                <Pressable
                  onPress={() => toggle(t)}
                  disabled={busy}
                  style={[s.check, t.done && s.checkOn]}
                  testID={`checklist-toggle-${t.id}`}
                >
                  {busy ? <ActivityIndicator size="small" color={t.done ? "#fff" : theme.color.brand} /> :
                    t.done ? <Feather name="check" size={16} color="#fff" /> : null}
                </Pressable>
                <View style={{ flex: 1 }}>
                  {isEditing ? (
                    <TextInput
                      value={editingText}
                      onChangeText={setEditingText}
                      onBlur={saveEdit}
                      onSubmitEditing={saveEdit}
                      autoFocus
                      style={s.editInput}
                    />
                  ) : (
                    <Pressable onLongPress={isAdmin ? () => { setEditingId(t.id); setEditingText(t.title); } : undefined}>
                      <Text style={[s.title, t.done && s.titleDone]} numberOfLines={3}>
                        {t.title}
                      </Text>
                    </Pressable>
                  )}
                  {t.done && (t.done_by_name || t.done_at) && (
                    <Text style={s.meta}>
                      {t.done_by_name ? `✓ ${t.done_by_name}` : "✓"}{" "}
                      {t.done_at ? `· ${new Date(t.done_at).toLocaleString("pl-PL", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" })}` : ""}
                    </Text>
                  )}
                </View>
                {isAdmin && !isEditing && (
                  <Pressable onPress={() => removeTask(t)} hitSlop={10} style={s.delBtn}>
                    <Feather name="x" size={16} color={theme.color.onSurfaceSecondary} />
                  </Pressable>
                )}
              </View>
            );
          })
        )}

        {isAdmin && (
          <View style={s.addBox}>
            <TextInput
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder="Dodaj nowe zadanie…"
              placeholderTextColor={theme.color.onSurfaceSecondary}
              style={s.addInput}
              onSubmitEditing={addTask}
              returnKeyType="done"
            />
            <Pressable onPress={addTask} disabled={adding || !newTitle.trim()} style={[s.addBtn, (!newTitle.trim() || adding) && { opacity: 0.5 }]}>
              {adding ? <ActivityIndicator color="#fff" /> : <Feather name="plus" size={18} color="#fff" />}
            </Pressable>
          </View>
        )}

        {isAdmin && (
          <Pressable onPress={reInit} style={s.reinitBtn}>
            <Feather name="download" size={14} color={theme.color.brand} />
            <Text style={s.reinitText}>Wczytaj zadania z szablonów</Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  progressCard: {
    padding: 14, borderRadius: 14, borderWidth: 1,
    borderColor: theme.color.brand + "44", backgroundColor: theme.color.brand + "0A",
    marginBottom: 12,
  },
  progressLabel: { color: theme.color.onSurfaceSecondary, fontSize: 11, letterSpacing: 1, fontWeight: "700" },
  progressCount: { color: theme.color.onSurface, fontSize: 13, fontWeight: "700" },
  progressBg: { height: 8, borderRadius: 4, backgroundColor: theme.color.divider, marginTop: 10, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: theme.color.brand, borderRadius: 4 },
  progressPct: { color: theme.color.brand, fontSize: 12, fontWeight: "800", marginTop: 6, textAlign: "right" },

  row: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    padding: 12, marginBottom: 8, borderRadius: 12,
    borderWidth: 1, borderColor: theme.color.border,
    backgroundColor: theme.color.surfaceSecondary,
  },
  rowDone: { backgroundColor: theme.color.brand + "0A", borderColor: theme.color.brand + "33" },
  check: {
    width: 26, height: 26, borderRadius: 6, borderWidth: 2,
    borderColor: theme.color.borderStrong,
    alignItems: "center", justifyContent: "center", marginTop: 1,
    backgroundColor: theme.color.surfaceSecondary,
  },
  checkOn: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  title: { color: theme.color.onSurface, fontSize: 14, fontWeight: "600", lineHeight: 20 },
  titleDone: { color: theme.color.onSurfaceSecondary, textDecorationLine: "line-through" },
  meta: { color: theme.color.onSurfaceSecondary, fontSize: 10, marginTop: 3 },
  delBtn: { padding: 4 },
  editInput: {
    color: theme.color.onSurface, fontSize: 14, fontWeight: "600",
    paddingVertical: 2, paddingHorizontal: 0,
    borderBottomWidth: 1, borderBottomColor: theme.color.brand,
  },

  addBox: { flexDirection: "row", gap: 8, marginTop: 6 },
  addInput: {
    flex: 1, backgroundColor: theme.color.surfaceSecondary,
    borderWidth: 1, borderColor: theme.color.border,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    color: theme.color.onSurface, fontSize: 14,
  },
  addBtn: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: theme.color.brand, alignItems: "center", justifyContent: "center",
  },
  reinitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    marginTop: 14, padding: 10, borderRadius: 10, borderWidth: 1,
    borderColor: theme.color.brand + "55", backgroundColor: theme.color.brand + "08",
  },
  reinitText: { color: theme.color.brand, fontSize: 12, fontWeight: "700" },

  empty: { alignItems: "center", padding: 30, gap: 6 },
  emptyTitle: { color: theme.color.onSurface, fontSize: 15, fontWeight: "700" },
  emptyText: { color: theme.color.onSurfaceSecondary, fontSize: 12, textAlign: "center", lineHeight: 18, maxWidth: 320 },

  retryBtn: { padding: 10, borderRadius: 8, backgroundColor: theme.color.brand + "18" },
  retryText: { color: theme.color.brand, fontWeight: "700", fontSize: 13 },
});

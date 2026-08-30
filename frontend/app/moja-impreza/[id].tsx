import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl,
  ActivityIndicator, TextInput, Alert, StatusBar, KeyboardAvoidingView, Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { v2 } from "@/src/designTokensV2";
import { api } from "@/src/api";
import { categoryLabel } from "@/src/categories";
import { ADULT_SETS, BIRTHDAY_PACKAGES } from "@/src/offers";
import { DINNER_MENU } from "@/src/dinnerMenu";

const STATUS_META: Record<string, { label: string; color: string }> = {
  wstepne:      { label: "Wstępne zapytanie", color: "#F59E0B" },
  rezerwacja:   { label: "Rezerwacja",        color: "#F97316" },
  potwierdzona: { label: "Potwierdzona",      color: "#10B981" },
  zakonczona:   { label: "Zakończona",        color: "#3B82F6" },
  anulowana:    { label: "Anulowana",         color: "#EF4444" },
};

const packageLabel = (pkg?: string) => {
  if (!pkg) return "";
  const a = ADULT_SETS.find(s => s.id === pkg);
  if (a) return a.name;
  const b = BIRTHDAY_PACKAGES.find(p => p.id === pkg);
  if (b) return `Pakiet ${b.name}`;
  return pkg;
};

const fmtDateLong = (iso?: string) => {
  try {
    return iso ? new Date(iso + "T12:00:00").toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "";
  } catch { return iso || ""; }
};
const fmtStamp = (iso?: string | null) => {
  try {
    return iso ? new Date(iso).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
  } catch { return ""; }
};

function Block({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <View style={s.block}>
      <Text style={s.blockTitle}>{icon} {title}</Text>
      {children}
    </View>
  );
}
const BodyText = ({ children }: { children: React.ReactNode }) => (
  <Text style={s.bodyText}>{children}</Text>
);

export default function MojaImpreza() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [ev, setEv] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const r: any = await api.myEventCard(id as string);
      setEv(r);
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "Nie udało się pobrać imprezy");
    }
  }, [id]);

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const sendComment = async () => {
    const text = comment.trim();
    if (!text) { Alert.alert("Błąd", "Wpisz treść informacji"); return; }
    setSending(true);
    try {
      await api.addStaffComment(id as string, text);
      setComment("");
      await load();
      Alert.alert("Wysłano ✓", "Informacja została przekazana właścicielowi.");
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "Nie udało się wysłać");
    } finally { setSending(false); }
  };

  if (loading) return <View style={s.center}><ActivityIndicator color={v2.color.forest} /></View>;
  if (!ev) return (
    <View style={s.center}>
      <Text style={{ color: v2.color.textMuted }}>Nie znaleziono imprezy</Text>
      <Pressable onPress={() => router.back()} style={{ marginTop: 12 }}><Text style={{ color: v2.color.forest, fontWeight: "800" }}>‹ Wróć</Text></Pressable>
    </View>
  );

  const org = ev.org || {};
  const st = STATUS_META[ev.status] || null;
  const importantInfos = (ev.service_infos || []).filter((i: any) => i.important);
  const normalInfos = (ev.service_infos || []).filter((i: any) => !i.important);
  const pkg = packageLabel(ev.package_set);
  const cat = ev.category ? categoryLabel(ev.category) : "";
  const dinnerItems = Object.entries(ev.dinner_items || {})
    .filter(([, q]: any) => (q || 0) > 0)
    .map(([itemId, q]: any) => {
      const item = DINNER_MENU.find(m => m.id === itemId);
      return item ? `${item.name} × ${q}` : null;
    })
    .filter(Boolean) as string[];
  const hasKidsSplit = org.kids_count != null || org.adults_count != null;
  const earlyKnown = org.early_arrival != null || !!org.early_arrival_time;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: v2.color.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <StatusBar barStyle="light-content" />
      {/* HEADER */}
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.backBtn} testID="my-event-back">
          <Feather name="arrow-left" size={20} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.headerEyebrow}>{pkg || cat || "IMPREZA"}</Text>
          <Text style={s.headerTitle} numberOfLines={2}>{ev.name}</Text>
        </View>
        {st ? (
          <View style={[s.statusChip, { backgroundColor: st.color }]}>
            <Text style={s.statusChipText}>{st.label.toUpperCase()}</Text>
          </View>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={v2.color.forest} />}
        testID="my-event-scroll"
      >
        {/* DATE + HOURS */}
        <View style={s.dateCard}>
          <Feather name="calendar" size={18} color={v2.color.forest} />
          <View style={{ flex: 1 }}>
            <Text style={s.dateText}>{fmtDateLong(ev.date)}</Text>
            {!!(ev.time_start || ev.time) && (
              <Text style={s.timeText}>
                {ev.time_start || ev.time}{ev.time_end ? ` – ${ev.time_end}` : ""}
                {ev.my_shift?.time_start ? `  ·  Twoja zmiana: ${ev.my_shift.time_start}${ev.my_shift.time_end ? `–${ev.my_shift.time_end}` : ""}` : ""}
              </Text>
            )}
          </View>
        </View>

        {/* ⚠ WAŻNE — always high on the card */}
        {importantInfos.length > 0 && (
          <View style={s.importantBox} testID="my-event-important">
            <Text style={s.importantTitle}>⚠ WAŻNE</Text>
            {importantInfos.map((i: any) => (
              <Text key={i.id} style={s.importantText}>• {i.text}</Text>
            ))}
          </View>
        )}

        {/* 🆕 NAJNOWSZE INFORMACJE OD KLIENTA */}
        {!!ev.client_update_text && (
          <View style={s.clientUpdateBox} testID="my-event-client-update">
            <Text style={s.clientUpdateTitle}>🆕 NAJNOWSZE INFORMACJE OD KLIENTA</Text>
            <Text style={s.bodyText}>{ev.client_update_text}</Text>
            {!!ev.client_update_at && (
              <Text style={s.updatedAt}>Zaktualizowano: {fmtStamp(ev.client_update_at)}</Text>
            )}
          </View>
        )}

        {/* 👥 UCZESTNICY */}
        {(ev.people || hasKidsSplit) ? (
          <Block icon="👥" title="UCZESTNICY">
            {!!ev.people && <BodyText>{ev.people} osób</BodyText>}
            {hasKidsSplit && (
              <BodyText>
                {org.kids_count != null ? `Dzieci: ${org.kids_count}` : ""}
                {org.kids_count != null && org.adults_count != null ? "  ·  " : ""}
                {org.adults_count != null ? `Dorośli: ${org.adults_count}` : ""}
              </BodyText>
            )}
          </Block>
        ) : null}

        {/* 🍽 MENU */}
        {(pkg || org.menu_details || dinnerItems.length > 0 || org.drinks || org.cakes) ? (
          <Block icon="🍽" title="MENU">
            {!!pkg && <BodyText>Pakiet: {pkg}</BodyText>}
            {!!org.menu_details && <BodyText>{org.menu_details}</BodyText>}
            {dinnerItems.length > 0 && (
              <View style={{ marginTop: 4 }}>
                <Text style={s.subLabel}>Obiad / catering:</Text>
                {dinnerItems.map((d, i) => <BodyText key={i}>• {d}</BodyText>)}
              </View>
            )}
            {!!org.drinks && (<View style={{ marginTop: 4 }}><Text style={s.subLabel}>Napoje:</Text><BodyText>{org.drinks}</BodyText></View>)}
            {!!org.cakes && (<View style={{ marginTop: 4 }}><Text style={s.subLabel}>Ciasta i przekąski:</Text><BodyText>{org.cakes}</BodyText></View>)}
          </Block>
        ) : null}

        {/* 🪑 STOŁY */}
        {(org.tables_setup || org.tables_plan) ? (
          <Block icon="🪑" title="STOŁY I USTAWIENIE">
            {!!org.tables_setup && <BodyText>{org.tables_setup}</BodyText>}
            {!!org.tables_plan && (<View style={{ marginTop: 4 }}><Text style={s.subLabel}>Plan stołów:</Text><BodyText>{org.tables_plan}</BodyText></View>)}
          </Block>
        ) : null}

        {/* 🎈 DEKORACJE */}
        {(org.decorations || org.client_own_decorations != null) ? (
          <Block icon="🎈" title="DEKORACJE">
            {!!org.decorations && <BodyText>{org.decorations}</BodyText>}
            {org.client_own_decorations != null && (
              <BodyText>Klient przygotowuje własne dekoracje: {org.client_own_decorations ? "TAK" : "NIE"}</BodyText>
            )}
          </Block>
        ) : null}

        {/* 🔥 GRILL / OGNISKO */}
        {!!org.grill && (
          <Block icon="🔥" title="GRILL / OGNISKO"><BodyText>{org.grill}</BodyText></Block>
        )}

        {/* 🎉 ATRAKCJE */}
        {!!org.attractions && (
          <Block icon="🎉" title="ATRAKCJE"><BodyText>{org.attractions}</BodyText></Block>
        )}

        {/* 📦 PROWIANT KLIENTA */}
        {!!org.client_provisions && (
          <Block icon="📦" title="PROWIANT KLIENTA"><BodyText>{org.client_provisions}</BodyText></Block>
        )}

        {/* 🚗 WCZEŚNIEJSZY PRZYJAZD */}
        {earlyKnown && (
          <Block icon="🚗" title="WCZEŚNIEJSZY PRZYJAZD">
            <BodyText>
              {org.early_arrival || org.early_arrival_time
                ? `Tak${org.early_arrival_time ? ` – ${org.early_arrival_time}` : ""}`
                : "Nie"}
            </BodyText>
          </Block>
        )}

        {/* ℹ️ INFORMACJE ORGANIZACYJNE */}
        {(org.org_notes || org.special_requests || org.allergies || org.setup_info || org.extra_orders || ev.notes_public) ? (
          <Block icon="ℹ️" title="INFORMACJE ORGANIZACYJNE">
            {!!org.allergies && (
              <View style={s.allergyBox}>
                <Text style={s.allergyText}>⚠ Alergie / diety: {org.allergies}</Text>
              </View>
            )}
            {!!org.special_requests && (<View style={{ marginTop: 4 }}><Text style={s.subLabel}>Specjalne wymagania klienta:</Text><BodyText>{org.special_requests}</BodyText></View>)}
            {!!org.extra_orders && (<View style={{ marginTop: 4 }}><Text style={s.subLabel}>Dodatkowe zamówienia:</Text><BodyText>{org.extra_orders}</BodyText></View>)}
            {!!org.setup_info && (<View style={{ marginTop: 4 }}><Text style={s.subLabel}>Przygotowanie miejsca:</Text><BodyText>{org.setup_info}</BodyText></View>)}
            {!!org.org_notes && (<View style={{ marginTop: 4 }}><BodyText>{org.org_notes}</BodyText></View>)}
            {!!ev.notes_public && (<View style={{ marginTop: 4 }}><BodyText>{ev.notes_public}</BodyText></View>)}
          </Block>
        ) : null}

        {/* 📌 INFORMACJE DLA OBSŁUGI (pozostałe) */}
        {normalInfos.length > 0 && (
          <Block icon="📌" title="INFORMACJE DLA OBSŁUGI">
            {normalInfos.map((i: any) => (
              <View key={i.id} style={{ marginBottom: 6 }}>
                <BodyText>• {i.text}</BodyText>
                <Text style={s.infoMeta}>{i.author_name} · {fmtStamp(i.created_at)}</Text>
              </View>
            ))}
          </Block>
        )}

        {/* ✅ ZADANIA I CHECKLISTA */}
        <Pressable onPress={() => router.push(`/checklist/${ev.id}` as any)} style={s.checklistCard} testID="my-event-checklist">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Feather name="check-square" size={16} color={v2.color.forest} />
            <Text style={s.blockTitle}>✅ MOJE ZADANIA / CHECKLISTA</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
            <Text style={s.bodyText}>
              {ev.tasks_total ? `${ev.tasks_done || 0}/${ev.tasks_total} zadań wykonanych` : "Brak zadań — otwórz checklistę"}
            </Text>
            <Feather name="chevron-right" size={18} color={v2.color.textMuted} />
          </View>
          {!!ev.tasks_total && (
            <View style={s.progressBg}>
              <View style={[s.progressFill, { width: `${Math.round(((ev.tasks_done || 0) / ev.tasks_total) * 100)}%` }]} />
            </View>
          )}
        </Pressable>

        {/* 💬 INFORMACJA DLA WŁAŚCICIELA */}
        <View style={s.commentCard} testID="my-event-comment-box">
          <Text style={s.blockTitle}>💬 INFORMACJA DLA WŁAŚCICIELA</Text>
          <TextInput
            testID="my-event-comment-input"
            value={comment}
            onChangeText={setComment}
            placeholder="Dodaj uwagę lub informację dotyczącą tej imprezy…"
            placeholderTextColor={v2.color.textMuted}
            style={s.commentInput}
            multiline
          />
          <Pressable
            testID="my-event-comment-send"
            onPress={sendComment}
            disabled={sending || !comment.trim()}
            style={[s.sendBtn, (sending || !comment.trim()) && { opacity: 0.5 }]}
          >
            {sending ? <ActivityIndicator color="#fff" size="small" /> : (
              <>
                <Feather name="send" size={15} color="#fff" />
                <Text style={s.sendBtnText}>Wyślij informację</Text>
              </>
            )}
          </Pressable>
          {(ev.my_comments || []).length > 0 && (
            <View style={{ marginTop: 12 }}>
              <Text style={s.subLabel}>Wysłane informacje:</Text>
              {(ev.my_comments || []).map((c: any) => (
                <View key={c.id} style={s.myComment}>
                  <Text style={s.bodyText}>„{c.text}”</Text>
                  <Text style={s.infoMeta}>{fmtStamp(c.created_at)}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: v2.color.bg },
  header: {
    backgroundColor: v2.color.forestDeep || "#1B3A26", paddingHorizontal: 16, paddingBottom: 14,
    flexDirection: "row", alignItems: "center", gap: 12,
  },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  headerEyebrow: { color: "#A7C4AE", fontSize: 10, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "800", marginTop: 2 },
  statusChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusChipText: { color: "#fff", fontSize: 9, fontWeight: "900", letterSpacing: 0.5 },

  dateCard: {
    flexDirection: "row", alignItems: "center", gap: 12, padding: 14,
    borderRadius: v2.radius?.md || 12, backgroundColor: v2.color.card,
    borderWidth: 1, borderColor: v2.color.border, marginBottom: 10,
  },
  dateText: { color: v2.color.text, fontSize: 14, fontWeight: "800", textTransform: "capitalize" },
  timeText: { color: v2.color.textMuted, fontSize: 12, marginTop: 2 },

  importantBox: {
    padding: 14, borderRadius: 12, backgroundColor: "#FEF3C7",
    borderWidth: 1.5, borderColor: "#F59E0B", marginBottom: 10,
  },
  importantTitle: { color: "#92400E", fontSize: 12, fontWeight: "900", letterSpacing: 1, marginBottom: 6 },
  importantText: { color: "#78350F", fontSize: 14, fontWeight: "700", lineHeight: 20, marginBottom: 2 },

  clientUpdateBox: {
    padding: 14, borderRadius: 12, backgroundColor: "#DBEAFE",
    borderWidth: 1, borderColor: "#3B82F6", marginBottom: 10,
  },
  clientUpdateTitle: { color: "#1E40AF", fontSize: 11, fontWeight: "900", letterSpacing: 0.6, marginBottom: 6 },
  updatedAt: { color: "#1E40AF", fontSize: 11, fontWeight: "700", marginTop: 6 },

  block: {
    padding: 14, borderRadius: 12, backgroundColor: v2.color.card,
    borderWidth: 1, borderColor: v2.color.border, marginBottom: 10,
  },
  blockTitle: { color: v2.color.forest, fontSize: 11, fontWeight: "900", letterSpacing: 0.8, marginBottom: 6 },
  bodyText: { color: v2.color.text, fontSize: 14, lineHeight: 20 },
  subLabel: { color: v2.color.textMuted, fontSize: 11, fontWeight: "800", marginBottom: 2, marginTop: 2 },
  infoMeta: { color: v2.color.textMuted, fontSize: 11, marginTop: 2 },

  allergyBox: { padding: 10, borderRadius: 8, backgroundColor: "#FEE2E2", borderWidth: 1, borderColor: "#EF4444" },
  allergyText: { color: "#991B1B", fontSize: 13, fontWeight: "800" },

  checklistCard: {
    padding: 14, borderRadius: 12, backgroundColor: v2.color.card,
    borderWidth: 1, borderColor: v2.color.forest + "44", marginBottom: 10,
  },
  progressBg: { height: 6, borderRadius: 999, backgroundColor: v2.color.border, marginTop: 8, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 999, backgroundColor: v2.color.forest },

  commentCard: {
    padding: 14, borderRadius: 12, backgroundColor: v2.color.card,
    borderWidth: 1, borderColor: v2.color.border, marginBottom: 10,
  },
  commentInput: {
    borderWidth: 1, borderColor: v2.color.border, borderRadius: 10, padding: 12,
    minHeight: 80, textAlignVertical: "top", color: v2.color.text, fontSize: 14,
    backgroundColor: v2.color.bg, marginTop: 4,
  },
  sendBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: v2.color.forest, paddingVertical: 13, borderRadius: 10, marginTop: 10,
  },
  sendBtnText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  myComment: { padding: 10, borderRadius: 8, backgroundColor: v2.color.bg, marginTop: 6 },
});

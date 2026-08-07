import { useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Link } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "@/src/theme";
import { useAuth } from "@/src/auth";

const BG = "https://images.unsplash.com/photo-1630395822970-acd6a691d97e?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NjV8MHwxfHNlYXJjaHwxfHxhYnN0cmFjdCUyMG5pZ2h0bGlmZSUyMGNsdWIlMjBsaWdodHMlMjBkYXJrfGVufDB8fHx8MTc4NjExOTQ3NXww&ixlib=rb-4.1.0&q=85";

export default function Login() {
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null); setBusy(true);
    try { await login(email.trim(), password); }
    catch (e: any) { setErr(e.message || "Nie udało się zalogować"); }
    finally { setBusy(false); }
  };

  return (
    <View style={s.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={[s.scroll, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
          <View style={s.brandBlock}>
            <Text style={s.brandDot} testID="brand-dot">BIESIADA POD LASEM</Text>
            <Text style={s.title}>Zarządzaj swoimi imprezami</Text>
            <Text style={s.subtitle}>Kalendarz, pracownicy, koszty i zysk – wszystko w jednym miejscu.</Text>
          </View>

          <View style={s.card}>
            <Text style={s.label}>Email</Text>
            <TextInput
              testID="login-email-input"
              value={email}
              onChangeText={setEmail}
              placeholder="ty@example.com"
              placeholderTextColor={theme.color.onSurfaceSecondary}
              keyboardType="email-address"
              autoCapitalize="none"
              style={s.input}
            />
            <Text style={s.label}>Hasło</Text>
            <TextInput
              testID="login-password-input"
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={theme.color.onSurfaceSecondary}
              secureTextEntry
              style={s.input}
            />
            {err && <Text style={s.err} testID="login-error">{err}</Text>}
            <Pressable
              testID="login-submit-button"
              onPress={submit}
              disabled={busy || !email || !password}
              style={({ pressed }) => [s.btn, (busy || !email || !password) && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.98 }] }]}
            >
              {busy ? <ActivityIndicator color={theme.color.onBrand} /> : <Text style={s.btnText}>Zaloguj się</Text>}
            </Pressable>
            <View style={s.footerRow}>
              <Text style={s.small}>Nie masz konta?</Text>
              <Link href="/(auth)/register" asChild>
                <Pressable testID="go-to-register"><Text style={s.linkText}> Zarejestruj się</Text></Pressable>
              </Link>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  scroll: { flexGrow: 1, paddingHorizontal: 24, justifyContent: "space-between" },
  brandBlock: { marginBottom: 32 },
  brandDot: { fontSize: 12, letterSpacing: 4, color: theme.color.brand, fontWeight: "600", marginBottom: 16 },
  title: { fontSize: 32, color: theme.color.onSurface, fontWeight: "700", lineHeight: 38, marginBottom: 8 },
  subtitle: { fontSize: 15, color: theme.color.onSurfaceSecondary, lineHeight: 22 },
  card: {
    backgroundColor: "rgba(21,21,24,0.92)", borderRadius: 20, padding: 20, borderWidth: 1,
    borderColor: theme.color.border,
  },
  label: { color: theme.color.onSurfaceSecondary, fontSize: 12, letterSpacing: 1, marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: theme.color.surfaceTertiary, borderRadius: 12, color: theme.color.onSurface,
    paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, borderWidth: 1, borderColor: theme.color.border,
  },
  btn: {
    marginTop: 20, backgroundColor: theme.color.brand, borderRadius: 12, paddingVertical: 16,
    alignItems: "center",
  },
  btnText: { color: theme.color.onBrand, fontWeight: "700", fontSize: 16, letterSpacing: 0.5 },
  err: { color: theme.color.error, marginTop: 12, fontSize: 13 },
  footerRow: { flexDirection: "row", justifyContent: "center", marginTop: 16 },
  small: { color: theme.color.onSurfaceSecondary, fontSize: 13 },
  linkText: { color: theme.color.brand, fontSize: 13, fontWeight: "600" },
});

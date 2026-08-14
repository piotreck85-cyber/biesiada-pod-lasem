import { useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator, Alert,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Link } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { theme } from "@/src/theme";
import { useAuth, extractSessionId } from "@/src/auth";

// Handles auth session return on iOS/Android (safe no-op on web).
WebBrowser.maybeCompleteAuthSession();

const BG = "https://images.unsplash.com/photo-1464457312035-3d7d0e0c058e?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1ODh8MHwxfHNlYXJjaHwxfHxkYXJrJTIwcGluZSUyMGZvcmVzdCUyMGZvZ3xlbnwwfHx8fDE3ODY1MDg2MDd8MA&ixlib=rb-4.1.0&q=85";

export default function Login() {
  const insets = useSafeAreaInsets();
  const { login, loginWithSessionId } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null); setBusy(true);
    try { await login(email.trim(), password); }
    catch (e: any) { setErr(e.message || "Nie udało się zalogować"); }
    finally { setBusy(false); }
  };

  const signInWithGoogle = async () => {
    setErr(null);
    setGoogleBusy(true);
    try {
      // Platform-specific redirect URL
      let redirectUrl: string;
      if (Platform.OS === "web") {
        redirectUrl = window.location.origin + "/";
      } else {
        redirectUrl = Linking.createURL("");
      }
      const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;

      if (Platform.OS === "web") {
        // Full-page redirect — session_id comes back in URL hash
        window.location.href = authUrl;
        return;
      }

      // Mobile: capture URL from three co-equal sources (Android quirks)
      let capturedFromEvent: string | null = null;
      const sub = Linking.addEventListener("url", ({ url }) => {
        capturedFromEvent = url;
      });

      let resultUrl: string | null = null;
      try {
        const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
        if (result.type === "success" && result.url) {
          resultUrl = result.url;
        }
      } finally {
        sub.remove();
      }

      // Fallbacks
      if (!resultUrl) resultUrl = capturedFromEvent;
      if (!resultUrl) resultUrl = await Linking.getInitialURL();

      const sessionId = extractSessionId(resultUrl);
      if (!sessionId) {
        // Genuine cancel — silently return, no error toast
        setGoogleBusy(false);
        return;
      }
      await loginWithSessionId(sessionId);
      // AuthGate will navigate to /(tabs)/kalendarz
    } catch (e: any) {
      setErr(e?.message || "Nie udało się zalogować przez Google");
      Alert.alert("Błąd logowania Google", e?.message || "Spróbuj ponownie");
    } finally {
      setGoogleBusy(false);
    }
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

            <View style={s.dividerRow}>
              <View style={s.dividerLine} />
              <Text style={s.dividerText}>lub</Text>
              <View style={s.dividerLine} />
            </View>

            <Pressable
              testID="google-signin-button"
              onPress={signInWithGoogle}
              disabled={googleBusy || busy}
              style={({ pressed }) => [s.googleBtn, (googleBusy || busy) && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.98 }] }]}
            >
              {googleBusy ? (
                <ActivityIndicator color="#111827" />
              ) : (
                <>
                  <Text style={s.googleG}>G</Text>
                  <Text style={s.googleBtnText}>Zaloguj się z Google</Text>
                </>
              )}
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
    backgroundColor: "rgba(255,255,255,0.85)", borderRadius: 20, padding: 20, borderWidth: 1,
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
  dividerRow: { flexDirection: "row", alignItems: "center", marginTop: 20, marginBottom: 4, gap: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: theme.color.border },
  dividerText: { color: theme.color.onSurfaceSecondary, fontSize: 12, letterSpacing: 2, fontWeight: "600" },
  googleBtn: {
    marginTop: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  googleG: {
    color: "#4285F4",
    fontSize: 18,
    fontWeight: "900",
    fontFamily: Platform.select({ ios: "System", android: "Roboto", default: undefined }),
  },
  googleBtnText: { color: "#111827", fontWeight: "600", fontSize: 15 },
});

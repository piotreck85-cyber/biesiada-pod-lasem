import { Stack, useRouter, useSegments, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef } from "react";
import { LogBox } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider, useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { theme } from "@/src/theme";

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

function AuthGate() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const pathname = usePathname();
  const lastVisit = useRef("");
  useEffect(() => {
    if (loading || user?.role !== "staff") { lastVisit.current = ""; return; }
    const section = pathname.split("/").filter(Boolean)[0] || "";
    const allowed = new Set(['kalendarz', 'imprezy', 'grafik', 'obecnosc', 'zadania', 'zakupy', 'finanse', 'koszty', 'rozliczenie', 'pracownicy', 'statystyki', 'wiecej', 'oferta', 'majatek', 'wspolnicy', 'event', 'moja-impreza', 'checklist', 'dostepnosc-zespolu', 'grafik-pracownikow', 'czas-zespolu', 'korekty-czasu', 'ai-asystent', 'gmail', 'ustawienia', 'checklist-templates', 'import-kosztow', 'pozostale-przychody']);
    if (!allowed.has(section)) return;
    const key = `${user.id}:${pathname}`;
    if (lastVisit.current === key) return;
    lastVisit.current = key;
    // Send only a known section name; never query strings or entered text.
    void api.activityVisit(section).catch(() => {});
  }, [loading, user?.id, user?.role, pathname]);

  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === "(auth)";
    const isPublicRegulamin = segments[0] === "regulamin";
    if (!user && !inAuth && !isPublicRegulamin) router.replace("/(auth)/login");
    else if (user && inAuth) {
      const home = (user as any)?.role === "staff" ? "/(tabs)/grafik" : "/(tabs)/kalendarz";
      router.replace(home);
    }
  }, [user, loading, segments]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "transparent" },
        animation: "fade",
      }}
    />
  );
}

export default function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="dark" />
          <AuthGate />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

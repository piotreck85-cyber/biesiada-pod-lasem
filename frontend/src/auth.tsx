import React, { createContext, useContext, useEffect, useRef, useState, ReactNode, useCallback } from "react";
import { AppState, Platform } from "react-native";
import * as Linking from "expo-linking";
import { api, tokenStore } from "./api";

type User = {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  role?: "admin" | "staff" | string;
  staff_id?: string;
  workspace_id?: string;
  permissions?: Partial<Record<string, boolean>>;
};
type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  loginWithSessionId: (sessionId: string) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Extract Emergent's session_id from a URL (query OR hash — Emergent uses hash). */
export function extractSessionId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Guard against processing the same session_id twice (re-mount, hot link, etc.)
  const consumedSessionIds = useRef<Set<string>>(new Set());

  const loginWithSessionId = useCallback(async (sessionId: string) => {
    if (consumedSessionIds.current.has(sessionId)) return;
    consumedSessionIds.current.add(sessionId);
    const res: any = await api.exchangeSession(sessionId);
    await tokenStore.set(res.session_token);
    setUser(res.user);
  }, []);

  // Cold-start / mount: process session_id from URL BEFORE checking existing token.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // 1) Look for session_id in the current URL (web) or the initial deep link (mobile)
        let initialUrl: string | null = null;
        if (Platform.OS === "web") {
          if (typeof window !== "undefined") {
            initialUrl = window.location.href;
          }
        } else {
          initialUrl = await Linking.getInitialURL();
        }
        const sessionId = extractSessionId(initialUrl);
        if (sessionId) {
          try {
            await loginWithSessionId(sessionId);
            // Clean URL on web after successful exchange
            if (Platform.OS === "web" && typeof window !== "undefined") {
              const cleanUrl = window.location.origin + window.location.pathname;
              window.history.replaceState(window.history.state, "", cleanUrl);
            }
            if (mounted) setLoading(false);
            return;
          } catch (e) {
            // fall through to normal check
          }
        }

        // 2) Otherwise use existing stored token
        const t = await tokenStore.get();
        if (!t) {
          if (mounted) setLoading(false);
          return;
        }
        try {
          const me = await api.me();
          if (mounted) setUser(me);
        } catch {
          await tokenStore.clear();
        } finally {
          if (mounted) setLoading(false);
        }
      } catch {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [loginWithSessionId]);

  // Re-read permissions from the authenticated API, including after returning to the app.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let busy = false;
    const userId = user.id;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const me: any = await api.me();
        if (!cancelled && me.id === userId) setUser(current => current?.id === userId ? me : current);
      } catch { /* Keep session during a temporary network failure. API still enforces current permissions. */ }
      finally { busy = false; }
    };
    void refresh();
    const timer = setInterval(() => { if (AppState.currentState === "active" || Platform.OS === "web") void refresh(); }, 15000);
    const sub = AppState.addEventListener("change", state => { if (state === "active") void refresh(); });
    const focus = () => { void refresh(); };
    if (Platform.OS === "web" && typeof window !== "undefined") window.addEventListener("focus", focus);
    return () => { cancelled = true; clearInterval(timer); sub.remove();
      if (Platform.OS === "web" && typeof window !== "undefined") window.removeEventListener("focus", focus);
    };
  }, [user?.id]);

  // Hot deep-links (mobile): listen for URLs delivered while the app is running.
  useEffect(() => {
    const sub = Linking.addEventListener("url", async ({ url }) => {
      const sid = extractSessionId(url);
      if (sid) {
        try { await loginWithSessionId(sid); } catch {}
      }
    });
    return () => { sub.remove(); };
  }, [loginWithSessionId]);

  const login = async (email: string, password: string) => {
    const res: any = await api.login(email, password);
    await tokenStore.set(res.access_token);
    setUser(res.user);
  };
  const register = async (email: string, password: string, name?: string) => {
    const res: any = await api.register(email, password, name);
    await tokenStore.set(res.access_token);
    setUser(res.user);
  };
  const logout = async () => {
    // Best-effort server-side revoke (for session_token); JWTs are stateless.
    try { await api.logoutServer(); } catch {}
    await tokenStore.clear();
    setUser(null);
  };
  const deleteAccount = async () => {
    await api.deleteAccount();
    await tokenStore.clear();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, loginWithSessionId, logout, deleteAccount }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}

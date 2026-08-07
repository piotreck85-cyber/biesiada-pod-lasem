import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, tokenStore } from "./api";

type User = { id: string; email: string; name?: string };
type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const t = await tokenStore.get();
      if (!t) { setLoading(false); return; }
      try {
        const me = await api.me();
        setUser(me);
      } catch {
        await tokenStore.clear();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
    await tokenStore.clear();
    setUser(null);
  };
  const deleteAccount = async () => {
    await api.deleteAccount();
    await tokenStore.clear();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, deleteAccount }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}

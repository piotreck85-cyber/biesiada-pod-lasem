import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "eventa.token";

async function get(): Promise<string | null> {
  if (Platform.OS === "web") return AsyncStorage.getItem(KEY);
  return SecureStore.getItemAsync(KEY);
}
async function set(v: string) {
  if (Platform.OS === "web") return AsyncStorage.setItem(KEY, v);
  return SecureStore.setItemAsync(KEY, v);
}
async function clear() {
  if (Platform.OS === "web") return AsyncStorage.removeItem(KEY);
  return SecureStore.deleteItemAsync(KEY);
}

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

export const tokenStore = { get, set, clear };

async function request(path: string, opts: RequestInit = {}) {
  const token = await get();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as any),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api${path}`, { ...opts, headers });
  const ct = res.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  const data = isJson ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    const msg = (isJson && (data as any)?.detail) || (isJson ? "Błąd" : data) || "Błąd sieci";
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

export const api = {
  register: (email: string, password: string, name?: string) =>
    request("/auth/register", { method: "POST", body: JSON.stringify({ email, password, name }) }),
  login: (email: string, password: string) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  exchangeSession: (sessionId: string) =>
    request("/auth/session", { method: "POST", body: JSON.stringify({ session_id: sessionId }) }),
  logoutServer: () => request("/auth/logout", { method: "POST" }),
  weather: (date: string, timeStart?: string, timeEnd?: string) =>
    request(`/weather?date=${encodeURIComponent(date)}&time_start=${encodeURIComponent(timeStart || "")}&time_end=${encodeURIComponent(timeEnd || "")}`),
  me: () => request("/auth/me"),
  deleteAccount: () => request("/auth/me", { method: "DELETE" }),
  workspace: () => request("/workspace"),
  joinWorkspace: (code: string) => request("/workspace/join", { method: "POST", body: JSON.stringify({ code }) }),
  leaveWorkspace: () => request("/workspace/leave", { method: "POST" }),
  history: (limit: number = 200) => request(`/history?limit=${limit}`),
  clearHistory: () => request("/history", { method: "DELETE" }),

  listStaff: () => request("/staff"),
  createStaff: (data: any) => request("/staff", { method: "POST", body: JSON.stringify(data) }),
  updateStaff: (id: string, data: any) => request(`/staff/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteStaff: (id: string) => request(`/staff/${id}`, { method: "DELETE" }),

  listTemplates: () => request("/templates"),
  createTemplate: (data: any) => request("/templates", { method: "POST", body: JSON.stringify(data) }),
  deleteTemplate: (id: string) => request(`/templates/${id}`, { method: "DELETE" }),

  listExpenses: (year?: number, month?: number) => {
    const qs = year && month ? `?year=${year}&month=${month}` : (year ? `?year=${year}` : "");
    return request(`/expenses${qs}`);
  },
  createExpense: (data: any) => request("/expenses", { method: "POST", body: JSON.stringify(data) }),
  updateExpense: (id: string, data: any) => request(`/expenses/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteExpense: (id: string) => request(`/expenses/${id}`, { method: "DELETE" }),

  listEvents: (year?: number, month?: number) => {
    const qs = year && month ? `?year=${year}&month=${month}` : "";
    return request(`/events${qs}`);
  },
  getEvent: (id: string) => request(`/events/${id}`),
  createEvent: (data: any) => request("/events", { method: "POST", body: JSON.stringify(data) }),
  updateEvent: (id: string, data: any) => request(`/events/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteEvent: (id: string) => request(`/events/${id}`, { method: "DELETE" }),

  stats: (year: number, month: number) => request(`/stats?year=${year}&month=${month}`),
  yearStats: (year: number) => request(`/stats?year=${year}`),
  wages: (year: number, month: number) => request(`/staff/wages?year=${year}&month=${month}`),
  schedule: (year: number, month: number) => request(`/schedule?year=${year}&month=${month}`),
  exportUrl: (year: number, month: number) => `${BASE}/api/export/events?year=${year}&month=${month}`,
  backup: () => request("/export/backup"),
  importBackup: (data: any) => request("/import/backup", { method: "POST", body: JSON.stringify(data) }),
  importIcs: (ics: string, years_back: number = 5) => request("/import/ics", { method: "POST", body: JSON.stringify({ ics, years_back }) }),
  importWhatsApp: (text: string, kind: "expenses" | "revenue") =>
    request("/import/whatsapp", { method: "POST", body: JSON.stringify({ text, kind }) }),
  sendOfferEmail: (data: {
    to_email: string;
    client_name?: string;
    event_date?: string;
    people_count?: number;
    package_set_id?: "set1" | "set2" | "set3" | null;
    extras?: { id: string; qty?: number; amount?: number }[];
    custom_note?: string;
    event_id?: string;
    event_type?: "okolicznosciowe" | "firmowe" | "urodziny" | "warsztaty";
    attachments_mode?: "grill" | "dinner" | "both";
  }) => request("/offers/send-email", { method: "POST", body: JSON.stringify(data) }),
  icsUrl: () => `${BASE}/api/export/calendar.ics`,
};

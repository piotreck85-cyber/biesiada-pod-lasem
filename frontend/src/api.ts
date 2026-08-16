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
  exportXlsxUrl: (year?: number, month?: number) =>
    (year && month) ? `${BASE}/api/export/xlsx?year=${year}&month=${month}` : `${BASE}/api/export/xlsx`,
  costRatios: () => request("/stats/cost-ratios"),
  importWhatsAppProfits: (content: string, dry_run: boolean = false, window_days: number = 7) =>
    request("/import/whatsapp-profits", { method: "POST", body: JSON.stringify({ content, dry_run, window_days }) }),
  getMenuSettings: () => request("/menu-settings"),
  saveMenuSettings: (data: {
    dinner_price_overrides?: Record<string, number>;
    dinner_cost_overrides?: Record<string, number>;
    dinner_custom_items?: Array<{ id: string; section: string; name: string; unit: string; base_price: number; cost_price: number }>;
    grill_price_overrides?: Record<string, number>;
  }) => request("/menu-settings", { method: "PUT", body: JSON.stringify(data) }),
  setOpeningBalance: (opening_balance: number, note?: string) =>
    request("/finance/opening-balance", { method: "PUT", body: JSON.stringify({ opening_balance, note }) }),
  shoppingGenerate: (from?: string, to?: string, expand: boolean = true) => {
    const p = new URLSearchParams();
    if (from) p.set("date_from", from);
    if (to) p.set("date_to", to);
    if (!expand) p.set("expand", "false");
    return request(`/shopping/generate${p.toString() ? `?${p.toString()}` : ""}`);
  },
  shoppingList: () => request("/shopping/items"),
  shoppingAdd: (item: any) => request("/shopping/items", { method: "POST", body: JSON.stringify(item) }),
  shoppingUpdate: (id: string, patch: any) => request(`/shopping/items/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  shoppingDelete: (id: string) => request(`/shopping/items/${id}`, { method: "DELETE" }),
  shoppingRecipes: () => request("/shopping/recipes"),
  shoppingUpdateRecipe: (key: string, ingredients: Array<{ name: string; category: string; unit: string; qty: number; price: number }>) =>
    request(`/shopping/recipes/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ ingredients }) }),
  shoppingResetRecipe: (key: string) => request(`/shopping/recipes/${encodeURIComponent(key)}`, { method: "DELETE" }),
  cashState: () => request("/finance/cash-state"),
  periodSummary: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set("date_from", from);
    if (to) params.set("date_to", to);
    const q = params.toString();
    return request(`/finance/period-summary${q ? `?${q}` : ""}`);
  },
  listSettlements: () => request("/settlements"),
  createSettlement: (data: { date?: string; payouts: Array<{ partner_name: string; amount: number }>; cash_before?: number; notes?: string }) =>
    request("/settlements", { method: "POST", body: JSON.stringify(data) }),
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

  listAlerts: () => request("/alerts"),
  dismissAlert: (id: string) => request(`/alerts/${id}/dismiss`, { method: "POST" }),
  dismissAllAlerts: () => request("/alerts/dismiss-all", { method: "POST" }),
  scanAlertsNow: () => request("/alerts/scan", { method: "POST" }),

  getCalendarFeedUrl: () => request("/calendar/feed-url"),
  rotateCalendarFeedUrl: () => request("/calendar/feed-url/rotate", { method: "POST" }),

  // Google Calendar auto-sync
  gcalStatus: () => request("/google-calendar/status"),
  gcalStart: () => request("/google-calendar/oauth/start"),
  gcalDisconnect: () => request("/google-calendar/disconnect", { method: "POST" }),
  gcalBackfill: () => request("/google-calendar/backfill", { method: "POST" }),
};

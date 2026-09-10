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

async function requestBlob(path: string): Promise<Blob> {
  const token = await get();
  const res = await fetch(`${BASE}/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.blob();
}

export const api = {
  timeTreeStatus: () => request("/integrations/timetree"),
  timeTreeSync: () => request("/integrations/timetree/sync", { method: "POST" }),
  activityVisit: (section: string) => request("/activity/visit", { method: "POST", body: JSON.stringify({ section }) }),
  activity: (days: number = 7, userId: string = "", kind: "all" | "login" | "browsing" = "all") => request(`/activity?days=${days}&user_id=${encodeURIComponent(userId)}&kind=${kind}`),
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
  bulkUpdateEventStatus: (event_ids: string[], status: string) =>
    request("/events/bulk-status", { method: "PATCH", body: JSON.stringify({ event_ids, status }) }),
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
  shoppingSaveOverride: (data: { name: string; category: string; unit: string; qty_override?: number | null; price_override?: number | null }) =>
    request(`/shopping/overrides`, { method: "PUT", body: JSON.stringify(data) }),
  shoppingClearOverride: (name: string, category: string, unit: string) => {
    const p = new URLSearchParams({ name, category, unit });
    return request(`/shopping/overrides?${p.toString()}`, { method: "DELETE" });
  },

  // Stock / Magazyn
  stockList: () => request("/stock/items"),
  stockAdd: (item: { name: string; category?: string; qty?: number; unit?: string; expiry_date?: string | null; notes?: string }) =>
    request("/stock/items", { method: "POST", body: JSON.stringify(item) }),
  stockUpdate: (id: string, patch: any) =>
    request(`/stock/items/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  stockDelete: (id: string) => request(`/stock/items/${id}`, { method: "DELETE" }),
  stockCheck: (items: any[], notes?: string, check_date?: string) =>
    request("/stock/check", { method: "POST", body: JSON.stringify({ items, notes: notes || "", check_date }) }),
  stockSnapshots: (limit: number = 30) => request(`/stock/snapshots?limit=${limit}`),
  reservationsList: (event_id?: string) => request(`/stock/reservations${event_id ? `?event_id=${event_id}` : ""}`),
  reservationsAdd: (data: { stock_id?: string; name: string; unit: string; qty: number; event_id: string; event_name?: string }) =>
    request("/stock/reservations", { method: "POST", body: JSON.stringify(data) }),
  reservationsDelete: (id: string) => request(`/stock/reservations/${id}`, { method: "DELETE" }),
  stockNeededSuggestions: (from?: string, to?: string) => {
    const p = new URLSearchParams();
    if (from) p.set("date_from", from);
    if (to) p.set("date_to", to);
    return request(`/stock/needed-suggestions${p.toString() ? `?${p.toString()}` : ""}`);
  },
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
    custom_greeting?: string;
    custom_subject?: string;
    event_id?: string;
    event_type?: "okolicznosciowe" | "firmowe" | "urodziny" | "warsztaty";
    attachments_mode?: "grill" | "dinner" | "both";
  }) => request("/offers/send-email", { method: "POST", body: JSON.stringify(data) }),
  previewOfferPdfUrl: () => `${BASE}/api/offers/preview-pdf`,
  previewOfferPdf: async (data: any): Promise<Blob> => {
    const token = await tokenStore.get();
    const res = await fetch(`${BASE}/api/offers/preview-pdf`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await res.text());
    return await res.blob();
  },
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

  // Catering email
  sendCateringEmail: (event_id: string, data?: { to_email?: string; pickup_time?: string; extra_notes?: string; greeting?: string }) =>
    request(`/events/${event_id}/send-catering-email`, { method: "POST", body: JSON.stringify(data || {}) }),

  // Staff auth / time-clock
  staffCreateLogin: (staff_id: string, data: { email: string; password?: string; permissions?: Record<string, boolean>; active?: boolean }) =>
    request(`/staff/${staff_id}/login`, { method: "POST", body: JSON.stringify(data) }),
  staffDeleteLogin: (staff_id: string) => request(`/staff/${staff_id}/login`, { method: "DELETE" }),
  // Staff email invitations
  staffInviteGet: (staff_id: string) => request(`/staff/${staff_id}/invite`),
  staffInviteSend: (staff_id: string, data: { email: string; permissions?: Record<string, boolean> }) =>
    request(`/staff/${staff_id}/invite`, { method: "POST", body: JSON.stringify(data) }),
  staffInviteResend: (staff_id: string) => request(`/staff/${staff_id}/invite/resend`, { method: "POST" }),
  staffInviteCancel: (staff_id: string) => request(`/staff/${staff_id}/invite`, { method: "DELETE" }),
  // Staff event card (Moja praca)
  myEventCard: (event_id: string) => request(`/staff/my/events/${event_id}`),
  addStaffComment: (event_id: string, text: string) =>
    request(`/staff/my/events/${event_id}/comments`, { method: "POST", body: JSON.stringify({ text }) }),
  eventComments: (event_id: string) => request(`/events/${event_id}/comments`),
  addServiceInfo: (event_id: string, data: { text: string; important?: boolean }) =>
    request(`/events/${event_id}/service-info`, { method: "POST", body: JSON.stringify(data) }),
  deleteServiceInfo: (event_id: string, info_id: string) =>
    request(`/events/${event_id}/service-info/${info_id}`, { method: "DELETE" }),
  setClientUpdate: (event_id: string, text: string) =>
    request(`/events/${event_id}/client-update`, { method: "POST", body: JSON.stringify({ text }) }),
  // Client reply suggestions (AI from Gmail 48h replies)
  clientReplySuggestions: (event_id: string) => request(`/events/${event_id}/client-reply-suggestions`),
  approveClientReply: (sug_id: string, text?: string) =>
    request(`/client-reply-suggestions/${sug_id}/approve`, { method: "POST", body: JSON.stringify({ text: text || null }) }),
  rejectClientReply: (sug_id: string) =>
    request(`/client-reply-suggestions/${sug_id}/reject`, { method: "POST" }),
  // Etap 2 — AI draft replies to client emails
  draftClientReply: (sug_id: string) =>
    request(`/client-reply-suggestions/${sug_id}/draft-reply`, { method: "POST" }),
  sendClientReply: (sug_id: string, data: { text: string; subject?: string; to_email?: string }) =>
    request(`/client-reply-suggestions/${sug_id}/send-reply`, { method: "POST", body: JSON.stringify(data) }),
  // Etap 3 — event PDFs
  eventConfirmationPdf: (event_id: string) => requestBlob(`/events/${event_id}/pdf/confirmation`),
  eventStaffCardPdf: (event_id: string) => requestBlob(`/events/${event_id}/pdf/staff-card`),
  // Cost import (BPL 2026)
  costImportSummary: () => request("/cost-import/summary"),
  costImportPending: () => request("/cost-import/pending"),
  costImportResolve: (rec_id: string, data: { action: string; event_id?: string; amount?: number; category?: string }) =>
    request(`/cost-import/${rec_id}/resolve`, { method: "POST", body: JSON.stringify(data) }),
  listInvestments: () => request("/investments"),
  // Time corrections (dwustronna akceptacja)
  timeCorrectionCreate: (data: { entry_id?: string; corr_type: string; proposed_start?: string; proposed_end?: string; reason: string; staff_id?: string; event_id?: string }) =>
    request("/time-corrections", { method: "POST", body: JSON.stringify(data) }),
  timeCorrections: (params?: { status?: string; staff_id?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.staff_id) q.set("staff_id", params.staff_id);
    const qs = q.toString();
    return request(`/time-corrections${qs ? `?${qs}` : ""}`);
  },
  timeCorrectionApprove: (id: string) => request(`/time-corrections/${id}/approve`, { method: "POST" }),
  timeCorrectionReject: (id: string) => request(`/time-corrections/${id}/reject`, { method: "POST" }),
  timeCorrectionCancel: (id: string) => request(`/time-corrections/${id}/cancel`, { method: "POST" }),
  timeTeam: (date?: string) => request(`/time/team${date ? `?date=${date}` : ""}`),
  mySchedule: (from?: string, to?: string) => {
    const p = new URLSearchParams();
    if (from) p.set("date_from", from);
    if (to) p.set("date_to", to);
    return request(`/staff/my/schedule${p.toString() ? `?${p.toString()}` : ""}`);
  },
  // Staff availability (Dostępność pracowników)
  availabilityMy: (from?: string, to?: string) => {
    const p = new URLSearchParams();
    if (from) p.set("date_from", from);
    if (to) p.set("date_to", to);
    return request(`/availability/my${p.toString() ? `?${p.toString()}` : ""}`);
  },
  availabilitySet: (date: string, data: { status: string; all_day?: boolean; time_from?: string; time_to?: string; note?: string }) =>
    request(`/availability/my/${date}`, { method: "PUT", body: JSON.stringify(data) }),
  availabilityTeam: (from?: string, to?: string) => {
    const p = new URLSearchParams();
    if (from) p.set("date_from", from);
    if (to) p.set("date_to", to);
    return request(`/availability/team${p.toString() ? `?${p.toString()}` : ""}`);
  },
  availabilityForDate: (date: string) => request(`/availability/for-date?date=${encodeURIComponent(date)}`),
  // Indywidualne uprawnienia + audyt
  staffGetPermissions: (staff_id: string) => request(`/staff/${staff_id}/permissions`),
  staffSetPermissions: (staff_id: string, permissions: Record<string, boolean>) =>
    request(`/staff/${staff_id}/permissions`, { method: "PUT", body: JSON.stringify({ permissions }) }),
  eventAudit: (event_id: string) => request(`/events/${event_id}/audit`),
  timeStart: (data?: { event_id?: string; note?: string }) =>
    request("/time-entries/start", { method: "POST", body: JSON.stringify(data || {}) }),
  timeStop: (data?: { entry_id?: string; note?: string }) =>
    request("/time-entries/stop", { method: "POST", body: JSON.stringify(data || {}) }),
  timeMy: (limit?: number) => request(`/time-entries/my${limit ? `?limit=${limit}` : ""}`),
  timeAll: (params?: { staff_id?: string; date_from?: string; date_to?: string; unpaid_only?: boolean }) => {
    const p = new URLSearchParams();
    if (params?.staff_id) p.set("staff_id", params.staff_id);
    if (params?.date_from) p.set("date_from", params.date_from);
    if (params?.date_to) p.set("date_to", params.date_to);
    if (params?.unpaid_only) p.set("unpaid_only", "true");
    return request(`/time-entries${p.toString() ? `?${p.toString()}` : ""}`);
  },
  timePatch: (id: string, patch: any) => request(`/time-entries/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  timeDelete: (id: string) => request(`/time-entries/${id}`, { method: "DELETE" }),

  // Payroll
  payrollSummary: (params?: { date_from?: string; date_to?: string; unpaid_only?: boolean }) => {
    const p = new URLSearchParams();
    if (params?.date_from) p.set("date_from", params.date_from);
    if (params?.date_to) p.set("date_to", params.date_to);
    if (params?.unpaid_only === false) p.set("unpaid_only", "false");
    return request(`/payroll/summary${p.toString() ? `?${p.toString()}` : ""}`);
  },
  payrollMarkPaid: (data: { date_from: string; date_to: string; staff_id?: string; create_expense?: boolean; note?: string }) =>
    request("/payroll/mark-paid", { method: "POST", body: JSON.stringify(data) }),

  // Assets (Majątek)
  assetsList: (q?: string) => request(`/assets${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  assetsAdd: (data: { name: string; qty?: number; value?: number; photo_base64?: string | null; notes?: string }) =>
    request("/assets", { method: "POST", body: JSON.stringify(data) }),
  assetsUpdate: (id: string, patch: any) => request(`/assets/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  assetsDelete: (id: string) => request(`/assets/${id}`, { method: "DELETE" }),

  // ---------- Checklists (event tasks) ----------
  listChecklistTemplates: () => request("/checklist-templates"),
  createChecklistTemplate: (data: { title: string; event_types?: string[] | null; order?: number }) =>
    request("/checklist-templates", { method: "POST", body: JSON.stringify(data) }),
  updateChecklistTemplate: (id: string, data: { title: string; event_types?: string[] | null; order?: number }) =>
    request(`/checklist-templates/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteChecklistTemplate: (id: string) =>
    request(`/checklist-templates/${id}`, { method: "DELETE" }),

  getEventChecklist: (eventId: string) => request(`/events/${eventId}/checklist`),
  initEventChecklist: (eventId: string) =>
    request(`/events/${eventId}/checklist/init`, { method: "POST" }),
  addChecklistTask: (eventId: string, title: string) =>
    request(`/events/${eventId}/checklist`, { method: "POST", body: JSON.stringify({ title }) }),
  patchChecklistTask: (eventId: string, taskId: string, patch: { title?: string; done?: boolean; order?: number }) =>
    request(`/events/${eventId}/checklist/${taskId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteChecklistTask: (eventId: string, taskId: string) =>
    request(`/events/${eventId}/checklist/${taskId}`, { method: "DELETE" }),

  myChecklists: (days?: number) => request(`/staff/my/checklists${days ? `?days=${days}` : ""}`),

  // ---------- Event Payments (Faza 2) ----------
  getEventPayments: (eventId: string) => request(`/events/${eventId}/payments`),
  addEventPayment: (eventId: string, data: { amount: number; date: string; method?: string; note?: string; kind?: string }) =>
    request(`/events/${eventId}/payments`, { method: "POST", body: JSON.stringify(data) }),
  editEventPayment: (eventId: string, paymentId: string, patch: { amount?: number; date?: string; method?: string; note?: string; kind?: string }) =>
    request(`/events/${eventId}/payments/${paymentId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteEventPayment: (eventId: string, paymentId: string) =>
    request(`/events/${eventId}/payments/${paymentId}`, { method: "DELETE" }),

  // ---------- Finance v2 (Faza 3B) ----------
  financeSummaryV2: (params: { date_from?: string; date_to?: string; period?: "current_month" | "prev_month" | "current_year" }) => {
    const q = new URLSearchParams();
    if (params.period) q.set("period", params.period);
    if (params.date_from) q.set("date_from", params.date_from);
    if (params.date_to) q.set("date_to", params.date_to);
    return request(`/finance/summary-v2${q.toString() ? `?${q}` : ""}`);
  },
  financeMonthlySeries: (year?: number) =>
    request(`/finance/monthly-series${year ? `?year=${year}` : ""}`),

  // ---------- Partner Settlements (Faza 4A) ----------
  listPartnerSettlements: (params?: { partner_id?: string; date_from?: string; date_to?: string }) => {
    const q = new URLSearchParams();
    if (params?.partner_id) q.set("partner_id", params.partner_id);
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    return request(`/partner-settlements${q.toString() ? `?${q}` : ""}`);
  },
  partnerSettlementsSummary: (params?: { date_from?: string; date_to?: string }) => {
    const q = new URLSearchParams();
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    return request(`/partner-settlements/summary${q.toString() ? `?${q}` : ""}`);
  },
  createPartnerSettlement: (data: { partner_id: string; amount: number; date: string; method?: string; note?: string; kind?: string }) =>
    request("/partner-settlements", { method: "POST", body: JSON.stringify(data) }),
  updatePartnerSettlement: (id: string, patch: { amount?: number; date?: string; method?: string; note?: string; kind?: string }) =>
    request(`/partner-settlements/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deletePartnerSettlement: (id: string) =>
    request(`/partner-settlements/${id}`, { method: "DELETE" }),

  // Toggle staff role (Wspólnik / Pracownik)
  updateStaffType: (staffId: string, staffType: "employee" | "partner") =>
    request(`/staff/${staffId}`, { method: "PUT", body: JSON.stringify({ staff_type: staffType }) }),

  // ---------- AI Asystent (GPT 5.6 Terra) ----------
  aiAssistantTips: (periodDays: number = 14) =>
    request("/ai/assistant-tips", { method: "POST", body: JSON.stringify({ period_days: periodDays }) }),
  aiGenerateOffer: (brief: string, tone: "profesjonalny" | "ciepły" | "krótki" = "profesjonalny") =>
    request("/ai/generate-offer", { method: "POST", body: JSON.stringify({ brief, tone }) }),
  aiChat: (sessionId: string, message: string) =>
    request("/ai/chat", { method: "POST", body: JSON.stringify({ session_id: sessionId, message }) }),
  aiChatHistory: (sessionId?: string) =>
    request(`/ai/chat/history${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ""}`),
  aiChatClear: (sessionId?: string) =>
    request(`/ai/chat/history${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ""}`, { method: "DELETE" }),
  aiCostCoach: (year?: number, month?: number) =>
    request("/ai/cost-coach", { method: "POST", body: JSON.stringify({ year, month }) }),

  // AI Oferta: wysyłka, podsumowanie, wykrywanie typu, klienci
  aiDetectKind: (brief: string) =>
    request("/ai/detect-kind", { method: "POST", body: JSON.stringify({ brief }) }),
  aiGenerateSummary: (eventId: string) =>
    request("/ai/generate-summary", { method: "POST", body: JSON.stringify({ event_id: eventId }) }),
  aiSendOfferEmail: (payload: {
    to_email: string;
    client_name?: string;
    subject?: string;
    body_text: string;
    event_kind: "okolicznosciowa" | "firmowa";
    mode: "offer" | "summary";
    event_id?: string;
    attach_offer_pdf?: boolean;
  }) => request("/ai/send-offer-email", { method: "POST", body: JSON.stringify(payload) }),
  listKnownClients: (q?: string) =>
    request(`/clients/known${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  expensesAiCategorize: (opts?: { ids?: string[]; limit?: number; dry_run?: boolean }) =>
    request("/expenses/ai-categorize", { method: "POST", body: JSON.stringify(opts || {}) }),
  // Misc revenues (Pozostałe przychody)
  listMiscRevenues: (params?: { date_from?: string; date_to?: string }) => {
    const p: string[] = [];
    if (params?.date_from) p.push(`date_from=${params.date_from}`);
    if (params?.date_to)   p.push(`date_to=${params.date_to}`);
    return request(`/misc-revenues${p.length ? `?${p.join("&")}` : ""}`);
  },
  createMiscRevenue: (data: { date: string; amount: number; description?: string; category?: string }) =>
    request("/misc-revenues", { method: "POST", body: JSON.stringify(data) }),
  updateMiscRevenue: (id: string, data: { date: string; amount: number; description?: string; category?: string }) =>
    request(`/misc-revenues/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteMiscRevenue: (id: string) => request(`/misc-revenues/${id}`, { method: "DELETE" }),
  // Custom expense categories
  listCustomCategories: () => request("/expense-categories/custom"),
  createCustomCategory: (data: { label: string; color?: string }) =>
    request("/expense-categories/custom", { method: "POST", body: JSON.stringify(data) }),
  deleteCustomCategory: (id: string) =>
    request(`/expense-categories/custom/${id}`, { method: "DELETE" }),
  // Thank-you email + discount codes
  getThankYouSettings: () => request("/settings/thank-you-email"),
  saveThankYouSettings: (patch: {
    enabled?: boolean; subject?: string; body_template?: string;
    google_review_url?: string; discount_pct?: number; valid_months?: number;
  }) => request("/settings/thank-you-email", { method: "PUT", body: JSON.stringify(patch) }),
  eventThanksStatus: (eventId: string) => request(`/events/${eventId}/thanks-status`),
  eventThanksPreview: (eventId: string) => request(`/events/${eventId}/thanks-preview`),
  eventComplete: (eventId: string, send_thanks: boolean) =>
    request(`/events/${eventId}/complete`, { method: "POST", body: JSON.stringify({ send_thanks }) }),
  eventResendThanks: (eventId: string) =>
    request(`/events/${eventId}/resend-thanks`, { method: "POST" }),
  preEventEmailStatus: (eventId: string) =>
    request(`/events/${eventId}/pre-event-email/status`),
  preEventEmailPreview: (eventId: string) =>
    request(`/events/${eventId}/pre-event-email/preview`),
  preEventEmailRegulation: (eventId: string) =>
    requestBlob(`/events/${eventId}/pre-event-email/regulation`),
  preEventEmailSendNow: (eventId: string) =>
    request(`/events/${eventId}/pre-event-email/send-now`, { method: "POST" }),
  preEventEmailResend: (eventId: string) =>
    request(`/events/${eventId}/pre-event-email/resend`, { method: "POST" }),
  discountsForClient: (email: string) =>
    request(`/discounts/for-client?email=${encodeURIComponent(email)}`),
  applyDiscount: (eventId: string, code: string) =>
    request(`/events/${eventId}/apply-discount`, { method: "POST", body: JSON.stringify({ code }) }),
  removeDiscount: (eventId: string) =>
    request(`/events/${eventId}/remove-discount`, { method: "POST" }),
  listDiscounts: (status?: "active" | "used" | "expired") =>
    request(`/discounts/list${status ? `?status_filter=${status}` : ""}`),
  createManualDiscount: (data: {
    client_name: string; client_email?: string;
    amount_pct?: number; valid_months?: number;
    note?: string; send_email?: boolean;
  }) => request("/discounts/manual", { method: "POST", body: JSON.stringify(data) }),
  // Gmail (read-only)
  gmailStatus: () => request("/gmail/status"),
  gmailOauthStart: () => request("/gmail/oauth/start"),
  gmailDisconnect: () => request("/gmail/disconnect", { method: "POST" }),
  gmailMessages: (limit = 25) => request(`/gmail/messages?limit=${limit}`),
  gmailMessage: (id: string) => request(`/gmail/messages/${id}`),
};

import * as Print from "expo-print";
import { Platform } from "react-native";
import { MONTHS_PL, formatPLN } from "./theme";
import { categoryLabel } from "./categories";

function escapeHtml(s: any): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type PrintScheduleInput = {
  year: number;
  month: number; // 0-11
  events: any[];
  staff: any[];
  ownerName?: string;
  includePay?: boolean; // false → no rates/payout amounts (safe to hang on the wall)
};

export function buildScheduleHtml({ year, month, events, staff, ownerName, includePay = true }: PrintScheduleInput): string {
  const staffMap: Record<string, any> = {};
  staff.forEach(s => staffMap[s.id] = s);

  // Group events by date within this month
  const monthEvents = events
    .filter(e => {
      try {
        const [y, m] = e.date.split("-").map((x: string) => parseInt(x, 10));
        return y === year && m === month + 1;
      } catch { return false; }
    })
    .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));

  // Per-staff totals for the month
  const perStaff: Record<string, { name: string; role: string; hours: number; amount: number; rate: number }> = {};
  monthEvents.forEach(ev => {
    (ev.shifts || []).forEach((sh: any) => {
      const s = staffMap[sh.staff_id];
      if (!s) return;
      const row = perStaff[sh.staff_id] || { name: s.name, role: s.role || "", hours: 0, amount: 0, rate: s.hourly_rate || 0 };
      row.hours += Number(sh.hours) || 0;
      row.amount += (Number(sh.hours) || 0) * (Number(s.hourly_rate) || 0);
      perStaff[sh.staff_id] = row;
    });
  });
  const staffTotals = Object.values(perStaff).sort((a, b) => b.amount - a.amount);
  const grandHours = staffTotals.reduce((s, r) => s + r.hours, 0);
  const grandAmount = staffTotals.reduce((s, r) => s + r.amount, 0);

  const eventRows = monthEvents.map(ev => {
    const dateStr = ev.date;
    const dObj = new Date(ev.date);
    const weekday = dObj.toLocaleDateString("pl-PL", { weekday: "short" });
    const shiftsHtml = (ev.shifts || []).map((sh: any) => {
      const s = staffMap[sh.staff_id];
      if (!s) return "";
      const amt = (Number(sh.hours) || 0) * (Number(s.hourly_rate) || 0);
      const time = sh.time_start ? `${sh.time_start}${sh.time_end ? `–${sh.time_end}` : ""}` : "";
      return `<span class="chip">${escapeHtml(s.name)}${time ? " · " + escapeHtml(time) : ""} · ${(Number(sh.hours) || 0).toFixed(1)} h${includePay ? " · " + escapeHtml(formatPLN(amt)) : ""}</span>`;
    }).join(" ");
    const catHtml = ev.category ? `<div class="cat">${escapeHtml(categoryLabel(ev.category))}</div>` : "";
    return `
      <tr>
        <td class="date">
          <div class="d1">${escapeHtml(dateStr.slice(8, 10))}</div>
          <div class="d2">${escapeHtml(weekday)}</div>
        </td>
        <td>
          <div class="ev-name">${escapeHtml(ev.name)}</div>
          <div class="ev-meta">${escapeHtml(ev.time || "—")} · ${escapeHtml(ev.venue || "Bez lokalizacji")}</div>
          ${catHtml}
          <div class="shifts">${shiftsHtml || '<span class="empty">— brak przypisanych pracowników —</span>'}</div>
        </td>
      </tr>`;
  }).join("");

  const summaryRows = staffTotals.map(r => `
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.role || "—")}</td>
      <td class="num">${r.hours.toFixed(1)} h</td>
      <td class="num">${escapeHtml(formatPLN(r.rate))}/h</td>
      <td class="num strong">${escapeHtml(formatPLN(r.amount))}</td>
    </tr>`).join("");

  return `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><title>Grafik ${MONTHS_PL[month]} ${year}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #0C0C0E; margin: 0; padding: 24px; background: #fff; }
  .hero { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #2E7D46; padding-bottom: 12px; margin-bottom: 20px; }
  .brand { font-size: 12px; letter-spacing: 4px; color: #2E7D46; font-weight: 700; margin-bottom: 4px; }
  h1 { font-size: 28px; margin: 0; letter-spacing: -0.5px; }
  .subtitle { color: #555; font-size: 13px; margin-top: 4px; }
  .meta { font-size: 12px; color: #777; text-align: right; }
  h2 { font-size: 14px; letter-spacing: 3px; color: #2E7D46; text-transform: uppercase; margin: 24px 0 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  thead th { background: #1B3A26; color: #fff; text-align: left; padding: 8px 10px; font-size: 11px; letter-spacing: 1px; }
  tbody td { padding: 10px; border-bottom: 1px solid #E5E5E5; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #FAFAF6; }
  .date { width: 70px; text-align: center; }
  .d1 { font-size: 22px; font-weight: 800; line-height: 1; }
  .d2 { font-size: 10px; color: #777; margin-top: 2px; text-transform: uppercase; letter-spacing: 1px; }
  .ev-name { font-weight: 700; font-size: 15px; margin-bottom: 3px; }
  .ev-meta { color: #555; font-size: 12px; margin-bottom: 6px; }
  .cat { color: #2E7D46; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 6px; }
  .shifts { margin-top: 6px; }
  .chip { display: inline-block; background: #E7F3EA; color: #1F4D2E; border: 1px solid #BFDCC7; border-radius: 999px; padding: 2px 10px; font-size: 11px; margin: 2px 4px 2px 0; }
  .empty { color: #999; font-style: italic; font-size: 11px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .strong { font-weight: 800; color: #1F4D2E; }
  tfoot td { background: #EDF6EF; padding: 10px; border-top: 3px solid #2E7D46; font-weight: 800; }
  .empty-block { padding: 40px; text-align: center; border: 2px dashed #ddd; border-radius: 8px; color: #999; }
  @media print { body { padding: 12mm; } .hero { page-break-after: avoid; } table { page-break-inside: auto; } tr { page-break-inside: avoid; } }
</style></head>
<body>
  <div class="hero">
    <div>
      <div class="brand">BIESIADA POD LASEM</div>
      <h1>Grafik pracowników — ${MONTHS_PL[month]} ${year}</h1>
      <div class="subtitle">${ownerName ? escapeHtml(ownerName) + " · " : ""}${monthEvents.length} ${monthEvents.length === 1 ? "impreza" : "imprez"}</div>
    </div>
    <div class="meta">Wydrukowano: ${new Date().toLocaleString("pl-PL")}</div>
  </div>

  <h2>Harmonogram imprez</h2>
  ${monthEvents.length === 0
    ? `<div class="empty-block">Brak imprez w tym miesiącu.</div>`
    : `<table>
        <thead><tr><th>Data</th><th>Impreza i przypisani pracownicy</th></tr></thead>
        <tbody>${eventRows}</tbody>
      </table>`}

  ${!includePay ? "" : `<h2>Podsumowanie wypłat</h2>
  ${staffTotals.length === 0
    ? `<div class="empty-block">Brak zmian pracowników w tym miesiącu.</div>`
    : `<table>
        <thead><tr><th>Pracownik</th><th>Stanowisko</th><th class="num">Godziny</th><th class="num">Stawka</th><th class="num">Do wypłaty</th></tr></thead>
        <tbody>${summaryRows}</tbody>
        <tfoot><tr>
          <td colspan="2">RAZEM</td>
          <td class="num">${grandHours.toFixed(1)} h</td>
          <td></td>
          <td class="num strong">${escapeHtml(formatPLN(grandAmount))}</td>
        </tr></tfoot>
      </table>`}`}
</body></html>`;
}

export async function printSchedule(input: PrintScheduleInput) {
  const html = buildScheduleHtml(input);
  if (Platform.OS === "web") {
    // Open in a new window and trigger print
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 400);
  } else {
    await Print.printAsync({ html });
  }
}

// ==== Month calendar print (grid view) ====
export function buildMonthCalendarHtml({ year, month, events, ownerName }: PrintScheduleInput): string {
  const monthEvents = events.filter(e => {
    try {
      const [y, m] = e.date.split("-").map((x: string) => parseInt(x, 10));
      return y === year && m === month + 1;
    } catch { return false; }
  });
  const byDate: Record<string, any[]> = {};
  monthEvents.forEach(ev => {
    (byDate[ev.date] = byDate[ev.date] || []).push(ev);
  });
  Object.values(byDate).forEach(arr => arr.sort((a: any, b: any) => (a.time || "").localeCompare(b.time || "")));

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const startPad = (firstDay + 6) % 7; // Mon=0
  const cells: (number | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const dayLabels = ["Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek", "Sobota", "Niedziela"];

  const rowsHtml = [];
  for (let i = 0; i < cells.length; i += 7) {
    const row = cells.slice(i, i + 7);
    const cellsHtml = row.map(d => {
      if (d === null) return `<td class="empty"></td>`;
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dayEvents = byDate[dateStr] || [];
      const isWeekend = new Date(dateStr).getDay() % 6 === 0;
      const evHtml = dayEvents.map(ev => {
        const label = ev.category ? categoryLabel(ev.category) : "";
        return `<div class="ev">
          <div class="ev-name">${escapeHtml(ev.name)}</div>
          <div class="ev-meta">${escapeHtml(ev.time || "")}${ev.venue ? " · " + escapeHtml(ev.venue) : ""}</div>
          ${label ? `<div class="ev-cat">${escapeHtml(label)}</div>` : ""}
        </div>`;
      }).join("");
      return `<td class="${isWeekend ? "weekend" : ""}">
        <div class="daynum">${d}</div>
        ${evHtml}
      </td>`;
    }).join("");
    rowsHtml.push(`<tr>${cellsHtml}</tr>`);
  }

  return `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><title>Kalendarz ${MONTHS_PL[month]} ${year}</title>
<style>
  * { box-sizing: border-box; }
  @page { size: A4 landscape; margin: 10mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #0C0C0E; margin: 0; padding: 12px; background: #fff; }
  .hero { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #D4AF37; padding-bottom: 10px; margin-bottom: 14px; }
  .brand { font-size: 11px; letter-spacing: 4px; color: #D4AF37; font-weight: 700; margin-bottom: 2px; }
  h1 { font-size: 24px; margin: 0; letter-spacing: -0.5px; }
  .subtitle { color: #555; font-size: 12px; margin-top: 2px; }
  .meta { font-size: 11px; color: #777; text-align: right; }
  table.cal { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.cal thead th { background: #0C0C0E; color: #D4AF37; padding: 6px 4px; font-size: 10px; letter-spacing: 1px; text-align: center; text-transform: uppercase; border: 1px solid #0C0C0E; }
  table.cal td { border: 1px solid #E0E0E0; vertical-align: top; padding: 4px 5px; height: 120px; width: calc(100% / 7); overflow: hidden; }
  table.cal td.empty { background: #FAFAFA; }
  table.cal td.weekend { background: #FDF9EE; }
  .daynum { font-size: 15px; font-weight: 800; margin-bottom: 3px; color: #333; }
  .ev { background: #F4EDD8; border-left: 3px solid #D4AF37; padding: 3px 5px; margin-bottom: 3px; border-radius: 3px; page-break-inside: avoid; }
  .ev-name { font-size: 10px; font-weight: 700; color: #0C0C0E; line-height: 1.2; }
  .ev-meta { font-size: 8px; color: #555; margin-top: 1px; line-height: 1.2; }
  .ev-cat { font-size: 8px; color: #B8901F; font-weight: 700; margin-top: 1px; }
</style></head>
<body>
  <div class="hero">
    <div>
      <div class="brand">BIESIADA POD LASEM</div>
      <h1>Kalendarz — ${MONTHS_PL[month]} ${year}</h1>
      <div class="subtitle">${ownerName ? escapeHtml(ownerName) + " · " : ""}${monthEvents.length} ${monthEvents.length === 1 ? "impreza" : "imprez"}</div>
    </div>
    <div class="meta">Wydrukowano: ${new Date().toLocaleString("pl-PL")}</div>
  </div>
  <table class="cal">
    <thead><tr>${dayLabels.map(d => `<th>${d}</th>`).join("")}</tr></thead>
    <tbody>${rowsHtml.join("")}</tbody>
  </table>
</body></html>`;
}

export async function printMonthCalendar(input: PrintScheduleInput) {
  const html = buildMonthCalendarHtml(input);
  if (Platform.OS === "web") {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 400);
  } else {
    await Print.printAsync({ html, orientation: Print.Orientation.landscape });
  }
}

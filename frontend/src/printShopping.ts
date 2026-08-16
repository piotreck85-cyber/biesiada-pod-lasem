import * as Print from "expo-print";
import { Platform } from "react-native";

const CAT_LABELS: Record<string, string> = {
  mieso: "Mięso", warzywa: "Warzywa", nabial: "Nabiał", pieczywo: "Pieczywo",
  spozywcze: "Spożywcze", napoje: "Napoje", kawa: "Kawa/Herbata",
  jednorazowki: "Jednorazówki", srodki: "Środki czystości", dekoracje: "Dekoracje",
  catering: "Catering", grill: "Grill", dodatkowe: "Dodatkowe", inne: "Inne",
};
const CAT_COLORS: Record<string, string> = {
  mieso: "#DC2626", warzywa: "#16A34A", nabial: "#F59E0B", pieczywo: "#A16207",
  spozywcze: "#7C3AED", napoje: "#0EA5E9", kawa: "#8B5CF6",
  jednorazowki: "#10B981", srodki: "#06B6D4", dekoracje: "#EC4899",
  catering: "#F97316", grill: "#EF4444", dodatkowe: "#6B7280", inne: "#9CA3AF",
};
const CAT_ORDER = ["mieso","warzywa","nabial","pieczywo","spozywcze","napoje","kawa","jednorazowki","srodki","dekoracje","dodatkowe","catering","grill","inne"];

const fmtPLN = (v: number) => (v || 0).toLocaleString("pl-PL", { style: "currency", currency: "PLN" });
const fmtQty = (v: number) => Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, "");

const baseCss = `
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111827; margin: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; color: #111827; }
  .sub { color: #6B7280; font-size: 12px; margin-bottom: 16px; }
  .badge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:10px; font-weight:800; margin-left:6px; }
  .hero { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 12px 0; }
  .hero .box { background:#F0FDF4; border:1px solid #10B98144; border-radius:10px; padding:10px; }
  .hero .k { color:#6B7280; font-size:10px; letter-spacing:0.5px; font-weight:700; }
  .hero .v { color:#065F46; font-size:18px; font-weight:800; margin-top:2px; }
  .cat { margin-top: 18px; border:1px solid #E5E7EB; border-radius:10px; padding: 10px 12px; }
  .cat-title { display:flex; align-items:center; gap:8px; font-size:14px; font-weight:800; margin-bottom:8px; }
  .dot { width:10px; height:10px; border-radius:99px; display:inline-block; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; font-size:10px; font-weight:700; color:#6B7280; letter-spacing:0.5px; padding: 4px 6px; border-bottom:1px solid #E5E7EB; }
  td { padding: 6px 6px; border-bottom: 1px dashed #F3F4F6; font-size:12px; }
  td.qty { text-align:right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.check { width:22px; text-align:center; }
  .check-box { display:inline-block; width:14px; height:14px; border:1.5px solid #9CA3AF; border-radius:3px; vertical-align:middle; }
  .expBadge { display:inline-block; padding:1px 6px; border-radius:6px; font-size:9px; font-weight:800; letter-spacing:0.4px; margin-left:6px; }
  .exp-expired { background:#FEE2E2; color:#B91C1C; }
  .exp-urgent  { background:#FFEDD5; color:#C2410C; }
  .exp-soon    { background:#FEF3C7; color:#B45309; }
  .exp-ok      { background:#DCFCE7; color:#15803D; }
  .footer { margin-top: 28px; color:#9CA3AF; font-size: 10px; text-align: right; }
  @media print { @page { margin: 12mm; } .no-print { display: none; } }
`;

function groupBy<T extends { category?: string }>(rows: T[]): Record<string, T[]> {
  const m: Record<string, T[]> = {};
  rows.forEach(r => { const k = r.category || "inne"; (m[k] = m[k] || []).push(r); });
  return m;
}
function sortedCats(m: Record<string, any[]>): string[] {
  return Object.keys(m).sort((a, b) => (CAT_ORDER.indexOf(a) === -1 ? 99 : CAT_ORDER.indexOf(a)) - (CAT_ORDER.indexOf(b) === -1 ? 99 : CAT_ORDER.indexOf(b)));
}

/** Build the "to-buy" printable list from /shopping/generate response + saved shopping items */
export async function printShoppingList(gen: any, savedItems: any[] = [], dateFrom: string, dateTo: string) {
  // combine: suggestions (to_buy > 0) + saved todo items
  const rows: any[] = [];
  (gen?.suggestions || []).forEach((s: any) => {
    const q = s.to_buy != null ? s.to_buy : s.qty;
    if (q > 0) rows.push({
      name: s.name, category: s.category, unit: s.unit,
      qty: q, unit_price: s.unit_price, estimated_cost: s.estimated_cost,
      needed: s.needed, stock_qty: s.stock_qty, reserved_qty: s.reserved_qty,
      event_names: s.event_names, kind: "sugestia",
    });
  });
  (savedItems || []).forEach((it: any) => {
    if (it.status === "todo") rows.push({
      name: it.name, category: it.category, unit: it.unit,
      qty: Math.max(0, it.qty - (it.stock_qty || 0)),
      unit_price: it.unit_price, estimated_cost: Math.max(0, it.qty - (it.stock_qty || 0)) * (it.unit_price || 0),
      needed: it.qty, stock_qty: it.stock_qty || 0, reserved_qty: 0,
      event_names: it.event_names, kind: "moja",
    });
  });

  const grouped = groupBy(rows);
  const cats = sortedCats(grouped);
  const total = rows.reduce((s, r) => s + (r.estimated_cost || 0), 0);
  const now = new Date().toLocaleString("pl-PL");

  const sectionsHtml = cats.map(c => {
    const items = grouped[c].sort((a: any, b: any) => a.name.localeCompare(b.name));
    const sub = items.reduce((s: number, r: any) => s + (r.estimated_cost || 0), 0);
    return `
      <div class="cat">
        <div class="cat-title">
          <span class="dot" style="background:${CAT_COLORS[c] || "#9CA3AF"}"></span>
          ${CAT_LABELS[c] || c}
          <span style="margin-left:auto;color:#6B7280;font-weight:600;font-size:11px;">${items.length} poz. · ~${fmtPLN(sub)}</span>
        </div>
        <table>
          <tbody>
            ${items.map((r: any) => `
              <tr>
                <td class="check" style="width:22px"><span class="check-box"></span></td>
                <td><strong>${escapeHtml(r.name)}</strong></td>
                <td class="qty" style="white-space:nowrap"><strong>${fmtQty(r.qty)} ${r.unit || ""}</strong></td>
                <td class="qty" style="width:80px;color:#6B7280;white-space:nowrap">${r.estimated_cost ? "~" + fmtPLN(r.estimated_cost) : ""}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>`;
  }).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"/>
    <style>${baseCss}</style>
    <title>Lista zakupów — Biesiada pod lasem</title></head>
    <body>
      <h1>LISTA ZAKUPÓW · ${escapeHtml(dateFrom || "")}${dateTo && dateTo !== dateFrom ? " – " + escapeHtml(dateTo) : ""}</h1>
      <div class="sub">
        <strong>${rows.length}</strong> produktów do kupienia
        · Szacowany koszt: <strong>${fmtPLN(total)}</strong>
        · wygenerowano ${now}
      </div>
      ${rows.length === 0 ? '<p style="color:#6B7280;text-align:center;padding:24px;">Nic nie trzeba kupować — wszystko jest w magazynie ✓</p>' : sectionsHtml}
      <div class="footer">Biesiada pod lasem</div>
    </body></html>`;

  try {
    if (Platform.OS === "web") {
      const w = window.open("", "_blank");
      if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
    } else {
      await Print.printAsync({ html });
    }
  } catch (e) {
    console.warn("print error", e);
  }
}

/** Build a printable list of the entire stock (Magazyn) */
export async function printStockList(items: any[]) {
  const now = new Date().toLocaleString("pl-PL");
  const grouped = groupBy(items);
  const cats = sortedCats(grouped);
  const expLabel = (st?: string) => {
    switch (st) {
      case "expired": return `<span class="expBadge exp-expired">PO TERMINIE</span>`;
      case "urgent":  return `<span class="expBadge exp-urgent">1–3 dni</span>`;
      case "soon":    return `<span class="expBadge exp-soon">≤7 dni</span>`;
      case "ok":      return `<span class="expBadge exp-ok">OK</span>`;
      default:        return "";
    }
  };
  const totals = {
    total: items.length,
    expired: items.filter(i => i.expiry_status === "expired").length,
    urgent:  items.filter(i => i.expiry_status === "urgent").length,
    soon:    items.filter(i => i.expiry_status === "soon").length,
  };

  const sectionsHtml = cats.map(c => {
    const its = grouped[c].sort((a: any, b: any) => a.name.localeCompare(b.name));
    return `
      <div class="cat">
        <div class="cat-title">
          <span class="dot" style="background:${CAT_COLORS[c] || "#9CA3AF"}"></span>
          ${CAT_LABELS[c] || c}
          <span style="margin-left:auto;color:#6B7280;font-weight:600;font-size:11px;">${its.length} poz.</span>
        </div>
        <table>
          <thead>
            <tr>
              <th style="width:22px">✓</th>
              <th>Nazwa</th>
              <th class="qty">Ilość</th>
              <th class="qty">Zarezerwowane</th>
              <th class="qty">Dostępne</th>
              <th>Ważność</th>
            </tr>
          </thead>
          <tbody>
            ${its.map((r: any) => `
              <tr>
                <td class="check"><span class="check-box"></span></td>
                <td>
                  <strong>${escapeHtml(r.name)}</strong>
                  ${r.notes ? `<div style="color:#9CA3AF;font-size:10px">${escapeHtml(r.notes)}</div>` : ""}
                </td>
                <td class="qty"><strong>${fmtQty(r.qty || 0)} ${r.unit || ""}</strong></td>
                <td class="qty">${r.reserved_qty ? fmtQty(r.reserved_qty) + " " + r.unit : "—"}</td>
                <td class="qty">${r.available_qty != null ? fmtQty(r.available_qty) + " " + r.unit : "—"}</td>
                <td>${r.expiry_date ? escapeHtml(r.expiry_date) : "—"} ${expLabel(r.expiry_status)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>`;
  }).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"/>
    <style>${baseCss}</style>
    <title>Magazyn — Biesiada pod lasem</title></head>
    <body>
      <h1>Stan magazynu · Biesiada pod lasem</h1>
      <div class="sub">Wydrukowano ${now}</div>
      <div class="hero">
        <div class="box"><div class="k">POZYCJI</div><div class="v">${totals.total}</div></div>
        <div class="box" style="background:#FEF2F2;border-color:#EF444466;"><div class="k">PO TERMINIE</div><div class="v" style="color:#B91C1C;">${totals.expired}</div></div>
        <div class="box" style="background:#FFF7ED;border-color:#F9731666;"><div class="k">1–3 DNI</div><div class="v" style="color:#C2410C;">${totals.urgent}</div></div>
        <div class="box" style="background:#FFFBEB;border-color:#F59E0B66;"><div class="k">≤7 DNI</div><div class="v" style="color:#B45309;">${totals.soon}</div></div>
      </div>
      ${items.length === 0 ? '<p style="color:#6B7280;text-align:center;padding:24px;">Magazyn jest pusty.</p>' : sectionsHtml}
      <div class="footer">Biesiada pod lasem · Aplikacja zarządcza</div>
    </body></html>`;

  try {
    if (Platform.OS === "web") {
      const w = window.open("", "_blank");
      if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
    } else {
      await Print.printAsync({ html });
    }
  } catch (e) {
    console.warn("print stock error", e);
  }
}

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

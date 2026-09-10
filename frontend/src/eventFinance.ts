/** Gross unit price, discount before VAT split; money is rounded in integer cents. */
export type EventFinance = { subtotal: number; discount: number; gross: number; net: number; vat: number; costs: number; profit: number; paidPeople: number; freeCarers: number; attendees: number };
function scaled(value: string | number, max: number, label: string, scale = 100) {
  const text = String(value ?? '').replace(/\s/g, '').replace(',', '.') || '0';
  if (!(scale === 1 ? /^\d+$/ : /^\d+(?:\.\d{1,2})?$/).test(text)) throw new Error(`Nieprawidłowe pole: ${label}.`);
  const number = Number(text);
  if (!Number.isFinite(number) || number > max) throw new Error(`Zbyt duża wartość: ${label}.`);
  return Math.round(number * scale);
}
export function calculateEventFinance(price: string | number, people: string | number, discount: string | number, costs: string | number, carers: string | number): EventFinance {
  const unit = scaled(price, 1000000, 'cena za osobę');
  const paidPeople = scaled(people, 100000, 'liczba płatnych osób', 1);
  const freeCarers = scaled(carers, 100000, 'opiekunowie gratis', 1);
  const basisPoints = scaled(discount, 100, 'rabat');
  const costsCents = scaled(costs, 100000000, 'koszty');
  const subtotal = unit * paidPeople;
  if (subtotal > 10000000000) throw new Error('Wartość wydarzenia jest zbyt duża.');
  const reduction = Math.round(subtotal * basisPoints / 10000);
  const gross = subtotal - reduction;
  const net = Math.round(gross * 100 / 123);
  return { subtotal: subtotal / 100, discount: reduction / 100, gross: gross / 100,
    net: net / 100, vat: (gross - net) / 100, costs: costsCents / 100, profit: (gross - costsCents) / 100,
    paidPeople, freeCarers, attendees: paidPeople + freeCarers };
}

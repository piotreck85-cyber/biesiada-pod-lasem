// Dinner menu ("Oferta obiadowa") — client prices from oferta obiadowa (3).docx
// COST prices (hidden) are catering-list prices from Biesiada Pod Lasem (1).pdf minus 20% bulk discount.
// Used ONLY to compute hidden margin/profit — not shown in the client-facing UI.

export type DinnerItem = {
  id: string;
  name: string;
  unit: string;          // "os", "porcja", "szt", "1 kg", "kg"
  base_price: number;    // zł — client-facing final price
  cost_price: number;    // zł — hidden purchase cost per unit
  section: string;
};

export type DinnerSection = {
  id: string;
  title: string;
  note?: string;
};

export const DINNER_SECTIONS: DinnerSection[] = [
  { id: "zupy",       title: "Zupa" },
  { id: "dania",      title: "Danie główne" },
  { id: "dodatki",    title: "Dodatki do dań głównych", note: "Dania wege ustalane indywidualnie" },
];

// Purchase prices below are: catering list price × 0.8 (20% bulk discount from catering).
// Client prices are what the customer pays.
export const DINNER_MENU: DinnerItem[] = [
  // Zupa — client / catering list -20%
  { id: "z1", section: "zupy", name: "Rosół / makaron",                        unit: "os", base_price: 20, cost_price: 14.40 },
  { id: "z2", section: "zupy", name: "Zalewajka świętokrzyska",                unit: "os", base_price: 22, cost_price: 17.60 },
  { id: "z3", section: "zupy", name: "Krem pomidorowo-paprykowy / mozzarella", unit: "os", base_price: 22, cost_price: 17.60 },
  { id: "z4", section: "zupy", name: "Krem z białych warzyw",                  unit: "os", base_price: 22, cost_price: 17.60 },
  // Danie główne
  { id: "d1", section: "dania", name: "Polędwiczka wp / sos serowy z orzechami włoskimi lub sos leśny", unit: "os", base_price: 29, cost_price: 22.40 },
  { id: "d2", section: "dania", name: "Roladka dr / sos serowy",               unit: "os", base_price: 27, cost_price: 20.00 },
  { id: "d3", section: "dania", name: "Kotlet schabowy",                       unit: "os", base_price: 22, cost_price: 14.40 },
  { id: "d4", section: "dania", name: "Filet z kurczaka",                      unit: "os", base_price: 22, cost_price: 14.40 },
  { id: "d5", section: "dania", name: "Filet zapiekany (pomidory suszone & szpinak & mozzarella)", unit: "os", base_price: 27, cost_price: 19.20 },
  { id: "d6", section: "dania", name: "Cordon Blue",                           unit: "os", base_price: 27, cost_price: 19.20 },
  { id: "d7", section: "dania", name: "Karczek pieczony / sos myśliwski",      unit: "os", base_price: 27, cost_price: 20.80 },
  { id: "d8", section: "dania", name: "Kotlet szydłowiecki (faszerowany)",     unit: "os", base_price: 26, cost_price: 19.20 },
  // Dodatki
  { id: "dd1", section: "dodatki", name: "Ziemniaki z wody",       unit: "os", base_price: 8,  cost_price: 6.40 },
  { id: "dd2", section: "dodatki", name: "Ziemniaki opiekane",     unit: "os", base_price: 9,  cost_price: 7.20 },
  { id: "dd3", section: "dodatki", name: "Kluski śląskie",         unit: "os", base_price: 12, cost_price: 8.00 },
  { id: "dd4", section: "dodatki", name: "Kopytka",                unit: "os", base_price: 10, cost_price: 8.00 },
  { id: "dd5", section: "dodatki", name: "Ryż z warzywami",        unit: "os", base_price: 12, cost_price: 8.00 },
  { id: "dd6", section: "dodatki", name: "Zestaw surówek",         unit: "os", base_price: 9,  cost_price: 6.40 },
  { id: "dd7", section: "dodatki", name: "Wiosenna",               unit: "os", base_price: 9,  cost_price: 6.40 },
  { id: "dd8", section: "dodatki", name: "Kapusta zasmażana",      unit: "os", base_price: 10, cost_price: 6.40 },
];

// These are the FINAL client prices — no additional discount applied by the app.
export const DINNER_DISCOUNT = 0;

export function discountedPrice(base: number): number {
  return base;  // Client-facing price is the base price (already final).
}

/**
 * Auto-compute total purchase cost (hidden) for selected dinner items.
 * qty: map of dinner_item_id -> quantity ordered
 */
export function dinnerAutoCost(qty: Record<string, number>): number {
  return DINNER_MENU.reduce((sum, it) => {
    const q = qty[it.id] || 0;
    return sum + q * (it.cost_price || 0);
  }, 0);
}

// ---- Grill package cost data (per person) — used to compute forecast profit ----
// Values set by owner on 2026-08-14.
export const GRILL_SET_COSTS: Record<string, number> = {
  set1: 20,   // 150 zł/os price → ~130 zł profit/os
  set2: 25,   // 180 zł/os price → ~155 zł profit/os
  set3: 28,   // 200 zł/os price → ~172 zł profit/os
};

// Ingredient wholesale cost table — used for reference and future line-item costing.
export const INGREDIENT_COSTS: Record<string, { label: string; cost_per_person: number }> = {
  kielbasa:            { label: "Kiełbasa",            cost_per_person: 5 },
  kaszanka:            { label: "Kaszanka",            cost_per_person: 3 },
  karczek:             { label: "Karczek",             cost_per_person: 3 },
  woda_owocowa:        { label: "Woda owocowa",        cost_per_person: 2 },
  napoje:              { label: "Napoje (wszystko)",   cost_per_person: 8 },
  zurek:               { label: "Żurek",               cost_per_person: 6 },
  warzywa_grill:       { label: "Warzywa grillowane",  cost_per_person: 4 },
  pieczarka_boczek:    { label: "Pieczarka w boczku",  cost_per_person: 5 },
  ziemniaczek_firmowy: { label: "Ziemniaczek firmowy", cost_per_person: 4 },
  sosy:                { label: "Sosy",                cost_per_person: 3 },
  ogorki_kiszone:      { label: "Ogórki kiszone",      cost_per_person: 2 },
};

/**
 * Compute forecast profit for a grill package.
 * price = price_per_person from ADULT_SETS
 * cost = GRILL_SET_COSTS[setId]
 * profit_per_person = price - cost
 * total_profit = profit_per_person * people
 * margin_pct = profit_per_person / price
 */
export function grillProfitForecast(setId: string, pricePerPerson: number, people: number) {
  const cost = GRILL_SET_COSTS[setId] ?? 0;
  const profitPer = Math.max(0, pricePerPerson - cost);
  const total = profitPer * (people || 0);
  const margin = pricePerPerson > 0 ? profitPer / pricePerPerson : 0;
  return { cost_per_person: cost, profit_per_person: profitPer, total_profit: total, margin };
}

// Dinner menu ("Oferta obiadowa") — from Biesiada Pod Lasem (1).pdf
// All prices are BASE (listed). Actual client price = base - 20% (bulk discount).
// Profit forecast per position will be added in a future update when the user provides per-item costs.

export type DinnerItem = {
  id: string;
  name: string;
  unit: string;          // "os", "porcja", "szt", "1 kg", "kg"
  base_price: number;    // zł
  section: string;
};

export type DinnerSection = {
  id: string;
  title: string;
  note?: string;
};

export const DINNER_SECTIONS: DinnerSection[] = [
  { id: "zupy",       title: "Zupy" },
  { id: "dania",      title: "Danie główne" },
  { id: "dodatki",    title: "Dodatki do dań głównych" },
  { id: "goraca",     title: "II danie gorące (do wyboru)" },
  { id: "zimne",      title: "Zimne zakąski", note: "Minimum 10 porcji wybranego rodzaju w zamówieniu" },
  { id: "salatki",    title: "Sałatki" },
];

export const DINNER_MENU: DinnerItem[] = [
  // Zupy
  { id: "z1", section: "zupy", name: "Rosół / makaron",                        unit: "os", base_price: 18 },
  { id: "z2", section: "zupy", name: "Zalewajka świętokrzyska",                unit: "os", base_price: 22 },
  { id: "z3", section: "zupy", name: "Krem pomidorowo-paprykowy / mozzarella", unit: "os", base_price: 22 },
  { id: "z4", section: "zupy", name: "Krem z białych warzyw",                  unit: "os", base_price: 22 },
  // Dania główne
  { id: "d1", section: "dania", name: "Polędwiczka wp / sos serowy z orzechami włoskimi lub sos leśny", unit: "os", base_price: 28 },
  { id: "d2", section: "dania", name: "Roladka dr / sos serowy",               unit: "os", base_price: 25 },
  { id: "d3", section: "dania", name: "Kotlet schabowy",                       unit: "os", base_price: 18 },
  { id: "d4", section: "dania", name: "Filet z kurczaka",                      unit: "os", base_price: 18 },
  { id: "d5", section: "dania", name: "Filet zapiekany (pomidory suszone & szpinak & mozarella)", unit: "os", base_price: 24 },
  { id: "d6", section: "dania", name: "Cordon Blue",                           unit: "os", base_price: 24 },
  { id: "d7", section: "dania", name: "Karczek pieczony / sos myśliwski",      unit: "os", base_price: 26 },
  { id: "d8", section: "dania", name: "Kotlet szydłowiecki (faszerowany)",     unit: "os", base_price: 24 },
  // Dodatki
  { id: "dd1", section: "dodatki", name: "Ziemniaki z wody",       unit: "os", base_price: 8 },
  { id: "dd2", section: "dodatki", name: "Ziemniaki opiekane",     unit: "os", base_price: 9 },
  { id: "dd3", section: "dodatki", name: "Kluski śląskie",         unit: "os", base_price: 10 },
  { id: "dd4", section: "dodatki", name: "Kopytka",                unit: "os", base_price: 10 },
  { id: "dd5", section: "dodatki", name: "Ryż z warzywami",        unit: "os", base_price: 10 },
  { id: "dd6", section: "dodatki", name: "Zestaw surówek",         unit: "os", base_price: 8 },
  { id: "dd7", section: "dodatki", name: "Wiosenna",               unit: "os", base_price: 8 },
  { id: "dd8", section: "dodatki", name: "Kapusta zasmażana",      unit: "os", base_price: 8 },
  // II danie gorące
  { id: "g1", section: "goraca", name: "Gulaszowa",                unit: "os",     base_price: 26 },
  { id: "g2", section: "goraca", name: "Bigos",                    unit: "kg",     base_price: 48 },
  { id: "g3", section: "goraca", name: "Żeberko na kapuście / pikantne", unit: "porcja", base_price: 38 },
  { id: "g4", section: "goraca", name: "Golonka po bawarsku / ogórek kiszony", unit: "porcja", base_price: 39 },
  { id: "g5", section: "goraca", name: "Udko z kurczaka",          unit: "os",     base_price: 22 },
  { id: "g6", section: "goraca", name: "Pierogi zbójnickie",       unit: "szt",    base_price: 6 },
  { id: "g7", section: "goraca", name: "Pierogi ruskie",           unit: "szt",    base_price: 5 },
  { id: "g8", section: "goraca", name: "Pierogi mięsne",           unit: "szt",    base_price: 5 },
  { id: "g9", section: "goraca", name: "Żurek czysty",             unit: "os",     base_price: 9 },
  { id: "g10", section: "goraca", name: "Barszczyk czysty",        unit: "os",     base_price: 12 },
  { id: "g11", section: "goraca", name: "Krokiet",                 unit: "szt",    base_price: 8 },
  // Zimne zakąski (min 10 porcji)
  { id: "za1", section: "zimne", name: "Półmisek mięs (schab warszawski / roladka / karczek / pasztet / boczek / polędwica)", unit: "porcja", base_price: 9 },
  { id: "za2", section: "zimne", name: "Tortilla z kurczakiem / szynką / warzywna", unit: "porcja", base_price: 8 },
  { id: "za3", section: "zimne", name: "Caprese",                  unit: "os",     base_price: 5 },
  { id: "za4", section: "zimne", name: "Koreczki a'la Caprese",    unit: "os",     base_price: 8 },
  { id: "za5", section: "zimne", name: "Nuggetsy w płatkach kukurydzianych / dip", unit: "os", base_price: 9 },
  { id: "za6", section: "zimne", name: "Śledź: w oleju / po węgiersku / po marynarsku", unit: "porcja", base_price: 8 },
  { id: "za7", section: "zimne", name: "Śledź rolmops",            unit: "porcja", base_price: 8 },
  { id: "za8", section: "zimne", name: "Kabanosy w cieście francuskim", unit: "szt", base_price: 7 },
  { id: "za9", section: "zimne", name: "Voulevanty z musem pieczarkowym / szynkowym", unit: "szt", base_price: 6 },
  { id: "za10", section: "zimne", name: "Jajko faszerowane",       unit: "szt",    base_price: 5 },
  { id: "za11", section: "zimne", name: "Koreczki różne rodzaje",  unit: "szt",    base_price: 5 },
  { id: "za12", section: "zimne", name: "Galareta drobiowa / wieprzowa", unit: "porcja", base_price: 9 },
  // Sałatki (1 kg = ~10 porcji)
  { id: "s1", section: "salatki", name: "Farfalle",                unit: "1 kg", base_price: 85 },
  { id: "s2", section: "salatki", name: "Gyros",                   unit: "1 kg", base_price: 85 },
  { id: "s3", section: "salatki", name: "Jarzynowa",               unit: "1 kg", base_price: 85 },
  { id: "s4", section: "salatki", name: "Królewska",               unit: "1 kg", base_price: 85 },
  { id: "s5", section: "salatki", name: "Grecka",                  unit: "1 kg", base_price: 85 },
  { id: "s6", section: "salatki", name: "Cezar",                   unit: "1 kg", base_price: 85 },
  { id: "s7", section: "salatki", name: "Parmeńska",               unit: "1 kg", base_price: 85 },
  { id: "s8", section: "salatki", name: "Chłopska",                unit: "1 kg", base_price: 85 },
  { id: "s9", section: "salatki", name: "Brokułowa",               unit: "1 kg", base_price: 85 },
];

// Bulk discount factor: -20% off list prices for large orders.
export const DINNER_DISCOUNT = 0.20;

export function discountedPrice(base: number): number {
  return Math.round(base * (1 - DINNER_DISCOUNT) * 100) / 100;
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

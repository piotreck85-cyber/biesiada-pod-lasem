import { BIRTHDAY_PACKAGES, WORKSHOPS, ADULT_SETS, findAdultSet } from "./offers";

/** Returns true if the given ISO YYYY-MM-DD date falls on Fri/Sat/Sun. */
export function isWeekend(dateIso: string): boolean {
  try {
    const [y, m, d] = dateIso.split("-").map(x => parseInt(x, 10));
    // Use noon-UTC to avoid timezone flips
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const dow = dt.getUTCDay(); // Sun=0, Mon=1, ... Sat=6
    return dow === 5 || dow === 6 || dow === 0;
  } catch { return false; }
}

export type PricingResult = {
  match: "birthday" | "workshop" | null;
  offer_name: string;
  base_price: number;
  extras: number;
  extras_amount: number;
  total: number;
  breakdown: string;      // human-friendly PL string
  people_included: number; // capacity_limit for birthday, N for workshop
  per_person: number;      // surcharge (birthday) or price per child (workshop)
};

export function computePricing(category: string, dateIso: string, people: number, adultSetId?: string): PricingResult | null {
  if (!category || !people || people < 1) return null;

  // Adult events (dorosli/firmowe, dorosli/okolicznosciowe) → per-person Zestaw
  if (category.startsWith("dorosli") && adultSetId) {
    const set = findAdultSet(adultSetId);
    if (set) {
      const total = set.price_per_person * people;
      return {
        match: "birthday",
        offer_name: set.name,
        base_price: 0,
        extras: people,
        extras_amount: total,
        total,
        breakdown: `${set.name} · ${people} × ${set.price_per_person} zł/os.`,
        people_included: 0,
        per_person: set.price_per_person,
      };
    }
  }

  // Birthday packages
  const pkg = BIRTHDAY_PACKAGES.find(p => p.category === category);
  if (pkg) {
    const weekend = isWeekend(dateIso);
    const base = weekend ? pkg.price_weekend : pkg.price_weekday;
    if (base === null || base === undefined) return null;
    const surcharge = weekend ? pkg.surcharge_weekend : pkg.surcharge_weekday;
    const extras = Math.max(0, people - pkg.capacity_limit);
    const extras_amount = extras * surcharge;
    const total = base + extras_amount;
    const dayLabel = weekend ? "Pt–Nd" : "Pon–Czw";
    const breakdown = extras > 0
      ? `${pkg.name} (${dayLabel}) · baza ${base} zł + ${extras} × ${surcharge} zł`
      : `${pkg.name} (${dayLabel}) · pakiet do ${pkg.capacity_limit} osób`;
    return {
      match: "birthday",
      offer_name: pkg.name,
      base_price: base,
      extras,
      extras_amount,
      total,
      breakdown,
      people_included: pkg.capacity_limit,
      per_person: surcharge,
    };
  }

  // Workshops — mapped to category "dzieci/wycieczki"
  if (category === "dzieci/wycieczki") {
    // Without knowing which workshop, use average or lowest price. We use 90 zł as a default.
    const defaultPricePerChild = 90;
    const total = defaultPricePerChild * people;
    return {
      match: "workshop",
      offer_name: "Warsztaty",
      base_price: 0,
      extras: people,
      extras_amount: total,
      total,
      breakdown: `Warsztaty · ${people} × ${defaultPricePerChild} zł / dziecko`,
      people_included: 0,
      per_person: defaultPricePerChild,
    };
  }

  // Wycieczki z rodzicami — per-person, weekday-dependent
  if (category === "dzieci/wycieczki_rodzice") {
    const weekend = isWeekend(dateIso);
    const perPerson = weekend ? 50 : 40;
    const total = perPerson * people;
    const dayLabel = weekend ? "Pt–Nd" : "Pon–Czw";
    return {
      match: "birthday",
      offer_name: "Wycieczki z rodzicami",
      base_price: 0,
      extras: people,
      extras_amount: total,
      total,
      breakdown: `Wycieczka z rodzicami (${dayLabel}) · ${people} × ${perPerson} zł/os.`,
      people_included: 0,
      per_person: perPerson,
    };
  }

  return null;
}

/** Try to guess a per-child price when the event name matches a known workshop label. */
export function priceForWorkshopName(workshopName: string): number | null {
  const low = (workshopName || "").toLowerCase();
  const w = WORKSHOPS.find(x => low.includes(x.name.toLowerCase()));
  return w ? w.price_per_child : null;
}

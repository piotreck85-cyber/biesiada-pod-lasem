// Catering presets — ready-made dinner combinations for quick pricing.
// User can select a preset and it fills dinnerQty for the given number of people.

export type CateringPreset = {
  id: string;
  label: string;         // "Standardowy obiad 30 os."
  description: string;   // "Rosół · Kotlet schabowy · Ziemniaki · Surówki"
  people: number;        // default headcount
  items: Record<string, number>; // dinner_item_id -> qty (typically people count)
};

// Preset templates (per person portions). Multiplier applied by helper below.
export const CATERING_PRESET_TEMPLATES: Array<{
  id: string;
  label: string;
  description: string;
  items_per_person: Record<string, number>;      // dinnerMenu.ts IDs (z1, d3, dd1)
  offer_items_per_person: Record<string, number>; // offers.ts DINNER_EXTRAS IDs (d_zupa_rosol, etc.)
}> = [
  {
    id: "standard",
    label: "Standardowy obiad",
    description: "Rosół · Kotlet schabowy · Ziemniaki z wody · Zestaw surówek",
    items_per_person: {
      z1: 1, d3: 1, dd1: 1, dd6: 1,
    },
    offer_items_per_person: {
      d_zupa_rosol: 1, d_dg_schabowy: 1, d_add_ziem_woda: 1, d_add_surowki: 1,
    },
  },
  {
    id: "popular",
    label: "Popularny obiad",
    description: "Krem pomidorowy · Filet z kurczaka · Ziemniaki opiekane · Surówki",
    items_per_person: {
      z3: 1, d4: 1, dd2: 1, dd6: 1,
    },
    offer_items_per_person: {
      d_zupa_pomidor: 1, d_dg_kurczak: 1, d_add_ziem_op: 1, d_add_surowki: 1,
    },
  },
  {
    id: "elegant",
    label: "Elegancki obiad",
    description: "Krem z białych warzyw · Polędwiczka · Kluski śląskie · Kapusta",
    items_per_person: {
      z4: 1, d1: 1, dd3: 1, dd8: 1,
    },
    offer_items_per_person: {
      d_zupa_krem_bialy: 1, d_dg_poledwiczka: 1, d_add_slaskie: 1, d_add_kapusta: 1,
    },
  },
  {
    id: "regional",
    label: "Regionalny",
    description: "Zalewajka · Karczek pieczony · Kopytka · Wiosenna",
    items_per_person: {
      z2: 1, d7: 1, dd4: 1, dd7: 1,
    },
    offer_items_per_person: {
      d_zupa_zalewajka: 1, d_dg_karczek: 1, d_add_kopytka: 1, d_add_wiosenna: 1,
    },
  },
  {
    id: "no_soup",
    label: "Bez zupy (drugie danie)",
    description: "Roladka dr · Ziemniaki opiekane · Surówki",
    items_per_person: {
      d2: 1, dd2: 1, dd6: 1,
    },
    offer_items_per_person: {
      d_dg_roladka: 1, d_add_ziem_op: 1, d_add_surowki: 1,
    },
  },
];

// Common preset sizes offered as quick buttons
export const CATERING_PRESET_SIZES = [15, 20, 30, 40, 50, 60, 80, 100];

/**
 * Build a dinner qty map from a preset template × people count.
 */
export function buildPresetQty(
  presetId: string,
  people: number
): Record<string, number> {
  const tpl = CATERING_PRESET_TEMPLATES.find(t => t.id === presetId);
  if (!tpl) return {};
  const out: Record<string, number> = {};
  for (const [itemId, perPerson] of Object.entries(tpl.items_per_person)) {
    out[itemId] = (perPerson || 0) * (people || 0);
  }
  return out;
}

/**
 * Build a preset for oferta.tsx (DINNER_EXTRAS ID scheme, returns { qty: "N" } shape).
 */
export function buildPresetOfferExtras(
  presetId: string,
  people: number
): Record<string, { qty: string }> {
  const tpl = CATERING_PRESET_TEMPLATES.find(t => t.id === presetId);
  if (!tpl) return {};
  const out: Record<string, { qty: string }> = {};
  for (const [itemId, perPerson] of Object.entries(tpl.offer_items_per_person)) {
    out[itemId] = { qty: String((perPerson || 0) * (people || 0)) };
  }
  return out;
}

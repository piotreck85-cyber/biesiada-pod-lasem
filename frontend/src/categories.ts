// Hierarchical event categories.
// Structure kept flat for easy comparison but grouped in UI picker.
export type Category = {
  id: string;         // stored value
  label: string;      // display in list/badge
  path: string[];     // hierarchy path
};

export const CATEGORIES: Category[] = [
  { id: "dorosli/firmowe",              label: "Dorośli · Firmowe",              path: ["Dorośli", "Firmowe"] },
  { id: "dorosli/okolicznosciowe",      label: "Dorośli · Okolicznościowe",      path: ["Dorośli", "Okolicznościowe"] },
  { id: "dzieci/urodzinki/start",       label: "Urodzinki · Start",              path: ["Dzieci", "Urodzinki", "Start"] },
  { id: "dzieci/urodzinki/standard",    label: "Urodzinki · Standard",           path: ["Dzieci", "Urodzinki", "Standard"] },
  { id: "dzieci/urodzinki/tematyczne",  label: "Urodzinki · Tematyczne",         path: ["Dzieci", "Urodzinki", "Tematyczne"] },
  { id: "dzieci/urodzinki/konie",       label: "Urodzinki · Konie",              path: ["Dzieci", "Urodzinki", "Konie"] },
  { id: "dzieci/urodzinki/gady",        label: "Urodzinki · Gady",               path: ["Dzieci", "Urodzinki", "Gady"] },
  { id: "dzieci/wycieczki",             label: "Dzieci · Wycieczki szkolne",     path: ["Dzieci", "Wycieczki szkolne"] },
  { id: "dzieci/wycieczki_rodzice",     label: "Dzieci · Wycieczki z rodzicami", path: ["Dzieci", "Wycieczki z rodzicami"] },
  { id: "warsztaty/przyrodnicze",       label: "Warsztaty · Przyrodnicze",       path: ["Warsztaty", "Przyrodnicze"] },
  { id: "warsztaty/sezonowe",           label: "Warsztaty · Sezonowe (jesień)",  path: ["Warsztaty", "Sezonowe"] },
  { id: "warsztaty",                    label: "Warsztaty · Inne",               path: ["Warsztaty", "Inne"] },
];

export const CATEGORY_GROUPS = [
  {
    key: "Dorośli",
    color: "#D4AF37",
    items: [
      { id: "dorosli/firmowe",         label: "Firmowe" },
      { id: "dorosli/okolicznosciowe", label: "Okolicznościowe" },
    ],
  },
  {
    key: "Dzieci",
    color: "#F472B6",
    items: [
      { id: "dzieci/urodzinki/start",      label: "Urodzinki · Start" },
      { id: "dzieci/urodzinki/standard",   label: "Urodzinki · Standard" },
      { id: "dzieci/urodzinki/tematyczne", label: "Urodzinki · Tematyczne" },
      { id: "dzieci/urodzinki/konie",      label: "Urodzinki · Konie" },
      { id: "dzieci/urodzinki/gady",       label: "Urodzinki · Gady" },
      { id: "dzieci/wycieczki",            label: "Wycieczki szkolne" },
      { id: "dzieci/wycieczki_rodzice",    label: "Wycieczki z rodzicami" },
    ],
  },
  {
    key: "Warsztaty",
    color: "#34D399",
    items: [
      { id: "warsztaty/przyrodnicze", label: "Przyrodnicze" },
      { id: "warsztaty/sezonowe",     label: "Sezonowe (jesień)" },
      { id: "warsztaty",              label: "Inne" },
    ],
  },
];

export function categoryLabel(id?: string): string {
  if (!id) return "Bez kategorii";
  const c = CATEGORIES.find(x => x.id === id);
  return c ? c.label : id;
}

export function categoryTopGroup(id?: string): string | null {
  if (!id) return null;
  if (id.startsWith("dorosli")) return "Dorośli";
  if (id.startsWith("dzieci")) return "Dzieci";
  if (id.startsWith("warsztaty")) return "Warsztaty";
  return null;
}

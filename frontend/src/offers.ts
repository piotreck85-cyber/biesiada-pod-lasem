// Offers scraped from https://www.dolinaprzygod.pl (Biesiada pod lasem, Kielce)
// Static list — update here when the website changes.

export type BirthdayPackage = {
  id: string;
  name: string;
  category: string; // maps to app category
  duration: string;
  capacity: string;
  capacity_limit: number;      // people included in base price
  features: string[];
  price_weekday: number | null; // PLN, Pon–Czw
  price_weekend: number | null; // PLN, Pt–Nd
  surcharge_weekday: number;   // per extra person, Pon–Czw
  surcharge_weekend: number;   // per extra person, Pt–Nd
  above_limit_note: string;
  image: string;
};

export type Workshop = {
  id: string;
  name: string;
  season: string;
  features: string[];
  price_per_child: number;
  image: string;
};

// Common gallery images used as hero backgrounds for birthday packages.
const IMG_START     = "https://horizons-cdn.hostinger.com/63a189e2-8369-4e13-a546-f80872f0487b/71d3b050b9afad126bc75f88c3ca5c82.jpg";
const IMG_STANDARD  = "https://horizons-cdn.hostinger.com/63a189e2-8369-4e13-a546-f80872f0487b/b7658666ce5354d4f3ad2de6509c114c.jpg";
const IMG_GADY      = "https://horizons-cdn.hostinger.com/63a189e2-8369-4e13-a546-f80872f0487b/23b8893daf8f8eed5095bd350581c57f.jpg";
const IMG_KONIE     = "https://horizons-cdn.hostinger.com/63a189e2-8369-4e13-a546-f80872f0487b/62d1eed0f863cf7edbf3f297e943baeb.jpg";
const IMG_TEMAT     = "https://horizons-cdn.hostinger.com/63a189e2-8369-4e13-a546-f80872f0487b/3c33a57d328ca87f5e1f948112ce5047.jpg";

const ABOVE_LIMIT = "Powyżej limitu: +30 zł/os. (pon–czw) · +40 zł/os. (pt–nd)";

export const BIRTHDAY_PACKAGES: BirthdayPackage[] = [
  {
    id: "start",
    name: "START",
    category: "dzieci/urodzinki/start",
    duration: "2 h",
    capacity: "do 15 osób",
    capacity_limit: 15,
    surcharge_weekday: 30,
    surcharge_weekend: 40,
    features: [
      "Dmuchaniec",
      "Karmienie i spacer z alpakami",
      "Ognisko i grill",
      "Zastawa urodzinowa",
      "Kawa i herbata dla dorosłych",
      "Teren na wyłączność",
    ],
    price_weekday: 800,
    price_weekend: null, // nie podano na stronie
    above_limit_note: ABOVE_LIMIT,
    image: IMG_START,
  },
  {
    id: "standard",
    name: "STANDARD",
    category: "dzieci/urodzinki/standard",
    duration: "3 h",
    capacity: "do 20 osób",
    capacity_limit: 20,
    surcharge_weekday: 30,
    surcharge_weekend: 40,
    features: [
      "Dmuchaniec",
      "Karmienie i spacer z alpakami",
      "Ognisko i grill",
      "Bańki mydlane",
      "Prezent dla solenizanta",
      "Zastawa urodzinowa",
      "Kawa i herbata dla dorosłych",
      "Teren na wyłączność",
    ],
    price_weekday: 1150,
    price_weekend: 1450,
    above_limit_note: ABOVE_LIMIT,
    image: IMG_STANDARD,
  },
  {
    id: "gady",
    name: "GADY",
    category: "dzieci/urodzinki/gady",
    duration: "3 h",
    capacity: "do 20 osób",
    capacity_limit: 20,
    surcharge_weekday: 30,
    surcharge_weekend: 40,
    features: [
      "Wszystko ze STANDARD",
      "Spotkanie z wężem",
      "Gekon i jaszczurka",
      "Edukacja o gadach",
    ],
    price_weekday: 1450,
    price_weekend: 1850,
    above_limit_note: ABOVE_LIMIT,
    image: IMG_GADY,
  },
  {
    id: "konie",
    name: "KONIE",
    category: "dzieci/urodzinki/konie",
    duration: "4 h",
    capacity: "do 20 osób",
    capacity_limit: 20,
    surcharge_weekday: 30,
    surcharge_weekend: 40,
    features: [
      "Wszystko ze STANDARD",
      "Przejażdżka na koniu dla każdego dziecka",
    ],
    price_weekday: 1950,
    price_weekend: 2150,
    above_limit_note: ABOVE_LIMIT,
    image: IMG_KONIE,
  },
  {
    id: "tematyczny",
    name: "TEMATYCZNY",
    category: "dzieci/urodzinki/tematyczne",
    duration: "3 h",
    capacity: "do 20 osób",
    capacity_limit: 20,
    surcharge_weekday: 30,
    surcharge_weekend: 40,
    features: [
      "Wszystko ze STANDARD",
      "Animacje tematyczne",
      "Motywy: Dziki Zachód, Psi Patrol, K-pop, Harry Potter i inne",
    ],
    price_weekday: 1450,
    price_weekend: 1750,
    above_limit_note: ABOVE_LIMIT,
    image: IMG_TEMAT,
  },
];

export const WORKSHOPS: Workshop[] = [
  {
    id: 'jesien-pod-lasem',
    name: 'Jesień pod Lasem',
    season: 'Jesień',
    features: [
      'Praca w leśnej scenerii',
      'Malowanie na liściach',
      'Poszukiwanie ukrytych skarbów',
      'Tor przeszkód i gry integracyjne',
      'Alpaki i pielęgnacja',
      'Ognisko i wieczorne atrakcje',
      'Dmuchaniec',
    ],
    price_per_child: 90,
    image: IMG_TEMAT,
  },
  {
    id: 'jablkowe-szalenstwo',
    name: 'Jabłkowe Szaleństwo',
    season: 'Jesień',
    features: [
      'Przepisy na soki i cydr',
      'Modelowanie z drewna',
      'Zabawy z jabłkiem',
      'Poznawanie przyrody i sadu',
      'Alpaki i zabawy terenowe',
      'Ognisko i karmelizowane jabłka',
      'Dmuchaniec',
    ],
    price_per_child: 90,
    image: IMG_STANDARD,
  },
  {
    id: 'ziemniaczana-przygoda',
    name: 'Wielka Ziemniaczana Przygoda',
    season: 'Jesień',
    features: [
      'Tematyka ziemniaka i warzywnika',
      'Wyzwania terenowe',
      'Gry i zabawy zespołowe',
      'Poznawanie pracy rolnika',
      'Alpaki i spacery',
      'Ognisko i ziemniaczane wypieki',
      'Dmuchaniec',
    ],
    price_per_child: 90,
    image: IMG_GADY,
  },
  {
    id: 'przygoda-przedszkolaka',
    name: 'Wielka Przygoda Przedszkolaka',
    season: 'Jesień',
    features: [
      'Bezpieczne aktywności dla najmłodszych',
      'Zajęcia plastyczne',
      'Łatwe zadania ruchowe',
      'Spotkanie z alpakami',
      'Mini-ognisko',
      'Dmuchaniec',
      'Pamiątka i dyplom',
    ],
    price_per_child: 90,
    image: IMG_KONIE,
  },
  {
    id: 'dyniowa-przygoda',
    name: 'Dyniowa Przygoda w Lesie',
    season: 'Jesień',
    features: [
      'Malowanie dyni',
      'Slalom i zadania logiczne',
      'Poszukiwanie ukrytej dyni',
      'Ścieżki przyrodnicze',
      'Alpaki i sesje foto',
      'Ognisko i dyniowe ciasto',
      'Dmuchaniec',
    ],
    price_per_child: 90,
    image: IMG_START,
  },
  {
    id: 'halloween-w-lesie',
    name: 'Halloween w Lesie',
    season: 'Jesień',
    features: [
      'Kreatywne malowanie dyni',
      'Zabawy tematyczne: duchy i zagadki',
      'Tory przeszkód',
      'Imprezowe zadania integracyjne',
      'Alpaki i sesje zdjęciowe',
      'Ognisko i słodki upominek',
      'Dmuchaniec',
    ],
    price_per_child: 90,
    image: IMG_TEMAT,
  },
];
export type AdultSet = {
  id: string;
  name: string;
  price_per_person: number;
  items: string[];
  addons: string[];
};

export const ADULT_SETS: AdultSet[] = [
  {
    id: "set1",
    name: "Zestaw nr 1",
    price_per_person: 150,
    items: [
      "Kiełbaska z rusztu",
      "Karkówka w ziołach",
      "Kaszanka z cebulką",
      "Pieczone ziemniaczki ziołowo-maślane",
    ],
    addons: [
      "Pieczywo",
      "Sosy: musztarda, ketchup, chrzan, sos czosnkowy",
      "Ogóreczki kiszone",
      "Smalczyk wiejski",
      "Kawa, herbata",
    ],
  },
  {
    id: "set2",
    name: "Zestaw nr 2",
    price_per_person: 180,
    items: [
      "Kiełbaska z rusztu (tradycyjna oraz biała)",
      "Karkówka w ziołach",
      "Kaszanka z cebulką",
      "Pieczone ziemniaczki ziołowo-maślane",
      "Pieczarka w boczku",
      "Żurek z kiełbaską i jajkiem",
    ],
    addons: [
      "Pieczywo",
      "Sosy: musztarda, ketchup, chrzan, sos czosnkowy",
      "Ogóreczki kiszone",
      "Smalczyk Góralski",
      "Kawa, herbata",
    ],
  },
  {
    id: "set3",
    name: "Zestaw nr 3",
    price_per_person: 200,
    items: [
      "Kiełbaska z rusztu (tradycyjna oraz biała)",
      "Karkówka w ziołach",
      "Kaszanka z cebulką",
      "Pieczone ziemniaczki ziołowo-maślane",
      "Pieczarka w boczku",
      "Warzywa grillowane",
      "Sałatka Grecka",
      "Żurek z kiełbaską i jajkiem",
    ],
    addons: [
      "Pieczywo",
      "Sosy: musztarda, ketchup, chrzan, sos czosnkowy",
      "Ogóreczki kiszone",
      "Smalczyk Góralski",
      "Kawa, herbata",
    ],
  },
];

export type AdultExtra = {
  id: string;
  name: string;
  unit: string;         // "osoba" | "porcja" | "sztuka"
  price: number;
  hint?: string;
};

export const ADULT_EXTRAS: AdultExtra[] = [
  { id: "napoje", name: "Napoje (cola, soki)", unit: "osoba", price: 20 },
  { id: "taca_mies", name: "Półmisek mięs (5–6 os.)", unit: "sztuka", price: 240 },
  { id: "taca_mix", name: "Taca przystawek mix (5–6 os.)", unit: "sztuka", price: 220 },
  { id: "salatka", name: "Sałatka", unit: "porcja", price: 13, hint: "Farfalle · Gyros · Grecka · Cezar itp." },
  { id: "ciasto", name: "Ciasto (własne)", unit: "kwota", price: 0, hint: "Wpisz kwotę ręcznie" },
];

// Extras for birthday events (dzieci/urodzinki/*)
export const BIRTHDAY_EXTRAS: AdultExtra[] = [
  { id: "catering", name: "Catering (poczęstunek)", unit: "osoba", price: 15, hint: "15 zł od osoby" },
];

// Extras for parent-accompanied field trips (dzieci/wycieczki_rodzice)
export const PARENT_TRIP_EXTRAS: AdultExtra[] = [
  { id: "catering", name: "Catering (poczęstunek)", unit: "osoba", price: 15, hint: "15 zł od osoby" },
  { id: "konie", name: "Atrakcja: Konie", unit: "sztuka", price: 700, hint: "700 zł ryczałt (1 sztuka = wszyscy)" },
  { id: "animacje", name: "Animacje", unit: "sztuka", price: 500, hint: "500 zł ryczałt" },
];

/**
 * Returns the extras catalog appropriate for a given event category.
 * Used by the event form to render the right add-on picker.
 */
export function extrasFor(category: string): AdultExtra[] {
  const c = (category || "").toLowerCase();
  if (c.startsWith("dorosli")) return ADULT_EXTRAS;
  if (c === "dzieci/wycieczki_rodzice") return PARENT_TRIP_EXTRAS;
  if (c.startsWith("dzieci/urodzinki")) return BIRTHDAY_EXTRAS;
  return [];
}

// ---- Menu obiadowe (dinner offer 2026) ----
// Positions from the hand-crafted "Oferta obiadowa 2026" DOCX. Prices per portion.
export type DinnerItem = {
  id: string;
  name: string;
  unit: "porcja";
  price: number;
  section: "Zupa" | "Danie główne" | "Dodatek";
};

export const DINNER_EXTRAS: DinnerItem[] = [
  // Zupa
  { id: "d_zupa_rosol",      name: "Rosół / makaron",                                   unit: "porcja", price: 20, section: "Zupa" },
  { id: "d_zupa_zalewajka",  name: "Zalewajka Świętokrzyska",                           unit: "porcja", price: 22, section: "Zupa" },
  { id: "d_zupa_pomidor",    name: "Krem pomidorowo-paprykowy / mozzarella",            unit: "porcja", price: 22, section: "Zupa" },
  { id: "d_zupa_krem_bialy", name: "Krem z białych warzyw",                             unit: "porcja", price: 22, section: "Zupa" },
  // Danie główne
  { id: "d_dg_poledwiczka",  name: "Polędwiczka WP / sos serowy z orzechami lub leśny", unit: "porcja", price: 29, section: "Danie główne" },
  { id: "d_dg_roladka",      name: "Roladka DR / sos serowy",                           unit: "porcja", price: 27, section: "Danie główne" },
  { id: "d_dg_schabowy",     name: "Kotlet schabowy",                                   unit: "porcja", price: 22, section: "Danie główne" },
  { id: "d_dg_kurczak",      name: "Filet z kurczaka",                                  unit: "porcja", price: 22, section: "Danie główne" },
  { id: "d_dg_filet_zap",    name: "Filet zapiekany (pomidory, szpinak, mozz.)",        unit: "porcja", price: 27, section: "Danie główne" },
  { id: "d_dg_cordon",       name: "Cordon Bleu",                                       unit: "porcja", price: 27, section: "Danie główne" },
  { id: "d_dg_karczek",      name: "Karczek pieczony / sos myśliwski",                  unit: "porcja", price: 27, section: "Danie główne" },
  { id: "d_dg_szydlowiecki", name: "Kotlet szydłowiecki (faszerowany)",                 unit: "porcja", price: 26, section: "Danie główne" },
  // Dodatek
  { id: "d_add_ziem_woda",   name: "Ziemniaki z wody",                                  unit: "porcja", price:  8, section: "Dodatek" },
  { id: "d_add_ziem_op",     name: "Ziemniaki opiekane",                                unit: "porcja", price:  9, section: "Dodatek" },
  { id: "d_add_slaskie",     name: "Kluski śląskie",                                    unit: "porcja", price: 12, section: "Dodatek" },
  { id: "d_add_kopytka",     name: "Kopytka",                                           unit: "porcja", price: 10, section: "Dodatek" },
  { id: "d_add_ryz",         name: "Ryż z warzywami",                                   unit: "porcja", price: 12, section: "Dodatek" },
  { id: "d_add_surowki",     name: "Zestaw surówek",                                    unit: "porcja", price:  9, section: "Dodatek" },
  { id: "d_add_wiosenna",    name: "Wiosenna",                                          unit: "porcja", price:  9, section: "Dodatek" },
  { id: "d_add_kapusta",     name: "Kapusta zasmażana",                                 unit: "porcja", price: 10, section: "Dodatek" },
];


function _findAdultSetImpl(id?: string): AdultSet | undefined {
  if (!id) return undefined;
  return ADULT_SETS.find(x => x.id === id);
}
export { _findAdultSetImpl as findAdultSet };


export const WORKSHOP_INFO = "3-4 godziny · Opiekunowie bezpłatnie · Ognisko, alpaki, dmuchaniec i ogrzewana altana";
export const SOURCE_URL = "https://www.dolinaprzygod.pl";

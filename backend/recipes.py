"""
Static Recipes / Ingredient Breakdown Database for "Biesiada pod lasem" Shopping List.

Each package/dish is broken down into atomic raw ingredients with per-person quantities.
Users can override these via `menu_settings.recipe_overrides` in MongoDB.

Categories used (must match frontend CATS):
- warzywa   (vegetables)
- mieso     (meat)
- nabial    (dairy)
- spozywcze (dry goods / spices / sauces)
- pieczywo  (bread)
- napoje    (drinks)
- kawa      (coffee/tea)
- jednorazowki (disposables)
- dekoracje
- srodki    (cleaning supplies)
- dodatkowe
- inne

Units:
- kg  (kilogram)
- g   (gram)
- l   (liter)
- ml  (milliliter)
- szt (piece)
- opak (package / opakowanie)
- sloik (jar / słoik)
- peczek (bunch / pęczek)
- porcja
"""

from typing import Any, Dict, List


# key -> list of ingredients per 1 person
# Each ingredient: {name, category, unit, qty, price} where qty is PER PERSON
RECIPES: Dict[str, List[Dict[str, Any]]] = {
    # ============= ZUPY =============
    "z1": [  # Rosół / makaron
        {"name": "Kurczak do rosołu", "category": "mieso", "unit": "kg", "qty": 0.12, "price": 20.0},
        {"name": "Makaron nitki", "category": "spozywcze", "unit": "kg", "qty": 0.03, "price": 8.0},
        {"name": "Marchew", "category": "warzywa", "unit": "kg", "qty": 0.05, "price": 3.0},
        {"name": "Pietruszka korzeń", "category": "warzywa", "unit": "kg", "qty": 0.03, "price": 5.0},
        {"name": "Seler", "category": "warzywa", "unit": "szt", "qty": 0.02, "price": 4.0},
        {"name": "Cebula", "category": "warzywa", "unit": "kg", "qty": 0.02, "price": 3.0},
        {"name": "Natka pietruszki", "category": "warzywa", "unit": "peczek", "qty": 0.05, "price": 2.5},
    ],
    "z2": [  # Zalewajka
        {"name": "Ziemniaki", "category": "warzywa", "unit": "kg", "qty": 0.15, "price": 3.5},
        {"name": "Zakwas na żur", "category": "spozywcze", "unit": "l", "qty": 0.15, "price": 8.0},
        {"name": "Kiełbasa biała", "category": "mieso", "unit": "kg", "qty": 0.08, "price": 32.0},
        {"name": "Boczek wędzony", "category": "mieso", "unit": "kg", "qty": 0.03, "price": 40.0},
        {"name": "Śmietana 18%", "category": "nabial", "unit": "l", "qty": 0.03, "price": 10.0},
        {"name": "Czosnek", "category": "warzywa", "unit": "kg", "qty": 0.005, "price": 25.0},
    ],
    "z3": [  # Krem pomidorowo
        {"name": "Pomidory pelati (pulpa)", "category": "spozywcze", "unit": "opak", "qty": 0.1, "price": 6.0},
        {"name": "Śmietanka 30%", "category": "nabial", "unit": "l", "qty": 0.03, "price": 20.0},
        {"name": "Bazylia świeża", "category": "warzywa", "unit": "peczek", "qty": 0.02, "price": 4.0},
        {"name": "Cebula", "category": "warzywa", "unit": "kg", "qty": 0.03, "price": 3.0},
        {"name": "Grzanki (chleb tostowy)", "category": "pieczywo", "unit": "szt", "qty": 0.5, "price": 0.5},
    ],
    "z4": [  # Krem z białych warzyw
        {"name": "Kalafior", "category": "warzywa", "unit": "szt", "qty": 0.1, "price": 8.0},
        {"name": "Pieczarki", "category": "warzywa", "unit": "kg", "qty": 0.05, "price": 15.0},
        {"name": "Śmietanka 30%", "category": "nabial", "unit": "l", "qty": 0.03, "price": 20.0},
        {"name": "Cebula", "category": "warzywa", "unit": "kg", "qty": 0.03, "price": 3.0},
    ],

    # ============= DANIA GŁÓWNE =============
    "d1": [  # Polędwiczka
        {"name": "Polędwiczka wieprzowa", "category": "mieso", "unit": "kg", "qty": 0.2, "price": 45.0},
        {"name": "Pieczarki (do sosu)", "category": "warzywa", "unit": "kg", "qty": 0.05, "price": 15.0},
        {"name": "Śmietana 18% (sos)", "category": "nabial", "unit": "l", "qty": 0.03, "price": 10.0},
        {"name": "Przyprawy do mięsa", "category": "spozywcze", "unit": "opak", "qty": 0.01, "price": 8.0},
    ],
    "d2": [  # Roladka drobiowa
        {"name": "Filet z kurczaka", "category": "mieso", "unit": "kg", "qty": 0.2, "price": 32.0},
        {"name": "Szynka/boczek do roladki", "category": "mieso", "unit": "kg", "qty": 0.05, "price": 40.0},
        {"name": "Ser żółty", "category": "nabial", "unit": "kg", "qty": 0.03, "price": 40.0},
        {"name": "Przyprawy do mięsa", "category": "spozywcze", "unit": "opak", "qty": 0.01, "price": 8.0},
    ],
    "d3": [  # Kotlet schabowy
        {"name": "Schab wieprzowy", "category": "mieso", "unit": "kg", "qty": 0.2, "price": 28.0},
        {"name": "Jajka", "category": "nabial", "unit": "szt", "qty": 0.3, "price": 1.2},
        {"name": "Bułka tarta", "category": "spozywcze", "unit": "kg", "qty": 0.03, "price": 10.0},
        {"name": "Mąka pszenna", "category": "spozywcze", "unit": "kg", "qty": 0.02, "price": 4.0},
        {"name": "Olej do smażenia", "category": "spozywcze", "unit": "l", "qty": 0.03, "price": 10.0},
    ],
    "d4": [  # Filet z kurczaka
        {"name": "Filet z kurczaka", "category": "mieso", "unit": "kg", "qty": 0.2, "price": 32.0},
        {"name": "Jajka", "category": "nabial", "unit": "szt", "qty": 0.3, "price": 1.2},
        {"name": "Bułka tarta", "category": "spozywcze", "unit": "kg", "qty": 0.03, "price": 10.0},
        {"name": "Olej do smażenia", "category": "spozywcze", "unit": "l", "qty": 0.03, "price": 10.0},
    ],
    "d5": [  # Filet zapiekany
        {"name": "Filet z kurczaka", "category": "mieso", "unit": "kg", "qty": 0.2, "price": 32.0},
        {"name": "Pieczarki", "category": "warzywa", "unit": "kg", "qty": 0.05, "price": 15.0},
        {"name": "Ser żółty", "category": "nabial", "unit": "kg", "qty": 0.05, "price": 40.0},
        {"name": "Śmietana 18%", "category": "nabial", "unit": "l", "qty": 0.03, "price": 10.0},
    ],
    "d6": [  # Cordon Bleu
        {"name": "Filet z kurczaka", "category": "mieso", "unit": "kg", "qty": 0.2, "price": 32.0},
        {"name": "Ser żółty", "category": "nabial", "unit": "kg", "qty": 0.04, "price": 40.0},
        {"name": "Szynka do cordon bleu", "category": "mieso", "unit": "kg", "qty": 0.04, "price": 45.0},
        {"name": "Bułka tarta", "category": "spozywcze", "unit": "kg", "qty": 0.03, "price": 10.0},
        {"name": "Jajka", "category": "nabial", "unit": "szt", "qty": 0.3, "price": 1.2},
    ],
    "d7": [  # Karczek pieczony
        {"name": "Karczek wieprzowy", "category": "mieso", "unit": "kg", "qty": 0.22, "price": 30.0},
        {"name": "Cebula (do pieczenia)", "category": "warzywa", "unit": "kg", "qty": 0.03, "price": 3.0},
        {"name": "Czosnek", "category": "warzywa", "unit": "kg", "qty": 0.005, "price": 25.0},
        {"name": "Przyprawy do mięsa", "category": "spozywcze", "unit": "opak", "qty": 0.01, "price": 8.0},
    ],
    "d8": [  # Kotlet szydłowiecki
        {"name": "Karczek/schab", "category": "mieso", "unit": "kg", "qty": 0.22, "price": 28.0},
        {"name": "Ser żółty", "category": "nabial", "unit": "kg", "qty": 0.04, "price": 40.0},
        {"name": "Pieczarki", "category": "warzywa", "unit": "kg", "qty": 0.05, "price": 15.0},
    ],

    # ============= DODATKI =============
    "dd1": [  # Ziemniaki z wody
        {"name": "Ziemniaki", "category": "warzywa", "unit": "kg", "qty": 0.25, "price": 3.5},
        {"name": "Koperek świeży", "category": "warzywa", "unit": "peczek", "qty": 0.05, "price": 3.0},
        {"name": "Masło", "category": "nabial", "unit": "kg", "qty": 0.01, "price": 40.0},
    ],
    "dd2": [  # Ziemniaki opiekane
        {"name": "Ziemniaki", "category": "warzywa", "unit": "kg", "qty": 0.25, "price": 3.5},
        {"name": "Olej", "category": "spozywcze", "unit": "l", "qty": 0.02, "price": 10.0},
        {"name": "Papryka słodka (przyprawa)", "category": "spozywcze", "unit": "opak", "qty": 0.02, "price": 5.0},
    ],
    "dd3": [  # Kluski śląskie
        {"name": "Ziemniaki", "category": "warzywa", "unit": "kg", "qty": 0.25, "price": 3.5},
        {"name": "Mąka ziemniaczana", "category": "spozywcze", "unit": "kg", "qty": 0.03, "price": 6.0},
        {"name": "Jajka", "category": "nabial", "unit": "szt", "qty": 0.2, "price": 1.2},
    ],
    "dd4": [  # Kopytka
        {"name": "Ziemniaki", "category": "warzywa", "unit": "kg", "qty": 0.25, "price": 3.5},
        {"name": "Mąka pszenna", "category": "spozywcze", "unit": "kg", "qty": 0.05, "price": 4.0},
        {"name": "Jajka", "category": "nabial", "unit": "szt", "qty": 0.2, "price": 1.2},
    ],
    "dd5": [  # Ryż z warzywami
        {"name": "Ryż", "category": "spozywcze", "unit": "kg", "qty": 0.08, "price": 8.0},
        {"name": "Mieszanka warzyw (mrożonka)", "category": "warzywa", "unit": "kg", "qty": 0.1, "price": 10.0},
    ],
    "dd6": [  # Zestaw surówek
        {"name": "Kapusta biała", "category": "warzywa", "unit": "kg", "qty": 0.08, "price": 3.0},
        {"name": "Kapusta czerwona", "category": "warzywa", "unit": "kg", "qty": 0.05, "price": 4.0},
        {"name": "Marchew", "category": "warzywa", "unit": "kg", "qty": 0.05, "price": 3.0},
        {"name": "Ogórek kiszony", "category": "warzywa", "unit": "kg", "qty": 0.05, "price": 8.0},
        {"name": "Cebula", "category": "warzywa", "unit": "kg", "qty": 0.02, "price": 3.0},
        {"name": "Majonez", "category": "spozywcze", "unit": "opak", "qty": 0.02, "price": 8.0},
        {"name": "Śmietana 18%", "category": "nabial", "unit": "l", "qty": 0.02, "price": 10.0},
    ],
    "dd7": [  # Wiosenna (surówka)
        {"name": "Mix sałat", "category": "warzywa", "unit": "opak", "qty": 0.1, "price": 8.0},
        {"name": "Pomidor świeży", "category": "warzywa", "unit": "kg", "qty": 0.05, "price": 10.0},
        {"name": "Ogórek świeży", "category": "warzywa", "unit": "kg", "qty": 0.05, "price": 8.0},
        {"name": "Rzodkiewka", "category": "warzywa", "unit": "peczek", "qty": 0.05, "price": 3.5},
    ],
    "dd8": [  # Kapusta zasmażana
        {"name": "Kapusta biała", "category": "warzywa", "unit": "kg", "qty": 0.15, "price": 3.0},
        {"name": "Boczek wędzony", "category": "mieso", "unit": "kg", "qty": 0.02, "price": 40.0},
        {"name": "Cebula", "category": "warzywa", "unit": "kg", "qty": 0.02, "price": 3.0},
        {"name": "Mąka pszenna", "category": "spozywcze", "unit": "kg", "qty": 0.01, "price": 4.0},
    ],

    # ============= PAKIETY GRILLOWE =============
    "set1": [  # Grill podstawowy
        {"name": "Kiełbasa grillowa", "category": "mieso", "unit": "kg", "qty": 0.15, "price": 25.0},
        {"name": "Karkówka", "category": "mieso", "unit": "kg", "qty": 0.15, "price": 30.0},
        {"name": "Chleb do grilla", "category": "pieczywo", "unit": "szt", "qty": 0.15, "price": 6.0},
        {"name": "Ketchup", "category": "spozywcze", "unit": "opak", "qty": 0.05, "price": 8.0},
        {"name": "Musztarda", "category": "spozywcze", "unit": "opak", "qty": 0.03, "price": 6.0},
        {"name": "Ogórek konserwowy", "category": "warzywa", "unit": "sloik", "qty": 0.05, "price": 8.0},
        {"name": "Cebula", "category": "warzywa", "unit": "kg", "qty": 0.03, "price": 3.0},
    ],
    "set2": [  # Grill rozszerzony
        {"name": "Kiełbasa grillowa", "category": "mieso", "unit": "kg", "qty": 0.15, "price": 25.0},
        {"name": "Karkówka", "category": "mieso", "unit": "kg", "qty": 0.18, "price": 30.0},
        {"name": "Kaszanka", "category": "mieso", "unit": "kg", "qty": 0.1, "price": 20.0},
        {"name": "Skrzydełka kurczaka", "category": "mieso", "unit": "kg", "qty": 0.1, "price": 18.0},
        {"name": "Chleb do grilla", "category": "pieczywo", "unit": "szt", "qty": 0.2, "price": 6.0},
        {"name": "Ketchup", "category": "spozywcze", "unit": "opak", "qty": 0.05, "price": 8.0},
        {"name": "Musztarda", "category": "spozywcze", "unit": "opak", "qty": 0.03, "price": 6.0},
        {"name": "Sos czosnkowy", "category": "spozywcze", "unit": "opak", "qty": 0.04, "price": 10.0},
        {"name": "Ogórek konserwowy", "category": "warzywa", "unit": "sloik", "qty": 0.05, "price": 8.0},
        {"name": "Cebula", "category": "warzywa", "unit": "kg", "qty": 0.03, "price": 3.0},
    ],
    "set3": [  # Grill premium (+ sałatka grecka)
        {"name": "Kiełbasa grillowa premium", "category": "mieso", "unit": "kg", "qty": 0.18, "price": 32.0},
        {"name": "Karkówka", "category": "mieso", "unit": "kg", "qty": 0.2, "price": 30.0},
        {"name": "Kaszanka", "category": "mieso", "unit": "kg", "qty": 0.1, "price": 20.0},
        {"name": "Szaszłyki", "category": "mieso", "unit": "szt", "qty": 1.0, "price": 8.0},
        {"name": "Żeberka", "category": "mieso", "unit": "kg", "qty": 0.15, "price": 28.0},
        {"name": "Chleb do grilla", "category": "pieczywo", "unit": "szt", "qty": 0.2, "price": 6.0},
        {"name": "Ketchup", "category": "spozywcze", "unit": "opak", "qty": 0.06, "price": 8.0},
        {"name": "Musztarda", "category": "spozywcze", "unit": "opak", "qty": 0.04, "price": 6.0},
        {"name": "Sos czosnkowy", "category": "spozywcze", "unit": "opak", "qty": 0.05, "price": 10.0},
        # sałatka grecka (składniki na osobę)
        {"name": "Ser feta", "category": "nabial", "unit": "opak", "qty": 0.1, "price": 12.0},
        {"name": "Mix sałat", "category": "warzywa", "unit": "opak", "qty": 0.05, "price": 8.0},
        {"name": "Pomidor świeży", "category": "warzywa", "unit": "kg", "qty": 0.05, "price": 10.0},
        {"name": "Ogórek świeży", "category": "warzywa", "unit": "kg", "qty": 0.04, "price": 8.0},
        {"name": "Oliwki czarne", "category": "spozywcze", "unit": "sloik", "qty": 0.03, "price": 10.0},
        {"name": "Oliwa z oliwek", "category": "spozywcze", "unit": "l", "qty": 0.005, "price": 40.0},
        {"name": "Cebula czerwona", "category": "warzywa", "unit": "kg", "qty": 0.03, "price": 5.0},
        {"name": "Ogórek konserwowy", "category": "warzywa", "unit": "sloik", "qty": 0.05, "price": 8.0},
    ],

    # ============= NAPOJE (mix, on-demand) =============
    "napoje": [
        {"name": "Woda mineralna gazowana", "category": "napoje", "unit": "l", "qty": 0.5, "price": 3.0},
        {"name": "Woda mineralna niegazowana", "category": "napoje", "unit": "l", "qty": 0.5, "price": 3.0},
        {"name": "Cola", "category": "napoje", "unit": "l", "qty": 0.4, "price": 6.0},
        {"name": "Sprite/7up", "category": "napoje", "unit": "l", "qty": 0.2, "price": 5.5},
        {"name": "Fanta/Mirinda", "category": "napoje", "unit": "l", "qty": 0.2, "price": 5.5},
        {"name": "Sok pomarańczowy", "category": "napoje", "unit": "l", "qty": 0.2, "price": 6.0},
        {"name": "Sok jabłkowy", "category": "napoje", "unit": "l", "qty": 0.15, "price": 6.0},
    ],

    # ============= INNE POPULARNE ELEMENTY =============
    "kawa_herbata": [  # koszt "kawa/herbata dla wszystkich" per osoba
        {"name": "Kawa mielona", "category": "kawa", "unit": "kg", "qty": 0.01, "price": 60.0},
        {"name": "Herbata (torebki)", "category": "kawa", "unit": "opak", "qty": 0.03, "price": 10.0},
        {"name": "Cukier", "category": "spozywcze", "unit": "kg", "qty": 0.02, "price": 5.0},
        {"name": "Cytryna", "category": "warzywa", "unit": "szt", "qty": 0.1, "price": 2.0},
        {"name": "Mleko UHT", "category": "nabial", "unit": "l", "qty": 0.05, "price": 5.0},
    ],

    # ============= FIRMOWY ZIEMNIAK =============
    # (używane jako custom item „firmowy_ziemniak")
    "firmowy_ziemniak": [
        {"name": "Ziemniaki (duże, na pieczenie)", "category": "warzywa", "unit": "kg", "qty": 0.4, "price": 4.0},
        {"name": "Śmietana 18%", "category": "nabial", "unit": "l", "qty": 0.05, "price": 10.0},
        {"name": "Ser żółty", "category": "nabial", "unit": "kg", "qty": 0.05, "price": 40.0},
        {"name": "Boczek wędzony", "category": "mieso", "unit": "kg", "qty": 0.04, "price": 40.0},
        {"name": "Szczypior", "category": "warzywa", "unit": "peczek", "qty": 0.1, "price": 3.0},
        {"name": "Cebula", "category": "warzywa", "unit": "kg", "qty": 0.02, "price": 3.0},
        {"name": "Masło", "category": "nabial", "unit": "kg", "qty": 0.01, "price": 40.0},
    ],
}


# Fixed items to add per event (regardless of people count)
# Users may edit through settings.
FIXED_PER_EVENT: List[Dict[str, Any]] = [
    {"name": "Serwetki bankietowe", "category": "jednorazowki", "unit": "opak", "qty": 2, "price": 8.0},
    {"name": "Ręczniki papierowe", "category": "jednorazowki", "unit": "opak", "qty": 2, "price": 10.0},
    {"name": "Worki na śmieci 60L", "category": "srodki", "unit": "opak", "qty": 1, "price": 12.0},
    {"name": "Płyn do naczyń", "category": "srodki", "unit": "szt", "qty": 1, "price": 8.0},
]


def merge_recipes(overrides: Dict[str, List[Dict[str, Any]]] | None) -> Dict[str, List[Dict[str, Any]]]:
    """Merge default RECIPES with user overrides.
    Overrides format: {key: [ingredient, ...]}  # replaces the whole ingredient list for that key
    """
    merged = {k: [dict(x) for x in v] for k, v in RECIPES.items()}
    if overrides:
        for k, v in overrides.items():
            if isinstance(v, list):
                merged[k] = [dict(x) for x in v]
    return merged


# Human-readable labels for recipe keys
RECIPE_LABELS = {
    "z1": "Zupa: Rosół z makaronem",
    "z2": "Zupa: Zalewajka",
    "z3": "Zupa: Krem pomidorowy",
    "z4": "Zupa: Krem z białych warzyw",
    "d1": "Danie: Polędwiczka",
    "d2": "Danie: Roladka drobiowa",
    "d3": "Danie: Kotlet schabowy",
    "d4": "Danie: Filet z kurczaka",
    "d5": "Danie: Filet zapiekany",
    "d6": "Danie: Cordon Bleu",
    "d7": "Danie: Karczek pieczony",
    "d8": "Danie: Kotlet szydłowiecki",
    "dd1": "Dodatek: Ziemniaki z wody",
    "dd2": "Dodatek: Ziemniaki opiekane",
    "dd3": "Dodatek: Kluski śląskie",
    "dd4": "Dodatek: Kopytka",
    "dd5": "Dodatek: Ryż z warzywami",
    "dd6": "Dodatek: Zestaw surówek",
    "dd7": "Dodatek: Surówka wiosenna",
    "dd8": "Dodatek: Kapusta zasmażana",
    "set1": "Grill: Pakiet SET 1 (podstawowy)",
    "set2": "Grill: Pakiet SET 2 (rozszerzony)",
    "set3": "Grill: Pakiet SET 3 (premium + sałatka grecka)",
    "napoje": "Napoje (mix)",
    "kawa_herbata": "Kawa / Herbata (bufet)",
    "firmowy_ziemniak": "Firmowy ziemniak (dodatek)",
}

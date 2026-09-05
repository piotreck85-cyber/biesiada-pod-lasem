# Eventa — PRD

Polish mobile app for event organizers to manage:
- Calendar of events (monthly grid + list view)
- Staff/employees (name, role, hourly rate)
- Assigning staff shifts (hours worked) per event
- Costs (materials + auto-calculated labor)
- Revenue and auto-calculated profit per event
- Monthly stats dashboard (revenue, costs, profit, per-event breakdown)
- CSV export of monthly events

## Stack
- Backend: FastAPI + MongoDB + JWT (bcrypt) + Motor
- Frontend: Expo Router (React Native), dark charcoal + antique gold theme
- Auth: email/password with JWT stored in SecureStore (mobile) / AsyncStorage (web)

## API endpoints
- POST /api/auth/register, /api/auth/login, GET /api/auth/me
- GET/POST /api/staff, PUT/DELETE /api/staff/{id}
- GET/POST /api/events, GET/PUT/DELETE /api/events/{id}  (supports ?year=&month=)
- GET /api/stats?year=&month=
- GET /api/export/events?year=&month=  (CSV, requires token)

## Screens
- (auth)/login, (auth)/register
- (tabs)/kalendarz — monthly grid with category labels + day event list
- (tabs)/imprezy — hero-image cards with revenue/cost/profit
- (tabs)/pracownicy — staff list with add/edit modal, includes logout
- (tabs)/statystyki — hero profit card, revenue/cost split, breakdown, per-event list, CSV export
- event/[id] — full form (info, finances with cost items, staff shifts with hours, live summary)

## Latest iteration (Aug 2026)
### Event Checklists (Zadania) — Stage 2 of Employee module
- Admin can define **task templates** (Więcej → Szablony zadań), optionally scoped per event type
  (firmowe / okolicznościowe / urodzinki / warsztaty) or applied globally
- Each event has its own **checklist** auto-materialized from matching templates on first view
- **Staff** see only checklists of events they're **assigned to via shifts** (14 days ahead) with progress bars
- Staff can only **toggle done** (records `done_by_name` + `done_at`)
- Admin can additionally add ad-hoc tasks, edit titles (long-press), delete, and pull in NEW templates
- Shared UI: reusable component `src/components/EventChecklist.tsx`, screen at `/checklist/[id]`
- Admin also sees "Zadania imprezy" link inside each event detail page

### Weekly Payroll ("Rozlicz tygodniówkę")
- Modal in Pracownicy → Wypłaty tab
- Date range selectors + quick chips (This week / Prev week)
- Shows per-staff hours × rate = amount for unpaid time entries only
- "Oznacz wypłacone" marks time_entries as paid AND auto-creates a company expense

### AI Asystent (GPT 5.6 Terra) — Aug 2026
- Nowy ekran `/ai-asystent` z 3 zakładkami:
  - **Wskazówki dnia** — AI analizuje nadchodzące imprezy (7/14/30 dni) i zwraca 3-5 akcyjnych sugestii z ikonami severity (error/warning/info)
  - **Generator ofert** — brief klienta → gotowy tekst w 3 tonach (profesjonalny/ciepły/krótki); przycisk "Kopiuj" do schowka
  - **Czat** — pytania o dane biznesowe z pamięcią sesji, sugestie startowe, bąbelki chat, prawdziwy kontekst (imprezy + statystyki miesiąca)
- Backend: 5 endpointów `POST/GET/DELETE /api/ai/*` w server.py przy użyciu emergentintegrations
- Model: `gpt-5.6-terra` (OpenAI via EMERGENT_LLM_KEY)
- Historia czatu w kolekcji `ai_chat_messages` (owner-scoped, session-scoped)
- Dostęp z Więcej → "AI Asystent ✨"

### Etap 1 UI V2.0 — Kalendarz z Pulpitem + AI Coach kosztów (Aug 2026)
- **Kalendarz (`(tabs)/kalendarz.tsx`)** przepisany w V2.0 stylu (dark forest green header, glass KPI card, cards z designTokensV2)
- Dwa widoki w jednym tabie:
  - **Pulpit**: powitanie + KPI 2x2 (imprezy/gości/przychód/wynik), top 3 wskazówek AI, karty weekendowe, alerty rule-based, najbliższe imprezy
  - **Miesiąc**: legenda kolorów (zapłacone/zaliczka/brak), siatka miesięczna z inteligentnym kolorem kropek (worst-wins), agenda wybranego dnia
- Backup starego ekranu: `kalendarz.v1.tsx.bak`
- **AI top-3 na Pulpicie** — endpoint `/api/ai/assistant-tips` renderowany jako karty z ikoną severity, klik → pełny ekran AI
- **AI Coach kosztów** (nowa 4-ta zakładka w `/ai-asystent`) — endpoint `POST /api/ai/cost-coach`:
  - Hero card z sumą kosztów + zmianą % vs poprzedni miesiąc
  - AI summary (1-2 zdania) po polsku
  - Podział kategorii z paskami progress i zmianami vs poprzedni miesiąc
  - 3-5 konkretnych sugestii z pigułkami impact (wysoki/średni/niski)
  - Nawigacja +/- między miesiącami

### Wysyłka Oferty AI e-mailem — Aug 2026
- **Nowa sekcja „Wyślij do klienta"** w zakładce Oferty AI Asystenta (pojawia się po wygenerowaniu oferty)
- **Toggle typu imprezy** — „Okolicznościowa" vs „Firmowa (Wieczorna) 📎"
- **Auto-detekcja typu** — AI wykrywa z briefu słowa kluczowe (firma, integracja, wieczorna, b2b, korpo, pracowniczy…) i sam ustawia toggle; pigułka „🤖 AI wykryło z briefu"
- **PDF Oferty Gastronomicznej 2026** (`/app/backend/assets/offers/`) — automatyczny załącznik TYLKO dla imprez firmowych
- **Picker klientów** — modal z listą znanych klientów zdedublowaną z pola `events.client_*` (endpoint `GET /api/clients/known`)
- **Edytowalny tekst oferty** — użytkownik może dopracować AI-treść przed wysłaniem
- **Konfigurowalny temat** — domyślnie „Oferta — Biesiada pod Lasem", user może nadpisać
- **Personalizacja** — jeśli podano imię klienta, backend prependuje „Dzień dobry {Imię}"
- **Logi wysyłek** — kolekcja `ai_email_logs` (do audytu)
- **Backend endpointy** (nowe): 
  - `GET /api/clients/known` — lista znanych klientów
  - `POST /api/ai/detect-kind` — heurystyczna detekcja typu z briefu
  - `POST /api/ai/generate-summary` — AI podsumowanie szczegółów imprezy (dla mode="summary")
  - `POST /api/ai/send-offer-email` — wysyłka przez istniejący SMTP + załączniki

### Etap 2 UI — Centrum Imprezy / Nowa Impreza V2.0 (Aug 2026)
- **Ekran `event/[id].tsx`** (1713 linii) — pełny restyle do V2.0 BEZ zmian logiki:
  - Nowy header dark forest green z brandingiem "CENTRUM IMPREZY" / "NOWA IMPREZA" + tytuł
  - Wszystkie 160 odwołań `theme.color.*` zamienione na `v2.color.*`
  - Karty sekcji w białym tle, forest-green akcenty
  - Sekcja podsumowania (`.summary`) w dark forest green (kontrast)
  - Sticky footer „Zapisz zmiany" w forest green
- **Logika, endpointy, baza danych, funkcje — bez zmian** (0 zmian w handlers/state/effects)
- Import `theme` zastąpiony przez `formatPLN, initials` + `v2` z designTokensV2
- Fix routingu w kalendarz.tsx: `/event/new` → `/event/[id]` z `id: "new"` (spójne z resztą apki)

### Wysyłka Podsumowania AI (Centrum Imprezy) + Fix Delete Confirm — Aug 2026
- **Nowy przycisk „Wyślij podsumowanie"** w headerze Centrum Imprezy (ikona file-text, obok mail/kosz)
- Dostępny TYLKO dla zapisanych imprez (nie dla nowych)
- **Modal „Podsumowanie dla klienta ✉️"**:
  - AI generuje polski tekst potwierdzający na podstawie danych imprezy (data, gości, cena, zaliczka, do zapłaty)
  - Auto-fill: `to_email` i `client_name` z pól imprezy jeśli istnieją
  - Edytowalny tekst i temat przed wysyłką
  - Wykorzystuje endpointy: `POST /api/ai/generate-summary` (nowy) + `POST /api/ai/send-offer-email` z `mode="summary"`
  - Bez załącznika PDF (`attach_offer_pdf: false`)
  - Log w `ai_email_logs`

### 🐛 Krytyczny bugfix — Delete bez confirmu
- Test Report iteration 16 wykrył: `event-delete-btn` kasował imprezę **bez pytania**
- Naprawione: `Alert.alert("Usunąć imprezę?")` z dwoma przyciskami [Anuluj / Usuń (destructive)]
- Zabezpiecza przed przypadkowym skasowaniem

### Import finansów 2021-2026 z paczki ZIP — Aug 2026
- Rozpakowano `BPL_calendar_finance_import_2021-2026.json` (504 rekordy) + dokumentacja
- Backup finansów wykonany: `/app/backend/backups/finance_import_20260824_093754/events_finance_snapshot.json` (524 imprezy przed importem)
- DRY RUN zapisany: `dry_run_report.json`
- **Zaimportowano 423 imprezy** (UPDATE_FINANCE):
  - +588 670 zł przychodu
  - +162 039 zł kosztów
  - +429 588 zł zysku
  - 79 pominiętych (REVIEW_ONLY/NO_FINANCE_DATA — zgodnie z regułami)
  - 2 unmatched UID pominięte
- Audit log: `/app/backend/backups/finance_import_audit_20260824_094112/audit_log.json`
- **Zachowana bezpieczna logika**: nie nadpisujemy istniejących ACTUAL wartości, nie dotykamy dat/nazw/klientów/statusów/zaliczek
- Zapisane pola: `revenue`, `cost_total`, `profit`, `margin_ratio`, `price_total` (jeśli puste) + zagnieżdżony obiekt `finance.*` z metadanymi
- Liczba imprez w bazie: **524 (bez zmian)** ✅

### Etykieta „SZACUNEK" w UI
- Pigułka `SZAC.` obok Ceny na kartach imprez w Kalendarz > Pulpit
- Pigułka `SZAC.` w agendzie dnia (Kalendarz > Miesiąc)
- Banner na górze Centrum Imprezy: "Dane finansowe zaimportowane" + notatka `finance.notes` (opis kalkulacji) + pigułka `SZACUNEK` gdy dane są szacowane
- State `financeMeta` czytany z `ev.finance` (backend już zwraca)

### Uprawnienia pracowników — checkboxy w modalu (Aug 2026)
- W modalu edycji pracownika (`(tabs)/pracownicy.tsx`) dodana sekcja **UPRAWNIENIA PRACOWNIKA** z 5 przełącznikami:
  - Mój grafik (widzi swój grafik pracy)
  - Obecność (start/stop pracy, historia godzin)
  - Checklisty (odhacza zadania na imprezie)
  - Zakupy (widzi listę zakupów)
  - Magazyn (widzi stan magazynu)
- Zapisywane przez `api.staffCreateLogin(id, { permissions })` (już wspierane w backendzie od Fazy 3)
- Przy edycji istniejącego loginu — checkboxy prehydratowane z istniejących uprawnień
- Przycisk zmienia się na „Aktualizuj login + uprawnienia" gdy pracownik już ma konto

### Status Panelu Pracownika (stan na Aug 2026)
- **BACKEND**: 100% gotowe (3 role: admin/staff/partner, workspace isolation, endpoint login, permissions system)
- **FRONTEND**: Panel pracownika ma 4 zakładki (Grafik, Obecność, Zadania, Zakupy) — pełny widok
- **TAB-BAR**: Automatyczne przełączanie na inne taby dla staff vs admin (`_layout.tsx`)
- **UPRAWNIENIA**: Można granularnie odbierać dostępy (od tej iteracji)
- **BRAKI**: Panel staff wciąż używa starego stylu V1 (do przerobienia w Etapie 3), brak "Wyślij zaproszenie" mailem (właściciel wpisuje hasło ręcznie)

### Import kosztów z WhatsApp 2026-02..2026-08 — Aug 2026
- Źródło: Czat WhatsApp „Koszty BPL 2026" (npload user artifact, 368 wiadomości)
- Parser: WhatsApp export format, wykrywanie kwot z tekstu, wykluczanie parenteses jako notatek
- **Workspace docelowy**: piotreck85@gmail.com (owner_id 18ea076f)
- Backup przed importem: `whatsapp_costs_piotreck_20260824_171815/expenses_before.json` (304 pozycji, 146 531 zł)
- **Usunięto** 304 obecnych expenses (zawierały duplikaty i wcześniejsze importy)
- **Zaimportowano** 333 koszty (133 422,63 zł) — WhatsApp = jedyne źródło dla okresu
- **Wypłaty właścicieli** (13 pozycji, 57 020 zł) przeniesione do `partner_settlements` — zgodnie z zasadą, że NIE liczą się do kosztów firmy
- **Auto-przypisanie do imprez**: 156 kosztów przypisanych do imprezy z tego samego dnia (1 impreza = link), 26 wymaga ręcznej weryfikacji (>1 impreza tego dnia + słowo kluczowe „pensje/catering/spożywcze"), 177 to ogólne koszty firmy bez linku
- **Kategoryzacja**: pola `category` NULL — user będzie kategoryzował ręcznie każdy koszt
- Nowe pola na expense: `event_related_needs_review`, `event_candidates` (lista ID), `source`, `import_batch_id`, `sender`
- Suma kosztów w pliku = suma w aplikacji: **133 422,63 zł ✅**
- Suma wypłat w pliku = suma w aplikacji: **57 020 zł ✅**
- Audit report: `whatsapp_costs_piotreck_20260824_171815/audit_report.json`

### AI Kategoryzacja Kosztów — Aug 2026
- Nowy backend endpoint: `POST /api/expenses/ai-categorize`
  - Body: `{ ids?, limit?, dry_run? }`
  - Bierze wszystkie koszty bez kategorii dla owner_id
  - Deduplikuje po znormalizowanym opisie (usuwa kwoty) — oszczędza calle AI
  - Wywołuje GPT 5.6 Terra z systemem zasad (Biedra→spożywcze, Rata→inwestycje, Imię→pensje itp.)
  - Aktualizuje wszystkie duplikaty jednym batchem
  - Zwraca licznik updated + rozkład kategorii
- Frontend: `(tabs)/koszty.tsx` — dodany przycisk **„🤖 Skategoryzuj AI (X bez kategorii)"**
  - Widoczny tylko gdy uncatCount > 0
  - Confirm dialog przed odpaleniem
  - Loading state z ActivityIndicator
  - Alert z rozkładem kategorii po zakończeniu
- Test na piotreck85 workspace (333 kosztów → 100% skategoryzowane): rachunki 11, podatki 10, pensje 34, inwestycje 7, zakupy_spozywcze 75, ogolne_zaopatrzenie 196
- **Kategoryzacja ręczna** działa od zawsze — klik na koszt → edytuj → wybierz kategorię z chip'ów w modalu

### Import Zysków z WhatsApp 2026-03..2026-08 — Aug 2026
- Źródło: „Czat WhatsApp z Zyski BPL 2026" (ZIP z ukrytym .txt)
- Parser: identyczny jak dla kosztów (WhatsApp export format + extract_amount z pominięciem parenthes)
- 71 zysków wyparsowanych, suma **188 498,50 zł**
- **Backup** wszystkich imprez z revenue: `whatsapp_zyski_20260824_173354/events_revenue_before.json` (102 imprezy, 251 192 zł)
- **Wyzerowano** revenue/price_total na 102 imprezach przed importem (zapobiega dublom)
- **Rozkład:**
  - 31 zysków przypisanych do 1-imprezowego dnia (auto-link)
  - 7 przypisanych do multi-event dnia po dopasowaniu słów kluczowych (Komunia/18stka/Matura/Przedszkole)
  - 33 imprezy zaktualizowane w sumie (114 322 zł)
  - 26 zysków w kolekcji `pending_revenue_assignments` — do ręcznego wyboru która impreza (61 885 zł)
  - 7 zysków w kolekcji `misc_revenues` — brak imprezy tego dnia (dmuchaniec, suszarka, ognisko, refundy) (12 292 zł)
- **Kontrola sum:** 114 322 + 61 885 + 12 292 = **188 498,50 zł ✅ zgodne z plikiem źródłowym**
- Metadane finance: `revenue_source_kind: "ACTUAL_OR_MATCHED"`, `is_revenue_estimated: false`, `revenue_source_text` (opis z WhatsApp)
- Nowe kolekcje: `pending_revenue_assignments`, `misc_revenues`

### Pozostałe przychody + Własne kategorie — Aug 2026

**Pozostałe przychody (Misc Revenues):**
- Backend: 4 endpointy CRUD (`GET/POST/PUT/DELETE /api/misc-revenues`)
- Nowa kolekcja `misc_revenues` (używana już od importu Zysków)
- Frontend: nowy ekran `/pozostale-przychody.tsx` w V2.0 stylu (dark forest header + teal accent)
- Wchodzimy z Finanse → nowy kafel „Pozostałe przychody"
- Suma widoczna u góry, lista pod spodem z tagiem "📱 WhatsApp" dla importowanych
- Modal edycji/dodawania z polami: data, kwota, opis
- Long-press na wpis = usuń

**Własne kategorie kosztów (Custom Expense Categories):**
- Backend: 3 endpointy (`GET/POST/DELETE /api/expense-categories/custom`)
- Nowa kolekcja `custom_expense_categories` (per owner_id)
- Frontend w modalu edycji kosztu: po ostatniej predefiniowanej kategorii chip „+ Dodaj nową" (dashed border)
- Klik → Alert.prompt (native) / window.prompt (web) → wpisujesz nazwę → zapisuje i od razu wybiera nową kategorię
- Long-press na własną kategorię = usuń
- AI Kategoryzacja rozszerzona o custom categories (backend include ich do listy dopuszczalnych)

### Etap 3 UI — Finanse V2.0 + Split pozostałych zysków — Aug 2026

**Finanse V2.0 (dark forest + karty):**
- Ekran `/(tabs)/finanse.tsx` przerobiony w stylu V2.0 (spójny z Kalendarzem)
- Dark forest header z brand `FINANSE` + tytuł „Panel finansowy" + subtitle z okresem
- Chip bar (Bieżący miesiąc / Poprzedni / Rok / Zakres) na ciemnym tle
- Floating white KPI card (marginTop: -12) z dużym „Realny zysk" i badge (na plusie/minusie)
- Grid 2x2 KPI: Przychód, Koszty, Do pobrania, Imprezy (z kolorowymi ikonami)
- Info box (planowana wartość imprez) z niebieskim akcentem
- 6 modułowych kafli (Koszty, Przychody, Pozostałe przychody, Kasa, Wspólnicy, Statystyki) w V2.0 stylu
- Logika biznesowa/obliczenia bez zmian — używa `api.financeSummaryV2`

**Split 9 nieprzypisanych zysków WhatsApp:**
- Skrypt `split_pending_revenues.py` (backup w `backups/pending_revenue_split_20260824_180401/`)
- Każdy pending revenue z multi-event dnia podzielony równo między imprezy tego dnia
- Utworzono 18 nowych `event_payments` (18 płatności z 9 pending), zredukowano pending do 0
- Wszystkie z `source: 'whatsapp_pending_split'` i opisem „WhatsApp import (auto-split): ..."

### Etap 4/5 — Zakupy V2.0, Zwijalny catering, Perf pracowników — Aug 2026

**1. Zakupy + Magazyn V2.0 (`/(tabs)/zakupy.tsx`):**
- Dark forest header + brand `ZAKUPY` + tytuł (Automatyczna lista / Magazyn)
- Białe przyciski akcji (drukuj, przepisy) na ciemnym headerze
- Segmented switch „Do kupienia / Magazyn" na białym overlay na ciemnym tle (aktywna zakładka = białe pigułka)
- Hero „ZAKUPY NA..." jako floating white card z shadow.sm + zaokrągleniami 16 (v2.radius.xl)
- Wszystkie karty (Do kupienia + Moja lista) na v2.color.card z bordami v2.color.border
- Logika/API bez zmian — używa `api.shoppingList/Generate/etc.`

**2. Zwijalny catering (nie zawsze potrzebny do wyceny):**
- `event/[id].tsx`: sekcja „Oferta obiadowa" zwinięta domyślnie
  - Klikalny nagłówek z ikoną coffee, tytułem, chevron-down
  - Auto-rozwija się jeśli event już ma zapisane porcje (edycja starej imprezy)
  - Pokazuje licznik: „Oferta obiadowa · 3 poz. · 780 zł"
  - Cały blok menu (Zupa/Danie główne/Dodatek) + „Wyślij do Yubari" ukryte, gdy zwinięte
- `(tabs)/oferta.tsx`: sekcja „Menu obiadowe" w modalu wysyłki oferty zwinięta domyślnie
  - Reset stanu przy każdym otwarciu modala
  - Klikalny nagłówek z licznikiem porcji, chevron
  - Zupy/Dania główne/Dodatki chowają się razem

**3. Optymalizacja wydajności panelu pracowników:**
- **BUG FIX**: `useMemo` używany jako side-effect w `pracownicy.tsx` linia 225 → zmienione na `useEffect`
- `renderStaffItem` + `staffKeyExtractor` w useCallback (żeby FlatList nie tworzyła nowych funkcji przy każdym renderze)
- `openEdit` i `remove` w useCallback (stabilne referencje)
- FlatList props: `initialNumToRender=12`, `maxToRenderPerBatch=10`, `windowSize=7`, `removeClippedSubviews`
- Ta sama optymalizacja dla wages FlatList (10/8/5)
- `grafik.tsx`: `todayEvent` i `upcoming` opakowane w `useMemo`

### Etap 4 UI + Tab Bar V2.0 + Praca Ekipy + Presety Cateringowe — Aug 2026

**1. Etap 4 UI — Pracownicy V2.0:**
- Header ekranu Pracownicy przerobiony na V2.0: ciemna zieleń (v2.color.forestDeep) + brand ZESPÓŁ + tytuł "Twój zespół"
- Ikony w headerze (workspace, history, menu) w białym kółku z rgba(255,255,255,0.15)
- Root background: v2.color.bg (jasny mint)

**2. Global Tab Bar V2.0 (`(tabs)/_layout.tsx`):**
- Aktywna zakładka: mint pill background (v2.color.mint) + zielona ikona (v2.color.forest)
- Nieaktywne: brak tła, ikona v2.color.textSubtle
- Tab bar bg: v2.color.card, border v2.color.border
- Etykieta: fontWeight 800, letterSpacing 0.3, uppercase, textColor forest gdy active
- Uwaga: dla pracowników nazwa Grafik → **"Moja praca"**, ikona `briefcase`

**3. Nowy ekran „Moja praca" (`(tabs)/grafik.tsx`):**
- Header V2.0 (dark forest) + "MOJA PRACA" brand + "Cześć, {imię} 👋"
- Floating clock card z guzikiem ROZPOCZYNAM PRACĘ / KOŃCZĘ PRACĘ + link do historii obecności
- Sekcja **Dzisiaj**: karta z detalami imprezy (czas, osoby, rola, lokalizacja), notatki publiczne (notes_public), **inline checklist** z paskiem postępu, 3 pierwsze zadania z ✓/○, „+ N więcej"
- Sekcja **Jutro**: identyczna karta dla jutrzejszej imprezy (kolor niebieski w oznaczeniu)
- Sekcja **Nadchodzące**: lista imprez dalej niż jutro (max 10)
- Empty states dla dni bez pracy z ikoną coffee/moon + zachęcającym tekstem
- Klik na checklistę = router.push(`/checklist/{id}`) → pełny widok

**4. Presety cateringowe (`src/cateringPresets.ts` + integracja):**
- 5 gotowych presetów: Standardowy · Popularny · Elegancki · Regionalny · Bez zupy
- Struktura: `items_per_person` (dla dinnerMenu.ts IDs) + `offer_items_per_person` (dla offers.ts DINNER_EXTRAS IDs)
- Helpers: `buildPresetQty()` i `buildPresetOfferExtras()` — mnożą per-person × liczba osób
- **event/[id].tsx**: sekcja „Szybki wybór" w rozwiniętej ofercie obiadowej, poziomy scroll z kartami, wypełnia dinnerQty
- **oferta.tsx**: identyczna sekcja w modalu wysyłki oferty, wypełnia emailExtras
- Walidacja: jeśli liczba osób = 0, Alert „Wpisz liczbę osób"

### Automatyczna wiadomość po imprezie + rabaty 10% — Aug 2026

**Backend (`thank_you.py` + endpointy w `server.py`):**
- Nowa kolekcja `discount_codes`: {id, code=POWROT10-XXXX, owner_id, client_email(lowercased), source_event_id, amount_pct, amount_zl, base_package_price, expires_at_date (12mc), status: active|used|expired, used_at, used_event_id}
- Nowa kolekcja `thanks_email_logs`: {id, event_id, recipient, status: sending|sent|failed|no_email, code_id, subject, sent_at, error, resent_at}
- Ustawienia w `workspace_settings.thank_you_email`: enabled, subject, body_template, google_review_url, discount_pct, valid_months, activated_at (cutoff — brak retroaktywnych wysyłek)
- Nowe endpointy:
  - `GET/PUT /api/settings/thank-you-email` (admin only)
  - `POST /api/events/{id}/complete` — status→zakonczona + generuj kod + wyślij mail (**idempotentny** — replace_one po event_id)
  - `POST /api/events/{id}/resend-thanks` — ponowna wysyłka TEGO SAMEGO kodu (spec: „ponowna ręczna wysyłka wykorzystuje ten sam kod")
  - `GET /api/events/{id}/thanks-status` — {sent, log, code}
  - `GET /api/events/{id}/thanks-preview` — renderowany subject+body
  - `GET /api/discounts/for-client?email=X` — aktywne kody klienta
  - `POST /api/events/{id}/apply-discount` — zastosuj kod, oznacz used, odejmij od price_total
  - `POST /api/events/{id}/remove-discount` — cofnij
  - `GET /api/discounts/list?status_filter=...` — lista wszystkich
- Zabezpieczenia:
  - Idempotencja: przy 2. wywołaniu /complete zwraca `already_sent` (bez nowego kodu ani maila)
  - Brak e-maila: log z `status=no_email`, brak generowania kodu
  - Błąd SMTP: log `status=failed`, kod usunięty (żeby nie zostawić „nieaktywnego" rabatu)
  - Rabat od `package_price` (nie od całości — extras/dinner odejmowane)
  - Podwójne zastosowanie kodu blokowane (`status=used`)

**Frontend:**
- `event/[id].tsx`:
  - Przy zapisie z status=„zakonczona" (transition z innego stanu) → Alert „Zakończyć imprezę? · Zakończ bez wysyłki · Zakończ i wyślij"
  - Jeśli brak e-maila → tylko „Zakończ" (bez opcji wysyłki)
  - Panel statusu po zakończeniu: „Wysłano podziękowanie" (kod, odbiorca, data) + guziki Podgląd/Wyślij ponownie
  - W sekcji Klient dla EDYCJI imprezy: banner „Klient posiada aktywny rabat X%" + guzik „Zastosuj rabat" → alert potwierdzający, aplikuje, odejmuje od ceny
  - Applied discount: pokaz „Zastosowano rabat POWROT10-XXXX (-500 zł)" z X (usuń)
  - Debounce 500ms na klienta email → `GET /discounts/for-client`
- `ustawienia/podziekowanie.tsx` (nowy screen w V2.0):
  - Włącz/wyłącz automatyczną wysyłkę
  - Zasady rabatu (%, ważność)
  - Link do opinii Google (placeholder: g.page/r/CWTSbZ43izysEAE/review)
  - Temat i treść wiadomości (edycja) + zmienne w helpTextu
  - Przycisk „Przywróć domyślną treść"
  - Historia kodów: taby Aktywne/Wykorzystane/Wygasłe
- Wejście: `Więcej → Podziękowanie po imprezie + rabaty`

**Testy (piotreck85@gmail.com):**
- ✅ /complete wysłał realny mail (kod POWROT10-XJVA, log.status=sent, sent_at ustawiony)
- ✅ Idempotencja: 2. wywołanie zwraca `already_sent`
- ✅ Aplikacja rabatu na nowej imprezie: 6000 → 5500 (10% z package_price 5000)
- ✅ Podwójne użycie kodu blokowane (400)

### Kupony ręczne dla stałych klientów — Aug 2026

**Backend:** `POST /api/discounts/manual` (admin)
- Body: `{client_name*, client_email?, amount_pct?, valid_months?, note?, send_email?}`
- Waliduje: nazwa wymagana, % 1-100, mc 1-60
- Tworzy `discount_codes` z `manual: true`, `source_event_id: None`, `note`, `created_by`
- Jeśli `send_email=true` i jest e-mail → wysyła ten sam szablon podziękowania z nowym kodem
- Zwraca `{code, email: {attempted, sent?, error?, recipient?}}`

**Frontend:**
- Nowy komponent `ManualDiscountModal.tsx` (bottom sheet) — reużywalny
- **Ustawienia → Podziękowanie + rabaty**: przycisk „+ Wygeneruj kod" obok „Historia kodów rabatowych"
- **event/[id].tsx** → sekcja Klient: przycisk „Wygeneruj kod rabatowy dla klienta" (pokazany gdy jest imię/email klienta i brak aktywnych/zastosowanych kodów)
  - Modal auto-uzupełnia klienta z eventu
  - Po wygenerowaniu odświeża listę → banner „Klient posiada aktywny rabat" pojawia się od razu z guzikiem „Zastosuj"
- Historia kodów: badge „RĘCZNY" dla kodów bez `source_event_id`, notatka pokazana jako „💬 …"

**Testy:**
- ✅ Kod bez wysyłki (15%, 6 mc, notatka „urodziny") — `POWROT10-PDCN` utworzony
- ✅ Kod z wysyłką (10%, 12 mc) — mail dostarczony na piotreck85@gmail.com, `POWROT10-2AZW`

### Wiadomość przed imprezą — 48 godzin wcześniej

- Backendowy skaner APScheduler co minutę odtwarza harmonogram z MongoDB; restart serwera nie gubi wysyłek.
- Wysyłka dotyczy wyłącznie wydarzeń ze statusem `potwierdzona`; późne potwierdzenie planuje wysyłkę od razu.
- Stałe mapowanie wyłącznie z pola `category` (bez AI i bez analizy opisu):
  - `dorosli/okolicznosciowe`, `dorosli/firmowe` → `adults`
  - `dzieci/urodzinki/*`, `warsztaty*`, `dzieci/wycieczki`, `dzieci/wycieczki_rodzice` → `children`
- Każdy mail zawiera dokładnie 2 załączniki: jeden właściwy regulamin PDF oraz stałą mapę `kolorowa_mapa_atrakcji_pod_lasem.png`.
- Temat: `Do zobaczenia za 2 dni – Biesiada pod Lasem 🌲`; treść jest jednym powitalno-organizacyjnym mailem opisującym regulamin, mapę i ostatnie informacje do potwierdzenia.
- Pola wydarzenia: `pre_event_email_status`, `pre_event_email_scheduled_at`, `pre_event_email_sent_at`, `pre_event_email_address`, `pre_event_email_message_id`, `regulation_type` oraz wewnętrzne pola blokady/idempotencji.
- Zmiana daty/godziny/adresu/kategorii przelicza harmonogram; anulowanie, zmiana statusu i usunięcie wydarzenia blokują wysyłkę.
- Brak e-maila tworzy alert owner/admin i komunikat: „Brak adresu e-mail klienta – wiadomość przed imprezą nie została wysłana.”
- Karta wydarzenia pokazuje harmonogram/status oraz akcje: podgląd maila, podgląd regulaminu, wyślij teraz, świadome „wyślij ponownie”.
- Karta wydarzenia pokazuje listę załączników: właściwy Regulamin dzieci/dorośli oraz Mapa Biesiady.
- Raporty testów bez SMTP: `/app/test_reports/pre_event_email_report.json` (21/21), `/app/test_reports/pre_event_email_api_report.json` (7/7), `/app/test_reports/iteration_17.json` (15/15) i `/app/test_reports/iteration_19.json` (100%).
- Zweryfikowano trwałość: `scheduled_at` i status pozostały bez zmian po restarcie backendu; 0 logów wysyłki SMTP podczas testów.
- Przy okazji zabezpieczono login hasłowy dla kont Google bez `password_hash` (kontrolowane 401 zamiast 500).

### Kalendarz miesięczny — etykiety kategorii

- Usunięto kolorowe kropki jako główną prezentację wydarzeń; każda impreza ma małą etykietę tekstową.
- Źródłem tekstu jest wyłącznie `events.category` i jej istniejąca podkategoria:
  - `dorosli/okolicznosciowe` → Okolicznościowa
  - `dorosli/firmowe` → Firmowa
  - `dzieci/urodzinki/*` → Tematyczne / Konie / Gady / Standard / Start
  - `warsztaty/*` → konkretna podkategoria warsztatów
  - `dzieci/wycieczki*` → istniejący wariant wycieczki
  - brak wartości → Bez kategorii
- Kolor etykiety wynika wyłącznie ze statusu; `potwierdzona` ma kolor niebieski.
- W komórce są maksymalnie 2 etykiety, następnie `+N więcej`; długi tekst jest skracany wielokropkiem.
- Kliknięcie etykiety otwiera konkretną kartę wydarzenia. Osobny przycisk numeru dnia otwiera pojedynczy event albo picker przy 2+ wydarzeniach.
- Zmiana jest frontend-only; nie modyfikuje dokumentów w MongoDB.
- Raport testów: `/app/test_reports/iteration_18.json`; finalny screenshot: `/tmp/kalendarz-miesieczny-final-kategorie.png`.
- Widok `Miesiąc` jest domyślny na świeżym wejściu, po restarcie oraz po każdym powrocie do modułu Kalendarz; Pulpit pozostaje dostępny ręcznie w bieżącej sesji.

## Iteration (Jun 2026) — Staff invitations + Staff event card + AI client replies
### 1. Staff email invitations (Zaproszenia pracowników)
- Zespół → Pracownik modal: statuses Nie zaproszony / Zaproszenie wysłane / Zaproszenie wygasło / Aktywne konto
- Buttons: [Wyślij zaproszenie e-mailem] (uses email input + permissions), [Wyślij ponownie], [Anuluj]
- Backend: `staff_invites.py` + endpoints `GET/POST/DELETE /api/staff/{id}/invite`, `POST .../invite/resend`
- One-time token (sha256-hashed, `secrets.token_urlsafe(32)`), valid 7 days, collection `staff_invitations`
- Public activation page (backend-served HTML): `GET/POST /api/invitations/{token}/activate` — employee sets own password (bcrypt)
- Email via existing Gmail SMTP (offer_email.send_offer_email). Manual login creation kept unchanged.
- Tests: /app/backend/tests/test_staff_invites_e2e.py (21/21)

### 2. Staff event card — Moja praca → karta imprezy (`/moja-impreza/[id]`)
- Staff-safe endpoint `GET /api/staff/my/events/{id}` with HARD WHITELIST (`STAFF_SAFE_EVENT_FIELDS` in server.py)
  — staff NEVER receives price/revenue/costs/profit/deposits/private notes/client contact. Also hardened
  `GET /api/events` and `GET /api/events/{id}` for role=staff (403 when not assigned).
- New event field `org` (dict, staff-visible org data): tables_setup, tables_plan, menu_details, grill, drinks,
  cakes, client_provisions, decorations, client_own_decorations, early_arrival, early_arrival_time, attractions,
  extra_orders, org_notes, special_requests, allergies, setup_info, kids_count, adults_count
- Admin event card (event/[id].tsx): new sections "Organizacja — widoczne dla obsługi" (saved with main Zapisz),
  "Najnowsze informacje od klienta" (client_update_text/at/by via POST /api/events/{id}/client-update),
  "Informacja dla obsługi" (embedded `service_infos` array, important flag ⚠ WAŻNE, add/delete),
  "Informacje od zespołu" (staff comments read-only)
- Staff comments: collection `event_comments`, `POST /api/staff/my/events/{id}/comments` (staff assigned only),
  `GET /api/events/{id}/comments` (admin/partner only). Creates alert kind=staff_comment
  ("Nowa informacja od pracownika – …") shown in Kalendarz bell; alert row navigates to event.
- Partner support: `_require_admin_or_partner` (staff user with staff_type=partner can add service info,
  client updates, see comments/suggestions).
- grafik.tsx (Moja praca): today/tomorrow cards + upcoming rows navigate to /moja-impreza/{id}
- Tests: /app/backend/tests/test_staff_card_e2e.py (44/44 incl. permission matrix)

### 3. AI ingestion of client replies to the 48h pre-event email
- Module `client_replies.py`: APScheduler job `client_reply_scan` every 5 min scans connected Gmail accounts
  (collection `gmail_connections` — REQUIRES the Gmail OAuth fix, still blocked on user's GCP config!)
- Matching by RFC-2822 headers In-Reply-To/References containing our Message-ID `<pre-event-{event_id}...>`
  (never by email address alone); Gmail threadId stored too
- AI extraction (existing Emergent LLM setup, openai/gpt-5.6-terra): strict JSON, never guesses —
  ranges like "30–35 osób" go to people_note text, not people_final
- Suggestions collection `client_reply_suggestions` (status pending/approved/rejected); alert kind=client_reply
  "Nowa odpowiedź klienta przed imprezą – sprawdź informacje."
- Admin event card panel "📩 NOWA ODPOWIEDŹ KLIENTA": klient napisał + AI rozpoznało + buttons
  [ZATWIERDŹ I ZAPISZ] [EDYTUJ] [ODRZUĆ]. Approve merges into event: client_update_text (+at/by), people,
  org.* (append-safe merge), audit_log entries for receive/approve/reject.
- Endpoints: GET /api/events/{id}/client-reply-suggestions, POST /api/client-reply-suggestions/{id}/approve|reject,
  POST /api/client-replies/scan (manual trigger)

### Demo data (preview DB — can be deleted)
- Event "DEMO Urodzinki Stasia (8 lat)" (2026-09-02, id a3a97b37-3245-490f-a8b9-7cdcbbcff764)
- Staff "Zuzia Demo" login zuzia.demo@test.pl / demo123, one pending demo suggestion

### Pending / next
- Grafik pracowników (monthly schedule view for admin in Więcej + month view in Moja praca + PDF print) — APPROVED by user, not yet built
- Gmail OAuth GCP fix (user-side) — blocks live reply scanning + Gmail Etap 1/2

## Iteration (Jun 2026) — Grafik pracowników (monthly schedule)
- Admin screen `/grafik-pracownikow` (entry: Więcej → "Grafik pracowników (miesiąc)"):
  month grid (Mon-first, day badges with event counts), month switcher, staff filter chips
  (Wszyscy + staff having shifts that month), selected-day detail with staff chips
  (name + shift time/hours, "⚠ brak obsady" when unstaffed), full month list, tap event → /event/{id}
- PDF print: reused src/printSchedule.ts `printSchedule()` with NEW `includePay?: boolean` param —
  schedule prints WITHOUT rates/payouts (safe for wall). Print restyled from old gold theme to forest green.
  Filter-aware printing (per-employee schedule via ownerName subtitle).
- Staff month view in Moja praca (grafik.tsx): toggle Lista | Miesiąc (testIDs grafik-view-lista/miesiac),
  month grid marks ONLY own shifts (data: GET /staff/my/schedule?date_from&date_to), day tap → own events,
  month list of own shifts; rows navigate to /moja-impreza/{id}. No other staff visible.
- Gmail connection status: still 0 connections — user has NOT yet completed "Połącz Gmail" consent flow.

## Iteration (Jun 2026) — Import kosztów BPL_2026 (reclassification)
- Full mongodump backup: /app/backups/backup_20260830_225230 (8.3M) BEFORE any change
- Old flat WhatsApp batch (expenses import_batch_id=WHATSAPP_2026_02-08_V2, 333 records, 133 422,63 zł)
  ARCHIVED to `_backup_expenses_whatsapp_v2` (restorable) to avoid double counting
- Import module `/app/backend/import_bpl2026.py` (batch BPL_2026_V5, owner 18ea076f piotreck85@gmail.com):
  auto-booked 139 (103 event costs 28 073 zł into 34 events via costs[] with imported markers;
  36 general expenses 16 463,16 zł), 183 pending review (65 221,34 zł), 13 duplicates vs manual entries
  skipped, 9 info rows skipped, idempotent dedup sha1(date|amount|desc|source) in `imported_costs`
- New collections: `imported_costs` (full audit of each row + resolution), `investments`, `import_batches`
- Endpoints: GET /api/cost-import/summary, GET /api/cost-import/pending (with per-date event candidates),
  POST /api/cost-import/{id}/resolve {action: event|general|investment|settlement|reject, event_id?, amount?, category?},
  GET /api/investments — all admin-only, audit-logged
- UI: Finanse → tile "Import kosztów" → /import-kosztow screen (report chips, pending cards with editable
  amount/category, event candidate picker, action buttons). Verified working.
- NOTE: import ran on PREVIEW DB. Owner account for real data: piotreck85@gmail.com (password unknown to agent).

## Iteration (Jun 2026) — Moduł czasu pracy: plan + korekty dwustronne
- StaffShift model extended: role, note (+extra allow); planned shift hours independent of event hours
- time_entries: soft-delete (deleted flag), pending_correction_id, corrected, original_start_at/end_at
- NEW collection `time_corrections`: statuses PENDING_EMPLOYEE/PENDING_MANAGER/APPROVED/REJECTED/CANCELLED,
  full audit (original/proposed times, requester, approvals both sides, reason, history[])
- BACKEND-ENFORCED two-sided approval: PATCH /time-entries start/end → 409; DELETE closed entry → 409;
  employee can't approve manager side & vice versa; staff only own corrections
- Endpoints: POST/GET /time-corrections, POST .../{id}/approve|reject|cancel, GET /time/team (admin day view)
- Payroll: excludes deleted, pending corrections flagged (pending_corrections) — never silently change pay
- Frontend: grafik.tsx (TWÓJ CZAS PRACY banner, correction quick buttons + Korekty badge),
  /korekty-czasu (staff form: popraw START/STOP, dodaj wpis; approval lists both roles),
  /czas-zespolu (admin: plan vs faktycznie, diff, PRACA TRWA, propose correction per entry),
  wiecej.tsx row "Czas pracy zespołu", obecnosc.tsx correction badges, event/[id].tsx shift role+note inputs
- Tests: /app/backend/tests/test_time_corrections_e2e.py — 32/32 (all 11 spec scenarios + payroll rules)
- No destructive migration; legacy time_entries compatible (verified in tests)

## Iteration (Jun 2026) — Dostępność pracowników (Staff Availability)
- New collection `staff_availability`: one doc per (owner_id, staff_id, date);
  {status: available|unavailable, all_day, time_from/time_to (HH:MM), note, updated_at/by}.
  No doc = "brak deklaracji". Cascade-deleted with staff.
- Staff (Moja praca → toggle "Dostępność", `src/components/AvailabilityCalendar.tsx`):
  month grid (green/red/neutral cells), tap future day → bottom sheet: 🟢 Dostępny / 🔴 Niedostępny /
  ⚪ Brak deklaracji, switch "Cały dzień" vs hours HH:MM, note; list of month declarations.
  Past days view-only. Staff can change declaration ANYTIME (existing assignments stay).
- Endpoints: GET/PUT /api/availability/my[/{date}] (staff), GET /api/availability/team,
  GET /api/availability/for-date?date= (admin only).
- BACKEND-ENFORCED BLOCK (400) in POST/PUT /api/events: cannot assign staff who declared
  unavailable — all-day always blocks; partial-day blocks only when shift window
  (fallback: event window) overlaps; unknown windows treated as overlap (safe).
  On UPDATE only NEWLY added staff are checked (date change re-checks all) — so a later
  unavailable declaration never breaks saving an event with an existing assignment.
- Admin UI: event/[id].tsx staff picker shows per-staff pill (🟢/🔴/⚪ + hours);
  all-day unavailable = blocked with Alert; partial = confirm "Dodaj mimo to";
  assigned shifts show red warning banner when staff declared unavailable.
  save() now surfaces backend errors via Alert (was silently swallowed) and
  persists shift role/note (previously dropped on save).
- Admin screen /dostepnosc-zespolu (Więcej → "Dostępność zespołu"): month grid with
  green/red dots, day detail = all staff with status pills, month list of unavailabilities.
- Tests: /app/backend/tests/test_availability_e2e.py — 22/22.

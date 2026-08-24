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
- (tabs)/kalendarz — monthly grid with gold dots + day event list
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

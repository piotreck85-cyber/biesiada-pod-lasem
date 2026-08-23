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

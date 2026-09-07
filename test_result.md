#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Mobile Expo app "Biesiada pod lasem" — event calendar for a catering venue.
  Latest additions in this iteration:
    1. Weather forecast (backend /api/weather) — must be resilient to Open-Meteo rate limits
       via multi-provider fallback (Open-Meteo → 7Timer → wttr.in). Returns "available": true|false + graceful message.
    2. 2-day auto alerts: APScheduler scans all events every 2h. If an event's status is
       "wstepne" or "rezerwacja" AND created_at is ≥2 days ago AND the event date is in the future,
       create an alert row and send a digest email to the workspace owner. Alerts are deduplicated
       per (event_id, kind) and auto-dismissed when the event's status leaves the tracked set.
    3. Alerts UI in Kalendarz tab: bell icon in top-right of header with count badge; opens a modal
       listing pending alerts; each row taps into /event/[id]; dismiss single or all.
    4. Status dots on calendar days: below the day number, show up to 3 colored dots — one per
       unique status present on that day. Green = potwierdzona/zakonczona, Yellow = wstepne/rezerwacja,
       Red = anulowana.
    5. Google Calendar sync (option A — one-way public ICS feed): per-user unguessable token, endpoint
       GET /api/calendar/feed/{token}.ics returns full ICS. UI card in Statystyki with copy link,
       open Google Calendar, rotate token.
  Test credentials: /app/memory/test_credentials.md — test@eventa.pl / test123.

backend:
  - task: "Weather multi-provider fallback"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Rewrote /api/weather to cascade Open-Meteo → 7Timer → wttr.in with per-provider try/except, positive+negative caching (60m/5m), User-Agent header on Open-Meteo. Verified manually: 7Timer returns full payload when Open-Meteo is 429. Needs automated test."
  - task: "APScheduler + 2-day alerts scan"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "APScheduler AsyncIOScheduler starts on FastAPI startup and runs scan_and_create_alerts() every 2h (first run ~30s after boot). Verified manually via python script + POST /api/alerts/scan: alert doc created, email sent via Gmail SMTP. update_event now dismisses stale alerts when status leaves the tracked set (wstepne/rezerwacja)."
  - task: "Alerts CRUD endpoints"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "GET /api/alerts (workspace-scoped, dismissed excluded, newest first), POST /api/alerts/{id}/dismiss, POST /api/alerts/dismiss-all, POST /api/alerts/scan (manual trigger)."
  - task: "Google Calendar public ICS feed"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "GET /api/calendar/feed-url (auth) returns per-user 32-char token, GET /api/calendar/feed/{token}.ics (no auth) returns full ICS with X-WR-CALNAME/X-WR-TIMEZONE/REFRESH-INTERVAL/X-PUBLISHED-TTL headers. Feed uses new time_start/time_end fields with TZID=Europe/Warsaw. POST /api/calendar/feed-url/rotate regenerates token. Old /api/export/calendar.ics still auth-guarded and reuses same builder."
  - task: "Event update auto-dismisses alerts on status transition"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "PUT /api/events/{id} now detects prev→new status transitions and (a) auto-dismisses existing alerts when status leaves wstepne/rezerwacja, (b) resets alert_sent flag on re-entry so future scans can re-alert."

  - task: "Google Calendar OAuth2 auto-sync (app → Google)"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py, /app/backend/google_calendar.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: |
            Full OAuth 2.0 Web Application flow:
              GET /api/google-calendar/status → {configured, connected, connection}
              GET /api/google-calendar/oauth/start (auth) → {authorization_url}
              GET /api/google-calendar/oauth/callback (public, called by Google) → HTML that self-closes
              POST /api/google-calendar/disconnect (auth) → marks revoked_at
              POST /api/google-calendar/backfill (auth) → pushes ALL workspace events to Google
            Refresh tokens are encrypted with Fernet (GOOGLE_TOKEN_ENCRYPTION_KEY env). On first
            connect we auto-create a dedicated calendar "Biesiada pod Lasem" (or reuse if it
            already exists by title). Event create/update/delete endpoints now call
            _sync_event_for_workspace() best-effort (all workspace users with a connection get
            their own Google mirror). Uses per-user google_event_ids map on the event doc.
            On any Google 401 we refresh access_token once; on invalid_grant refresh we mark
            the connection revoked_at. Delete tolerates 404/410 as idempotent success.
            Credentials in /app/backend/.env: GOOGLE_CALENDAR_CLIENT_ID/SECRET/REDIRECT_URI/TOKEN_ENCRYPTION_KEY.
  - task: "Workshop offer email: attach new DOCX + updated school signoff"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py, /app/backend/offer_email.py, /app/backend/assets/oferta_warsztaty_jesienne_2026.docx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: |
            Workshops offer now attaches BOTH the existing PDF and the new DOCX
            (Jesienne-Warsztaty-Edukacyjne-2026.docx). Signoff for event_type=warsztaty
            updated to include: www.Dolinaprzygod.pl / szkoly@biesiadapodlasem.pl / 518 029 217.
            attachments_txt/html blocks list both files. Verified via /api/offers/send-email.
frontend:
  - task: "Monthly calendar category labels"
    implemented: true
    working: true
    file: "/app/frontend/app/(tabs)/kalendarz.tsx, /app/frontend/src/calendarEvent.ts"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: true
          agent: "main"
          comment: "Category/subcategory labels replace dots; status-only colors, max 2 +N, direct event navigation, deterministic day-number picker. Iteration 18 issues self-tested and fixed. No MongoDB writes."
  - task: "Google Calendar OAuth Connect card (Statystyki)"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/(tabs)/statystyki.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: |
            New card above the ICS URL card. States: not-configured, disconnected, connected.
            Connect flow: POST /oauth/start → open in Web (location.assign) or expo-web-browser
            openAuthSessionAsync on native. After return, we re-poll /status. Connected view shows
            calendar name + "Wyślij wszystkie do Google" (backfill) and "Rozłącz" buttons.
            testIDs: gcal-oauth-connect-btn, gcal-oauth-backfill-btn, gcal-oauth-disconnect-btn.
  - task: "Bell icon + alerts modal in Kalendarz"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/(tabs)/kalendarz.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Header top-right shows a bell (testID: alerts-bell) with a red count badge when alerts.length > 0."
  - task: "Status dots on calendar days"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/(tabs)/kalendarz.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Under each day number a row of small colored dots (7px) is rendered — one per unique status present that day. Order: green (potwierdzona/zakonczona), yellow (wstepne/rezerwacja), red (anulowana). testIDs status-dot-{date}-{idx}. Verified visually on screenshot: 3 dots visible on day with 3 different statuses."
  - task: "Google Calendar sync card in Statystyki"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/(tabs)/statystyki.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "New card shows the feed URL in a monospace box, with Copy (expo-clipboard), Open Google Calendar (deep link to addbyurl page), and Rotate token buttons. Loaded on focus via api.getCalendarFeedUrl()."

metadata:
  created_by: "main_agent"
  version: "1.1"
  test_sequence: 1
  run_ui: true

test_plan:
  current_focus:
    - "Pre-event welcome email with exactly regulation PDF + attractions map PNG"
    - "Calendar always defaults to Month on entry and re-entry"
    - "Monthly calendar category labels and day picker"
    - "Pre-event email 48h scheduler, fixed category mapping and one PDF attachment"
    - "Pre-event email card with preview/send/resend actions"
    - "Weather multi-provider fallback"
    - "APScheduler + 2-day alerts scan"
    - "Alerts CRUD endpoints"
    - "Google Calendar public ICS feed"
    - "Event update auto-dismisses alerts on status transition"
    - "Bell icon + alerts modal in Kalendarz"
    - "Status dots on calendar days"
    - "Google Calendar sync card in Statystyki"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    - agent: "main"
      message: |
        Iteration 19 final verification: 24/24 pytest checks and 21/21 dry-run checks passed.
        Database event count remains 524; pre_event_email_logs remains 0, confirming no test SMTP.
        UI verified: fresh/re-entered Calendar defaults to Month; event card shows both attachments.
        Removed the testing-only helper that embedded a JWT secret; no credentials remain in test helpers.
    - agent: "main"
      message: |
        Iteration 19 ready for testing. Pre-event email subject/body updated to the exact new
        welcome-organizational copy. MIME message must contain exactly 2 attachments in order:
        correct category-mapped regulation PDF, then kolorowa_mapa_atrakcji_pod_lasem.png.
        Dry-run only: never invoke real SMTP. Pure regression report is 21/21.
        Event card now lists Regulamin dzieci/dorośli + Mapa Biesiady.
        Calendar view state defaults to miesiac and useFocusEffect resets it to miesiac on every
        module re-entry. Main self-test passed fresh entry and Oferta -> Kalendarz return.
    - agent: "main"
      message: |
        Iteration 18 post-fix complete. Added dedicated cal-day-number-{day} target; August 8 now
        consistently opens the two-event picker. Category labels still open exact events. Removed
        RN raw text warning by booleanizing the empty client name/email condition in event/[id].tsx.
        Self-test confirms no Unexpected text node warning. Calendar change is frontend-only and
        uses category/subcategory exclusively; no MongoDB create/update/delete was performed.
    - agent: "main"
      message: |
        Post-fix verification complete for iteration 17 findings.
        Auth without password_hash now returns safe 401 + Bearer header; password login remains 200.
        Event screen browser console is clean after full reload. Regression: 15/15.
        Scheduler persistence tested through a real backend restart: scheduled_at/status unchanged.
        SMTP safety confirmed: 0 pre_event_email_logs and all temporary test events removed.
    - agent: "main"
      message: |
        Iteration — Wiadomość przed imprezą 48h implemented.
        Backend: /app/backend/pre_event_email.py + routes/hooks/scheduler in server.py.
        Frontend: event/[id].tsx card + api.ts methods.
        Assets: both user-provided regulation PDFs in backend/assets.
        IMPORTANT: do not send SMTP messages to real addresses. Test mappings/attachments with
        `python backend/test_pre_event_email.py` (dry-run only), and use far-future temporary events
        for API/UI scheduling tests. Existing reports: pre_event_email_report.json 16/16 and
        pre_event_email_api_report.json 7/7. Verify all five category groups, status gating,
        date reschedule, cancellation, missing email notice, one attachment only, idempotency,
        persisted scheduler fields and mobile card/testIDs.
    - agent: "main"
      message: |
        Please test the 5 backend tasks and 3 frontend tasks above. Test credentials at
        /app/memory/test_credentials.md. Use test@eventa.pl / test123 for login.
    - agent: "main"
      message: |
        Iteration 17 — Event Checklists (Zadania) Stage 2 implemented.
        Backend (`/app/backend/server.py`): checklist_templates + checklist_items collections.
          - GET/POST/PUT/DELETE /api/checklist-templates (admin only)
          - GET /api/events/{event_id}/checklist (visible to owner + assigned staff; auto-materializes from templates)
          - POST /api/events/{event_id}/checklist/init (admin — re-material only NEW templates)
          - POST /api/events/{event_id}/checklist (admin — add ad-hoc task)
          - PATCH /api/events/{event_id}/checklist/{task_id} (staff can only toggle `done`; admin can edit title/order)
          - DELETE /api/events/{event_id}/checklist/{task_id} (admin)
          - GET /api/staff/my/checklists (upcoming events assigned to staff with progress)
        Frontend:
          - New reusable component /app/frontend/src/components/EventChecklist.tsx
          - New route /app/frontend/app/checklist/[id].tsx (shared per-event checklist view)
          - Rewrote /app/frontend/app/(tabs)/zadania.tsx (staff list of upcoming events + progress bars)
          - New /app/frontend/app/(tabs)/checklist-templates.tsx (admin template management with event-type filters)
          - Added "Zadania imprezy" link inside /app/frontend/app/event/[id].tsx (admin)
          - Added "Szablony zadań (checklisty)" row in Więcej hub
          - Updated (tabs)/_layout.tsx to hide checklist-templates from both admin and staff tab bars
        Verified via curl + browser screenshots:
          - Templates CRUD OK
          - Auto-materialization on first checklist read OK (only matching event_types + null=all)
          - Toggle done stores done_by_name/done_at
          - Progress bar renders correctly in staff view
          - Payroll modal (from previous session) renders correctly on Wypłaty tab
    - agent: "testing"
      message: |
        Iteration 16 — ALL PASSED (11/11 pytest + 4/4 UI checks).
        Weather fallback works (7timer). Alerts scan/dismiss/auto-dismiss verified.
        Public ICS feed serves anon requests; rotate invalidates old tokens.
        Bell icon + badge + modal + colored status dots + gcal card all present with expected testIDs.
        Non-blocking legacy RN warnings only (shadow*, pointerEvents) — not from this iteration.
        Backend priorities:
          1. Weather: hit /api/weather?date={future+5d}&time_start=14:00&time_end=20:00 → expect available=true
             (7Timer fallback works because Open-Meteo is currently rate-limited on the K8s IP).
             Test past date → available=false + past message. Test >15 days ahead → clear message.
          2. Alerts scan: seed an event with created_at 3 days ago and status="rezerwacja" + future date;
             call POST /api/alerts/scan; verify GET /api/alerts returns it; dismiss it (single + all);
             verify auto-dismiss when PUT /api/events/{id} changes status to "potwierdzona".
          3. Calendar feed: /api/calendar/feed-url with auth returns {token, path}; hitting the path
             WITHOUT auth returns text/calendar with BEGIN:VCALENDAR; rotate changes token; old token → 404.
        Frontend priorities:
          1. Bell icon visible in Kalendarz top-right; badge appears when alerts exist.
          2. Modal opens on bell click; alert rows navigate; dismiss works.
          3. Days with mixed statuses show correct dot colors (create 2 events on same day: one
             potwierdzona (green) + one anulowana (red) → two dots visible).
          4. Statystyki → Google Calendar card shows a URL; Copy button copies to clipboard.    - agent: "main"
      message: |
        Iteration 22 — Staff Availability module (Dostępność pracowników).
        Backend (server.py): collection staff_availability; endpoints GET/PUT /api/availability/my[/{date}],
        GET /api/availability/team, GET /api/availability/for-date (admin). POST/PUT /api/events now
        return 400 when a NEWLY assigned staff declared 'unavailable' for the event date (all-day always;
        partial hours only on window overlap; date change re-checks all shifts). Existing assignments are
        never blocked. Backend E2E: /app/backend/tests/test_availability_e2e.py — 22/22 PASSED.
        Frontend: src/components/AvailabilityCalendar.tsx (staff, in Moja praca → toggle "Dostępność",
        testIDs grafik-view-dostepnosc, avail-day-{date}, avail-status-*, avail-save);
        app/dostepnosc-zespolu.tsx (admin, entry Więcej → "Dostępność zespołu", testID wiecej-dostepnosc);
        event/[id].tsx staff picker pills + block Alert + assigned-shift warning; save() error Alert fix;
        shift role/note now persisted.
    - agent: "main"
      message: |
        Iteration 23 — Etap 3 PDF + Etap 2 AI draft replies.
        Backend: new module /app/backend/event_pdfs.py (Liberation Sans for Polish diacritics).
        Endpoints: GET /api/events/{id}/pdf/confirmation (admin), GET /api/events/{id}/pdf/staff-card
        (admin/partner — NO finances/client contact, verified via extracted PDF text);
        POST /api/client-reply-suggestions/{id}/draft-reply (GPT-5.6-Terra draft, persisted as reply_draft);
        POST /api/client-reply-suggestions/{id}/send-reply (SMTP, sets reply_sent_at/to, ai_email_logs).
        Frontend event/[id].tsx: "Dokumenty PDF" section (pdf-confirmation-btn, pdf-staffcard-btn);
        AI reply flow in client-reply suggestion card (sug-reply-generate-{id}, sug-reply-subject/draft/send-{id}).
        Backend E2E: /app/backend/tests/test_pdf_and_reply_e2e.py — 23/23 PASSED (no real emails sent).
        UI smoke-verified via screenshots (PDF section renders, confirmation opens without error).
    - agent: "main"
      message: |
        Iteration 24 — Event card UX reorganization (event/[id].tsx, JSX-only, no logic/endpoint changes).
        New Collapse component + compact summary header (event-compact-summary: category/status pills,
        date/time, people, client/phone, KPIs CENA/DO ZAPŁATY/ZYSK/MARŻA).
        7 collapsible sections in order (testIDs): sec-dane, sec-status, sec-finanse (merged Płatność +
        discount codes + Wpłaty klienta + revenue/costs calculator + profit card with margin),
        sec-pracownicy, sec-organizacja (org + client update + service info + team info + dinner/catering
        moved from Finanse + checklist link), sec-komunikacja (pre-event email + thank-you),
        sec-dodatkowe (weather, notes moved from Informacje, image, PDFs, save-as-template).
        Sections 1-4 defaultOpen. Client reply suggestions stay on top. Staff view untouched.
        Verified via screenshots: all sections render, expand/collapse works, event save OK (no errors).

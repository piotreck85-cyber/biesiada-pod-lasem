# TimeTree → Biesiada 2.0

Integracja dotyczy istniejącej aplikacji Python/FastAPI + MongoDB + Expo, nie osobnej wersji Sites. Korzysta z obecnych kolekcji `events`, `audit_log`, uprawnień właściciela i APScheduler. Nie wysyła wiadomości do klientów ani nie uruchamia automatyzacji biznesowych wskutek importu.

## Stan wykonania

Kod został zmieniony lokalnie. Migracja 005 została wykonana i przetestowana na izolowanym MongoDB 8.0.17. Nie wykonano migracji w bazie produkcyjnej, wdrożenia ani logowania do rzeczywistego TimeTree: potrzebne są dostęp do właściwego hostingu oraz jego secrets. Żadne rzeczywiste dane logowania ani identyfikator kalendarza nie są wpisane w kod lub przykład konfiguracji.

## Konfiguracja — domyślnie istniejący backend

Backend musi działać stale, mieć Python ≥3.10, dostęp HTTPS do TimeTree i możliwość uruchomienia procesu Python. W panelu hostingu ustaw:

| Zmienna | Wartość / znaczenie |
|---|---|
| `TIMETREE_EMAIL` | E-mail konta TimeTree, jako secret |
| `TIMETREE_PASSWORD` | Hasło konta TimeTree, jako secret |
| `TIMETREE_CALENDAR_ID` | Końcowy segment adresu kalendarza po `/calendars/`, jako secret |
| `TIMETREE_OWNER_ID` | Identyfikator właściciela przestrzeni Biesiady; panel integracji pokazuje go, gdy brakuje konfiguracji |
| `TIMETREE_SCHEDULER_ENABLED` | `true` (domyślnie) |
| `TIMETREE_USE_WORKER` | `false` (domyślnie) |

Istniejące `MONGO_URL`, `DB_NAME` i `JWT_SECRET` pozostają w konfiguracji backendu. Nie używaj prefiksu `EXPO_PUBLIC_` dla sekretów. Nie wklejaj hasła do rozmowy ani poleceń terminala. Wzór bez wartości: `backend/.env.example`.

1. Wdróż zmienione pliki do właściwej aplikacji. Patch jest względem aktualnej lokalnej kopii z wcześniejszymi poprawkami, nie względem pustej gałęzi `main` na GitHubie. Przed zastosowaniem w innym checkout sprawdź zgodność kontekstu (`git apply --check biesiada-timetree.patch`).
2. W środowisku backendu zainstaluj `python -m pip install -r requirements.txt`. Pełny backend używa swoich dotychczasowych zależności; TimeTree dodaje `timetree-exporter==0.8.0` i `icalendar==6.3.2`.
3. W katalogu `backend` uruchom `python migrations/005_timetree.py`. Migracja jest powtarzalna, tworzy indeksy, nie usuwa ani nie scala wydarzeń. Uruchamia się także przy starcie backendu. Przy kolizjach UID zatrzymuje integrację z czytelnym błędem; kolizje wymagają osobnego sprawdzenia, nie są automatycznie kasowane.
4. Uruchom ponownie backend i opublikuj zbudowany frontend według istniejącej procedury hostingu.
5. Jako właściciel otwórz **Więcej → Ustawienia → Integracje → TimeTree → Synchronizuj teraz**. Pierwszy poprawny eksport ustawi nazwę kalendarza i status „Połączono”. Scheduler sprawdza kalendarz również około 45 sekund po starcie backendu.

## Sprawdzenie harmonogramu

Panel pokazuje, czy scheduler backendu działa, termin następnego uruchomienia, ostatnią próbę, ostatni sukces i 30 ostatnich przebiegów. Po około godzinie powinien pojawić się nowy wpis oznaczony „Automatyczna”. Jeśli kalendarz się nie zmienił, `Dodano` i `Zaktualizowano` wyniosą 0, a `Bez zmian` odpowiada liczbie unikalnych wydarzeń. Ponownie naciśnij „Synchronizuj teraz”: liczba wydarzeń nie powinna wzrosnąć.

W APScheduler zadanie ma identyfikator `timetree_sync`, interwał 1 godzina, `max_instances=1` i `coalesce=True`. Dodatkowa blokada w MongoDB zapobiega równoczesnemu eksportowi z kilku procesów backendu lub przycisku. Błędy zapisują wyłącznie bezpieczny kod, np. `TimeTree synchronization failed (auth)`, bez odpowiedzi serwera i sekretów.

Sam wpis „scheduler działa” nie zastępuje historii faktycznych przebiegów. Hosting usypiający procesy nie gwarantuje pracy co godzinę — wtedy uruchom stale działający worker.

## Osobny worker — gdy hosting aplikacji nie może uruchamiać eksportera

Worker jest małym procesem Python, bez publicznego endpointu. Łączy się z tą samą bazą MongoDB. Interfejs zleca ręczny przebieg przez kolekcję `timetree_requests`; worker sprawdza ją co 10 sekund i uruchamia również synchronizację co godzinę. Blokada w bazie obejmuje obie ścieżki.

Na backendzie ustaw `TIMETREE_USE_WORKER=true`, `TIMETREE_SCHEDULER_ENABLED=false`, `TIMETREE_OWNER_ID` i `TIMETREE_CALENDAR_ID`. Backend nie potrzebuje wtedy `TIMETREE_EMAIL` ani `TIMETREE_PASSWORD` i nie uruchamia eksportera. Na workerze ustaw jako secrets `MONGO_URL`, `DB_NAME`, `TIMETREE_OWNER_ID`, `TIMETREE_CALENDAR_ID`, `TIMETREE_EMAIL` i `TIMETREE_PASSWORD`.

Przygotowany obraz buduje się z katalogu `backend` poleceniem `docker build -f Dockerfile.timetree -t biesiada-timetree .`. Plik `Dockerfile.timetree.dockerignore` dopuszcza tylko kod i listę zależności, bez `.env`, eksportów i kopii bazy. Hosting powinien uruchamiać kontener stale i restartować go po błędzie. Domyślne polecenie to `python timetree_worker.py`.

Bez Dockera: zainstaluj `python -m pip install -r requirements-timetree.txt`, a następnie uruchom `python timetree_worker.py` pod menedżerem procesów. `python timetree_worker.py --once` wykonuje pojedynczy przebieg i zwraca kod 0 przy sukcesie lub 1 przy błędzie. Może być wywoływany przez zewnętrzny cron co godzinę, ale obsługa kolejki przycisku wymaga stale działającego workera, nie samego crona.

Panel pokazuje sygnał działania workera, stan oczekującego zlecenia i historię wykonania. Oba serwisy muszą wskazywać tę samą bazę i przestrzeń właściciela.

## Reguły zapisu

- Indeks unikalny `(owner_id, external_source, external_id)` chroni UID TimeTree. Dodatkowy unikalny `(owner_id, imported_uid)` zabezpiecza współpracę ze starym importerem ICS. Zakres to przestrzeń właściciela; ten sam UID w cudzej przestrzeni jest niezależny.
- Starsze rekordy z `imported_uid` są przypinane do tego samego wydarzenia. Przy pierwszym powiązaniu zachowywane są ich dane widoczne w Biesiadzie. Rozbieżności stają się ręcznymi polami. Nie wiążemy wydarzeń automatycznie po podobnej nazwie lub dacie.
- `timetree_source` zawiera ostatnie wartości źródłowe: nazwę, datę, początek/koniec, datę zakończenia, opis, lokalizację i flagę całodniową. `timetree_manual_fields` określa pola poprawione ręcznie. Widoczna wartość ręczna pozostaje chroniona także po kolejnych zmianach źródła. Porównanie obu wartości znajduje się na karcie wydarzenia.
- Zapis z formularza korzysta z numeru rewizji: formularz otwarty przed zmianą wydarzenia otrzymuje konflikt 409 zamiast bezgłośnego nadpisania nowej wersji. Inne ścieżki edycji również są chronione przez porównanie bieżących pól ze źródłem przy synchronizacji.
- Synchronizacja używa wyłącznie punktowych `$set` pól kalendarza i metadanych. Nie zastępuje całych dokumentów i nie rusza klienta, cen, zaliczek, kosztów, zespołu, menu, kategorii, automatyzacji ani checklist.
- `external_last_modified` zapisuje `LAST-MODIFIED`, jeśli istnieje. Zmienny przy każdym eksporcie `DTSTAMP` nie powoduje aktualizacji.
- Przy identycznej zawartości nie ma zapisu dokumentu wydarzenia ani nowego audytu. `last_synced_at` to moment ostatniego zapisu synchronizacji tego wydarzenia; aktualność ostatniego sprawdzenia kalendarza wskazuje globalny `last_success_at`. Dzięki temu sam upływ godziny nie pozoruje zmiany wydarzenia.
- Brak w kompletnym eksporcie ustawia `missing_in_timetree=true` i informację „To wydarzenie nie występuje już w TimeTree”. Nic nie jest usuwane. Powrót UID usuwa oznaczenie i trafia do historii. Zmiana skonfigurowanego kalendarza nie oznacza wydarzeń starego kalendarza jako brakujących.
- Zapis wydarzenia i oczekujący wpis historii są atomowym zapisem jednego dokumentu. Mechanizm outbox przenosi historię do istniejącego `audit_log` z unikalnym ID; ponowienie po awarii nie powiela audytu. Aktor automatycznych zmian: `system / TimeTree`.

## Eksport i obsługa błędów

Adapter korzysta z mechanizmu pakietu [eoleedi/TimeTree-Exporter](https://github.com/eoleedi/TimeTree-Exporter): logowania, stronicowania oraz formattera ICS. Wybiera wyłącznie wskazany kalendarz, pobiera wszystkie strony od `since=0`, sprawdza odpowiedź HTTP każdej strony i oznacza pełny eksport dopiero po jego ukończeniu. Nie uruchamia interaktywnego wyboru innego kalendarza, nie pobiera osobno komentarzy i nie używa trybu publicznego bez stabilnych UUID.

Proces eksportera ma limit 180 sekund, prywatny tymczasowy katalog, zamknięte wejście oraz odrzucone stdout/stderr. Dane logowania trafiają do niego przez ograniczony zestaw zmiennych środowiskowych, nigdy przez argumenty. Plik ICS jest kasowany po odczycie. Nie zapisujemy danych debugowych upstream.

Przed zmianą wydarzeń walidowany jest cały ICS i sprawdzane są niejednoznaczne UID. Błąd logowania, sieci, niepełny eksport lub nieprawidłowy rekord nie zmienia żadnych wydarzeń. Zapisywane są tylko status i historia nieudanej próby. Przy awarii bazy już w czasie zapisu przebieg może być częściowy: istniejące poprawne zapisy pozostają, a ponowienie nie tworzy duplikatów; nie wykonujemy wtedy fazy oznaczania brakujących rekordów. Rozwiązanie działa także na MongoDB standalone, bez wymogu transakcji wielodokumentowych.

Limit eksportu: 10 MiB i 20 000 komponentów VEVENT. Przekroczenie limitu kończy próbę błędem, nigdy cichym obcięciem. Daty czasowe przeliczane są do Europe/Warsaw z uwzględnieniem czasu letniego; dni całodniowe zachowują daty oraz wyłączną datę końcową ICS.

Reguły cykliczności są zachowywane w `timetree_recurrence`. Jedna seria o jednym UID ma jedną kartę z terminem bazowym, bez rozwijania nieskończonej liczby wystąpień. Niejednoznaczne komponenty o tym samym UID, ale różnej treści, zatrzymują próbę zamiast gubienia danych. Urodziny i notatki bez terminu pomijane przez sam `timetree-exporter` nie są wydarzeniami w jego ICS. Nie wykonano testu rzeczywistego kalendarza, więc zgodność jego konkretnych danych zostanie potwierdzona podczas pierwszego uruchomienia na hostingu.

## Testy

Z katalogu `backend`: `python -m pip install -r requirements-test-timetree.txt`, następnie `python -m pytest tests/test_timetree_sync.py tests/test_timetree_export.py tests/test_activity_log.py`.

Bez konfiguracji testy używają mocka MongoDB. `TIMETREE_TEST_MONGO_URL` pozwala testować na osobnym testowym MongoDB. Każdy test tworzy unikalną bazę `timetree_test_*` i usuwa ją po zakończeniu; nie wskazuj produkcyjnego serwera do testów.

Sprawdzono: powtarzalność importu, indeksy MongoDB, równoczesne uruchomienia, ręczne dane i stare UID, brakujące/powracające wydarzenia, strefy czasowe i całodniowość, `LAST-MODIFIED` kontra `DTSTAMP`, wadliwe ICS, błąd drugiej strony eksportu, właściwy wybór kalendarza, odzyskiwanie historii, uprawnienia właściciela, brak sekretów w odpowiedziach/logach/argumentach, kolejkę workera oraz dotychczasową aktywność zespołu.

Build web Expo przechodzi. TypeScript: 19 istniejących błędów poza integracją, tyle samo przed i po zmianie; 0 nowych diagnostyk. Nie przebudowywano niezwiązanych ekranów.

## Zmienione pliki

Istniejące: `.gitignore`, `backend/requirements.txt`, `backend/server.py`, `frontend/src/api.ts`, `frontend/app/(tabs)/wiecej.tsx`, `frontend/app/event/[id].tsx`, `frontend/src/components/EventAuditList.tsx`.

Nowe: `backend/timetree_sync.py`, `backend/timetree_export.py`, `backend/timetree_api.py`, `backend/timetree_worker.py`, `backend/migrations/005_timetree.py`, `backend/.env.example`, `backend/requirements-timetree.txt`, `backend/requirements-test-timetree.txt`, `backend/Dockerfile.timetree`, `backend/Dockerfile.timetree.dockerignore`, `backend/tests/test_timetree_sync.py`, `backend/tests/test_timetree_export.py`, `frontend/app/ustawienia/integracje/index.tsx`, `frontend/app/ustawienia/integracje/timetree.tsx`, `frontend/src/components/TimeTreeEventInfo.tsx`, `docs/timetree.md`.

Pozostałe wcześniejsze lokalne zmiany użytkownika zachowano. Nie commitowano ani nie wysyłano sekretów lub prywatnego kalendarza do GitHuba.

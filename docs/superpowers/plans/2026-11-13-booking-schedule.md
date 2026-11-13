# Booking and team schedule — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Requests from the website and from instructors go into one schedule.
- The head of the stable confirms them and assigns instructors and horses.
- The website shows only time that is actually free.

**Architecture:**
- A new Supabase project holds the data. All logic lives in Postgres functions (`security definer`).
- RLS is on for every table, and there are no policies, so the anon key cannot read the tables.
- The website and the team page are static on GitHub Pages. They call the functions over PostgREST RPC with plain `fetch`, no libraries.
- Team access is a personal key in the link.

**Tech stack:**
- Supabase: Postgres 15+, pgcrypto, pgTAP for tests.
- Vanilla JS (ES2020) and HTML/CSS.
- `node --test` for pure JS functions.

**Spec:** `docs/superpowers/specs/2026-11-13-booking-schedule-design.md`

## Global Constraints

- Time zone: Europe/Moscow. Store days as `date` and times as `time`. "Now" is `now() at time zone 'Europe/Moscow'`.
- Routes (from `js/booking.js` CONFIG):
  - `short`: 60 min, slots 09:00, 10:30, 12:00, 13:30, 15:00, 16:30;
  - `trails`: 120 min, slots 09:00, 11:30, 14:00;
  - `long`: 420 min, slot 08:00.
- One instructor leads up to **5** riders. A group can be split across several instructors.
- Booking closes **2 hours** before departure. The website books up to **60 days** ahead. A group is 1 to 10 people.
- Statuses: `pending` («ждёт»), `confirmed` («подтверждено»), `rejected` («отклонено»).
  - `pending` and `confirmed` take capacity; `rejected` does not.
  - `pending` never expires on its own.
- Only the head may confirm, reject or move a request, manage days off, and issue links.
- Guest phone numbers are visible only to the head and to the instructor assigned to that ride.
- Keys are stored as `encode(digest(key,'sha256'),'hex')`. A raw key is 32 random bytes in hex. The team page takes the key from `#k=…`, saves it to `localStorage` under `kt_key`, and removes the hash from the address bar.
- The anon role may execute only the `free_slots`, `create_request` and `team_*` / `head_*` functions. It is not granted direct access to any table.
- All interface text is in Russian, in the voice of the site. Phone: +7 964 001-44-58, `wa.me/79640014458`.
- Do not use the old connected Supabase project (`ysgtxwvlxdjwesswdgvz`). It belongs to another site.

## Review Focus

1. **Two guests book the last spot at the same moment.** Expected: only one request is created; the second gets «Это время только что заняли».
   - Test: `create_request` takes `pg_advisory_xact_lock` on the day.
   - The pgTAP test in Task 3 checks that a second request fails once the slot is full.
2. **Long route against short ones.** A 08:00 `long` booking takes the instructor until 15:00. Expected: that instructor is not counted free at 10:30 or 13:30. Test in Task 2.
3. **Old link after a new one is issued.** Expected: the old key gets `forbidden`. Test in Task 5.
4. **The database is unreachable or slow** (more than 4 s). Expected: the website form still lets the guest send a request in WhatsApp using the slots from CONFIG. Node test of `withTimeout` in Task 6, browser check in Task 7.
5. **Today's slot is less than 2 hours away**, or the date is in the past. Expected: the slot is not offered and cannot be created. Test in Task 3.

---

### Task 1: Supabase project, schema, seed data

**Files:**
- Create: `supabase/migrations/001_schema.sql`, `supabase/tests/001_schema.test.sql`, `supabase/README.md`, `js/config.js`
- Modify: `.gitignore` (add `supabase/.temp/`)

**Interfaces:**
- Produces tables:
  - `instructors(id uuid pk default gen_random_uuid(), name text not null, phone text, active bool default true, sort int)`;
  - `horses(id uuid pk, name text not null, active bool default true, sort int)`;
  - `routes(key text pk, name text, duration_min int, slots time[])`;
  - `instructor_days_off(instructor_id uuid fk, day date, pk(instructor_id, day))`;
  - `horse_rest_days(horse_id uuid fk, day date, pk(horse_id, day))`;
  - `requests(id uuid pk, route_key text fk, day date, start_time time, people int check 1..10, guest_name text, guest_phone text, experience text, source text check in ('site','instructor'), created_by uuid null fk instructors, status text default 'pending' check in ('pending','confirmed','rejected'), horses_count int null, created_at timestamptz default now())`;
  - `request_instructors(request_id uuid fk on delete cascade, instructor_id uuid fk, pk(both))`;
  - `access_keys(id uuid pk, role text check in ('head','instructor'), instructor_id uuid null, key_hash text unique, created_at, revoked_at timestamptz null)`.
- Produces `js/config.js`, which defines `window.KT_SUPABASE = { url: '<project url>', key: '<publishable key>' }`.

- [ ] **Step 1: Connect the new project.**
  - Ask the user for the URL and publishable key of the new project, or to reconnect the Supabase MCP to it.
  - Check that `list_tables` shows a different project from `ysgtxwvlxdjwesswdgvz`.
- [ ] **Step 2: Write `supabase/tests/001_schema.test.sql` in pgTAP.** Assertions:
  - `has_table` for every table above;
  - `select count(*) from routes` = 3, and `duration_min` = 60/120/420;
  - 4 instructors «Инструктор 1…4» and 10 horses «Лошадь 1…10» from the seed;
  - `set local role anon; select throws_ok('select * from requests', '42501')` (no access).
- [ ] **Step 3:** run the test (see «Running SQL tests» below). Expected: fails because the tables do not exist.
- [ ] **Step 4: Write `001_schema.sql`.**
  - `create extension if not exists pgcrypto` and `pgtap`;
  - the tables;
  - `alter table … enable row level security` on all of them, with no policies;
  - `revoke all on all tables in schema public from anon, authenticated`;
  - seed for routes, instructors and horses.

  Apply it with `apply_migration`.
- [ ] **Step 5:** run the test. Expected: PASS.
- [ ] **Step 6:** write `supabase/README.md`: how to apply migrations and run the tests. Write `js/config.js`; the publishable key is public, so it may go into the repo.
- [ ] **Step 7:** commit: `git add supabase js/config.js .gitignore && git commit -m "Расписание: схема базы и начальные данные"`

**Running SQL tests** (all tasks): send the whole contents of the `.test.sql` file to `execute_sql` wrapped as `begin; select plan(N); … select * from finish(); rollback;`. Test data does not stay in the database. A test passes when every output line starts with `ok`.

### Task 2: Counting slot load

**Files:**
- Create: `supabase/migrations/002_capacity.sql`, `supabase/tests/002_capacity.test.sql`

**Interfaces:**
- Produces `slot_capacity(p_route text, p_day date, p_start time, p_ignore uuid default null) returns table(free_instructors int, free_horses int, spots int)`. It is internal and not granted to anon.
  - `p_ignore` excludes one request from the count; used when confirming or moving it.
  - Overlap: `[start, start + duration)` of the other request intersects `[p_start, p_start + duration of p_route)`.
  - **Working instructors:** `active` and not on a day off on `p_day`.
  - **Busy instructors:** from `confirmed` overlapping requests, distinct, through `request_instructors`. On top of that, `pending` overlapping requests reserve `ceil(people/5)` instructors each.
  - `free_instructors = working − busy − pending reserve`, not below 0.
  - `free_horses = active horses not resting − sum(coalesce(horses_count, people))` over overlapping non-`rejected` requests, not below 0.
  - `spots = least(free_instructors*5, free_horses)`.

- [ ] **Step 1: Write the tests.** Data is created inside the test. Day `2030-06-01` (a Saturday), no days off:
  - `capacity_empty`: `short` 10:30 → `free_instructors=4, free_horses=10, spots=10`.
  - `pending_reserves`: a pending `short` 10:30 for 7 people → at 10:30 `free_instructors=2, free_horses=3, spots=3`.
  - `long_blocks_day`: a confirmed `long` 08:00 for 3 people with instructor 1 → at `short` 13:30 `free_instructors=3, free_horses=7`; at `short` 16:30 (after 15:00) `free_instructors=4`.
  - `day_off_and_rest`: instructors 1 and 2 on a day off, 4 horses resting → `free_instructors=2, free_horses=6, spots=6`.
  - `rejected_ignored`: a rejected request for 10 people → `spots=10`.
  - `ignore_param`: `p_ignore` equal to the pending request's id gives the same numbers as `capacity_empty`.
- [ ] **Step 2:** run. Expected: FAIL (the function is missing).
- [ ] **Step 3:** implement `slot_capacity` in `002_capacity.sql` (`language sql stable`) and apply it.
- [ ] **Step 4:** run. Expected: PASS.
- [ ] **Step 5:** commit: `Расписание: подсчёт свободных инструкторов и лошадей`

### Task 3: Public functions for the website

**Files:**
- Create: `supabase/migrations/003_public_api.sql`, `supabase/tests/003_public_api.test.sql`

**Interfaces:**
- Consumes: `slot_capacity` (Task 2).
- Produces:
  - `free_slots(p_route text, p_from date, p_to date, p_people int) returns table(day date, start_time time, spots int)`.
    - Returns only slots with `spots >= p_people`.
    - `p_to` is capped at today + 60.
    - Returns nothing for slots less than 2 h from now (Moscow).
  - `create_request(p_route text, p_day date, p_start time, p_people int, p_name text, p_phone text, p_experience text, p_hp text) returns uuid`.
    - `source='site'`, `status='pending'`.
    - Errors (`raise exception using errcode='P0001', message=…`), with this exact text:
      - `'Это время только что заняли'`: no spots, or the start time is not in `routes.slots`;
      - `'Запись на это время уже закрыта'`: less than 2 h left, a past date, or more than 60 days ahead;
      - `'Проверьте имя и телефон'`: empty name, name longer than 80 characters, or fewer than 10 or more than 15 digits in the phone number;
      - `'Слишком много заявок с этого номера, позвоните нам'`: 3 or more requests from the same digits today;
      - `p_hp` not empty (honeypot): return a random uuid **without** writing anything.
    - At the start: `perform pg_advisory_xact_lock(hashtext('kt'||p_day))`.
- Both functions are `security definer set search_path = public`, with `grant execute … to anon`.

- [ ] **Step 1: Write the tests** (day `2030-06-01`):
  - `free_slots_full_day`: `('short','2030-06-01','2030-06-01',1)` returns 6 rows with `spots=10`.
  - `free_slots_people_filter`: after a pending request for 7 people at 10:30, the call with `p_people=4` has no 10:30.
  - `create_ok`: `create_request` returns a uuid; the row has `status='pending'` and `source='site'`.
  - `create_full`: a second request for 4 people at the same 10:30 → `throws_ok(…, 'P0001', 'Это время только что заняли')`.
  - `create_past`: `current_date - 1` → `'Запись на это время уже закрыта'`.
  - `create_bad_slot`: 10:00 for `short` → `'Это время только что заняли'`.
  - `create_bad_phone`: phone `'123'` → `'Проверьте имя и телефон'`.
  - `create_rate_limit`: the 4th request from one number on one day → the rate-limit message.
  - `honeypot`: `p_hp='x'` → returns a uuid, and the count of `requests` does not change.
  - `anon_can_call`: `set local role anon` and `free_slots` runs without errors.
- [ ] **Step 2:** run. Expected: FAIL.
- [ ] **Step 3:** implement both functions and apply them.
- [ ] **Step 4:** run. Expected: PASS.
- [ ] **Step 5:** commit: `Расписание: свободное время и заявки с сайта`

### Task 4: Team keys and team functions

**Files:**
- Create: `supabase/migrations/004_team_api.sql`, `supabase/tests/004_team_api.test.sql`

**Interfaces:**
- Consumes: `create_request` logic (Task 3). Move the validation into an internal `_insert_request(…, p_source text, p_created_by uuid)` that both public functions call.
- Produces:
  - `_auth(p_key text) returns access_keys`: an active key by hash, otherwise `raise 'forbidden'` (errcode `42501`). Not granted to anon.
  - `team_whoami(p_key text) returns json`: `{role, instructor_id, name}`.
  - `team_day(p_key text, p_day date) returns json` with:
    - `requests`: `[{id, route_key, start_time, people, status, guest_name, guest_phone|null, experience, instructors:[{id,name}], horses_count, source}]`;
    - `instructors`: `[{id,name,day_off:bool}]`;
    - `horses`: `{total, resting}`.

    `guest_phone` is filled only for the head or for an instructor assigned to that request.
  - `team_create_request(p_key text, p_route text, p_day date, p_start time, p_people int, p_name text, p_phone text, p_experience text) returns uuid`: `source='instructor'`, `created_by` = the key's instructor, `status='pending'`.
  - `team_request(p_key text, p_id uuid) returns json`: one request in the same shape as in `team_day`.

- [ ] **Step 1: Write the tests.** Create a head key and an instructor key for instructor 1 with known raw values `'head-test'` and `'i1-test'`:
  - `whoami_head` → `role='head'`;
  - `whoami_bad` → throws `42501`;
  - `whoami_revoked`: after `update access_keys set revoked_at=now()` → `42501`;
  - `day_masks_phone`: a confirmed request with instructor 2 → for `'i1-test'` `guest_phone` is null, for `'head-test'` it is filled in;
  - `day_own_phone`: a request with instructor 1 → for `'i1-test'` `guest_phone` is filled in;
  - `instructor_create`: `team_create_request` → `source='instructor'`, `created_by` = instructor 1, `status='pending'`.
- [ ] **Step 2:** run. Expected: FAIL.
- [ ] **Step 3:** implement and apply. Revoke execute on `_auth` and `_insert_request` from anon and authenticated.
- [ ] **Step 4:** run. Expected: PASS, and the Task 3 tests still PASS.
- [ ] **Step 5:** commit: `Расписание: ключи команды и просмотр дня`

### Task 5: The head's actions

**Files:**
- Create: `supabase/migrations/005_head_api.sql`, `supabase/tests/005_head_api.test.sql`

**Interfaces:**
- Consumes: `_auth`, `slot_capacity` (with `p_ignore`).
- Produces (each calls `_auth` and requires `role='head'`, otherwise errcode `42501` with message `'Только главный может это сделать'`):
  - `head_confirm(p_key, p_id uuid, p_instructors uuid[], p_horses int) returns void`. Checks:
    - every instructor works that day and is free over the overlap (`p_ignore=p_id`);
    - `array_length*5 >= people`;
    - `p_horses` is between `people` and `free_horses`.

    Writes `request_instructors`, `horses_count`, `status='confirmed'`. On error: `'Не хватает свободных инструкторов или лошадей'`.
  - `head_reject(p_key, p_id) returns void`.
  - `head_move(p_key, p_id, p_day date, p_start time) returns void`: checks `spots >= people` with `p_ignore`; keeps the status; for a confirmed request, re-checks the assigned instructors and drops the confirmation to `pending` if they are busy.
  - `head_set_day_off(p_key, p_kind text /* 'instructor'|'horse' */, p_id uuid, p_day date, p_off bool) returns void`.
  - `head_save_instructor(p_key, p_id uuid /* null = new */, p_name text, p_phone text, p_active bool) returns uuid` and `head_save_horse(p_key, p_id uuid, p_name text, p_active bool) returns uuid`.
  - `head_issue_key(p_key, p_role text, p_instructor uuid) returns text`: revokes previous active keys of the same instructor (or of the head role) and returns the new raw key.
  - `head_team(p_key, p_from date, p_to date) returns json`: `{instructors:[{id,name,phone,active,days_off:[date]}], horses:[{id,name,active,rest_days:[date]}]}`.

- [ ] **Step 1: Write the tests:**
  - `instructor_cannot_confirm`: `'i1-test'` → `42501`;
  - `confirm_ok`: a pending 7 people, instructors 1 and 2, horses 7 → `confirmed`;
  - `confirm_too_few_instructors`: 7 people, one instructor → `'Не хватает свободных инструкторов или лошадей'`;
  - `confirm_busy_instructor`: instructor 1 on a confirmed `long` 08:00 → confirming it at `short` 10:30 fails;
  - `move_ok`: moving to 13:30 → `start_time` changed;
  - `issue_revokes_old`: `head_issue_key('head-test','instructor', i1)` → `team_whoami('i1-test')` throws `42501`, and the new key works;
  - `day_off_affects_capacity`: `head_set_day_off(…,'instructor',i3,day,true)` → `slot_capacity` gives one fewer free instructor.
- [ ] **Step 2:** run. Expected: FAIL.
- [ ] **Step 3:** implement and apply.
- [ ] **Step 4:** run all 5 test files. Expected: PASS.
- [ ] **Step 5:** commit: `Расписание: подтверждение, перенос, выходные, ссылки`

### Task 6: JS client and pure helpers

**Files:**
- Create: `js/api.js`, `js/slots.js`, `tests/slots.test.mjs`, `tests/api.test.mjs`

**Interfaces:**
- Consumes: `window.KT_SUPABASE` (Task 1); the RPC names from Tasks 3–5.
- Produces:
  - `js/api.js` (also works as an ES module through `export`, and in the browser as `window.KTApi`):
    - `rpc(name: string, args: object, {timeout=4000}={}) → Promise<any>`: POST `${url}/rest/v1/rpc/${name}` with headers `apikey`, `Authorization: Bearer <key>`, `Content-Type: application/json`. Any non-2xx response throws `ApiError(message from body.message, code from body.code)`.
    - `withTimeout(promise, ms) → Promise`: rejects with `ApiError('timeout','timeout')`.
  - `js/slots.js` (`window.KTSlots` plus `export`):
    - `byDay(rows: {day,start_time,spots}[]) → Map<'YYYY-MM-DD', {time:'HH:MM', spots:number}[]>`, with times sorted;
    - `waRequestText({routeName, when, people, exp, name, phone, link}) → string`: the existing text from `booking.js` plus the line `Заявка: <link>` when `link` is set;
    - `waConfirmText({name, routeName, when, instructors:string[], people}) → string`: «Здравствуйте, {name}! Ждём вас {when} на прогулку «{routeName}», вас будет {people}. Инструктор: {instructors}. Как добраться: <адрес — уточним>.»;
    - `waRejectText({name, when}) → string`;
    - `waMoveText({name, when}) → string`.

- [ ] **Step 1: Write the tests** with `node:test`:
  - `byDay`: three rows across two days → a Map of 2 keys, times `'09:00'` before `'10:30'`, seconds dropped from `'09:00:00'`;
  - `waRequestText` with a link contains `'Заявка: https://'`, and without a link has no such line;
  - `waConfirmText` contains the name, the instructor names joined with «, », and the date;
  - `withTimeout`: a promise that never resolves, `ms=10` → rejects with `.code==='timeout'`;
  - `rpc` with a `fetch` stub returning 400 `{message:'Это время только что заняли',code:'P0001'}` → `ApiError` with the same message.
- [ ] **Step 2:** `node --test tests/`. Expected: FAIL.
- [ ] **Step 3:** implement both files. The `fetch` stub is passed in through `globalThis.fetch`.
- [ ] **Step 4:** `node --test tests/`. Expected: PASS.
- [ ] **Step 5:** commit: `Расписание: клиент API и тексты сообщений`

### Task 7: The website form takes time from the database

**Files:**
- Modify: `js/booking.js` (in `renderCal`, `renderSlots`, `submit`), `index.html`, `v2-masti.html`, `v2-club.html`, `v2-afisha.html` (via `scripts/build_v2.py`: add `<script src="js/config.js">`, `js/api.js`, `js/slots.js` before `js/booking.js`).

**Interfaces:**
- Consumes: `KTApi.rpc`, `KTSlots.byDay`, `KTSlots.waRequestText`.
- Behaviour:
  - When the route, month or number of people changes, call `free_slots(route, first day of the month or today, last day of the month, people)` and cache the result per route+month+people.
  - A day is active if it has at least one slot. A slot button shows the time; if `spots < 10`, it also shows «осталось мест: N».
  - On submit:
    1. call `create_request`;
    2. on success, open WhatsApp with the text and `link = <site>/team.html#r=<id>`;
    3. on `ApiError` with a message, show it in `#form-error` and reload the slots;
    4. on timeout or network failure, use the old path: WhatsApp without a link.
  - If `KTApi` is not configured or the first `free_slots` fails, `booking.js` uses CONFIG as before.

- [ ] **Step 1: Browser check before the change.** In `index.html`, every slot from CONFIG is clickable.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Browser check** (local server `python3 -m http.server 8765`):
  - Create a pending request for 9 people on a date in the test month (through SQL) → on that date at that time the slot is gone (only 1 spot left) when people=2, and it is shown with «осталось мест: 1» when people=1.
  - Submit the form → a row appears in `requests` with `source='site'`, and WhatsApp opens with the line `Заявка:`. Check by intercepting `window.open`; do not send the WhatsApp message.
  - Set `KT_SUPABASE.url` to a dead address → the form shows the CONFIG slots and opens WhatsApp without a link.
- [ ] **Step 4:** rebuild the variants: `python3 scripts/build_v2.py`. Repeat the second check in `v2-masti.html`.
- [ ] **Step 5:** delete the test rows (`delete from requests where guest_name like 'ТЕСТ%'`), then commit: `Сайт: запись по свободному времени из расписания`

### Task 8: Team page — the head's screens

**Files:**
- Create: `team.html`, `js/team.js`, `css/team.css`

**Interfaces:**
- Consumes: `KTApi.rpc`, `KTSlots.wa*Text`, the functions from Tasks 4–5.
- Behaviour:
  - **Start:** `#k=` → `localStorage.kt_key`, then `history.replaceState` to clear the hash. No key → the screen «Попросите у главного личную ссылку». `team_whoami` fails → «Ссылка больше не работает, попросите новую у главного».
  - **«Расписание»** (head):
    - day navigation (yesterday / today / tomorrow, plus a date picker);
    - a «Новые заявки» block (all `pending` from today forward; `team_day` for 14 days is enough);
    - a grid of slots: rows by the union of the routes' times, columns by instructors; days off greyed out;
    - pending shown in yellow, confirmed in green;
    - a line «Лошади: свободно X из Y, отдыхают: …».
  - **Request sheet** (a bottom sheet, opens on tap and from `#r=<id>`):
    - the guest's details and a `tel:` link;
    - instructor checkboxes, free ones first; busy ones disabled with the label «занят»;
    - a horses number input, defaulting to `people`;
    - the buttons «Подтвердить», «Отклонить», «Перенести» (date + time from the route);
    - after an action, «Сообщить гостю» → `wa.me/<guest digits>?text=<waConfirmText|waRejectText|waMoveText>`.
  - **«Команда и лошади»:**
    - instructors and horses lists with editable names, «+ добавить», and «не работает» (active=false);
    - a 30-day calendar for each, where a tap toggles the day off or rest day;
    - **«Выдать ссылку»** → shows `<site>/team.html#k=<key>` and the button «Отправить в WhatsApp» (`wa.me/<instructor phone>?text=Ваша ссылка на расписание: …`), with the warning «Старая ссылка перестанет работать».
  - **Visuals:** tokens from `css/ride.css` (`--paper`, `--ink`, `--accent`, Golos Text). Touch targets at least 44 px. Works at 360 px width.

- [ ] **Step 1:** create a head key through SQL (`head_issue_key` cannot be used before the first key exists, so insert the first hash directly). Save the raw key to `private/head-link.txt`; do not paste it into chat.
- [ ] **Step 2:** implement the screens.
- [ ] **Step 3: Browser check at 390 px width:**
  - the head link opens «Расписание» and the hash disappears from the address bar;
  - a test request shows in «Новые заявки»;
  - confirm it with 2 instructors → it turns green; «Сообщить гостю» builds a wa.me link with the text (check `href`, do not send);
  - an instructor's day off → that instructor's column goes grey;
  - «Выдать ссылку» returns a new key, and the previous instructor key stops working.
- [ ] **Step 4:** commit: `Расписание: экраны главного`

### Task 9: Team page — the instructor and the home-screen icon

**Files:**
- Modify: `team.html`, `js/team.js`, `css/team.css`
- Create: `team.webmanifest`, `media/team-icon-192.png`, `media/team-icon-512.png`, `media/team-icon-180.png`

**Interfaces:**
- Consumes: `team_day`, `team_create_request`, `free_slots`.
- Behaviour:
  - **Instructor:**
    - «Мои выезды»: the next 14 days, only the requests where they are assigned, with the guest's phone;
    - the shared «Расписание» is read-only: no action buttons, phones hidden;
    - **«Записать гостя»** uses the same form as the site: route, day, time from `free_slots`, people, name, phone, experience → `team_create_request` → «Заявка отправлена главному».
  - **Badge on the icon (head):** `navigator.setAppBadge(number of pending)` where supported; `clearAppBadge()` when there are none.
  - **Icon:** an amber square `#E59A2F` with the ink horse symbol from `index.html`. Render it from SVG with `rsvg-convert`, or failing that with Chrome headless at 512/192/180.
  - **Manifest:** `name` «Konniy Tour — расписание», `start_url` `team.html`, `display` standalone, `theme_color` `#DCE3D8`. Add `apple-touch-icon` to `team.html`.

- [ ] **Step 1:** implement.
- [ ] **Step 2: Browser check.**
  - With an instructor link: the «Подтвердить» button is absent; another instructor's guest phone is hidden.
  - «Записать гостя» → the request appears with the head in «Новые заявки».
  - The manifest loads without errors in DevTools Application.
- [ ] **Step 3:** commit: `Расписание: экраны инструктора и значок`

### Task 10: Launch and handover

**Files:**
- Create: `docs/team-guide.md` (instructions for the head: how to send links, confirm, mark days off)
- Modify: `index.html`, `scripts/build_v2.py` (no visible link to `team.html` for guests; the page is reached only by a personal link)

- [ ] **Step 1:** run all SQL tests and `node --test tests/`. Expected: PASS.
- [ ] **Step 2:** delete the test data. Confirm with `select count(*) from requests` = 0.
- [ ] **Step 3:** `git push`. Wait for Pages to build. On `https://ibn-arif.github.io/konniy-tour/`, the form shows slots from the database: check in `Network` that the request goes to `rest/v1/rpc/free_slots`.
- [ ] **Step 4:** send the user the head link from `private/head-link.txt` (it is personal, so in chat only on request; by default say where the file is) and a short `docs/team-guide.md`.
- [ ] **Step 5:** commit and push the guide: `Расписание: инструкция для главного`

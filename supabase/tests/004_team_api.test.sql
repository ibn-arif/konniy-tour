-- Team keys: _auth, team_whoami, team_day, team_requests, team_request, team_create_request.
begin;
set local search_path = public, extensions;
set local timezone = 'Europe/Moscow';
create temp table _r(id serial, t text) on commit drop;
grant all on _r to anon; grant all on sequence _r_id_seq to anon;
create temp table _ids(k text primary key, id uuid) on commit drop;
grant all on _ids to anon;
insert into _r(t) select plan(15);

insert into _ids select 'i1', id from instructors where name = 'Инструктор 1';
insert into _ids select 'i2', id from instructors where name = 'Инструктор 2';
insert into access_keys(role, instructor_id, key_hash) values
  ('head', null, encode(digest('head-test', 'sha256'), 'hex')),
  ('instructor', (select id from _ids where k = 'i1'), encode(digest('i1-test', 'sha256'), 'hex')),
  ('instructor', (select id from _ids where k = 'i2'), encode(digest('i2-test', 'sha256'), 'hex'));

insert into _r(t) select is(team_whoami('head-test')->>'role', 'head', 'whoami_head');
insert into _r(t) select is(team_whoami('i1-test')->>'name', 'Инструктор 1', 'whoami_instructor name');
insert into _r(t) select throws_ok($$select team_whoami('nope')$$, '42501', 'forbidden', 'whoami_bad');
update access_keys set revoked_at = now() where key_hash = encode(digest('i2-test', 'sha256'), 'hex');
insert into _r(t) select throws_ok($$select team_whoami('i2-test')$$, '42501', 'forbidden', 'whoami_revoked');

-- a confirmed ride with instructor 2 and one with instructor 1
with q as (insert into requests(route_key, day, start_time, people, guest_name, guest_phone, source, status)
  values ('short', current_date + 10, '09:00', 2, 'ТЕСТ Два', '79990000012', 'site', 'confirmed') returning id)
insert into _ids select 'r2', id from q;
insert into request_instructors values ((select id from _ids where k = 'r2'), (select id from _ids where k = 'i2'));
with q as (insert into requests(route_key, day, start_time, people, guest_name, guest_phone, source, status)
  values ('short', current_date + 10, '12:00', 3, 'ТЕСТ Один', '79990000011', 'site', 'confirmed') returning id)
insert into _ids select 'r1', id from q;
insert into request_instructors values ((select id from _ids where k = 'r1'), (select id from _ids where k = 'i1'));

insert into _r(t) select ok((select r->>'guest_phone' from json_array_elements(team_day('i1-test', current_date + 10)->'requests') r where r->>'guest_name' = 'ТЕСТ Два') is null, 'day_masks_phone');
insert into _r(t) select is((select r->>'guest_phone' from json_array_elements(team_day('head-test', current_date + 10)->'requests') r where r->>'guest_name' = 'ТЕСТ Два'), '79990000012', 'head sees phone');
insert into _r(t) select is((select r->>'guest_phone' from json_array_elements(team_day('i1-test', current_date + 10)->'requests') r where r->>'guest_name' = 'ТЕСТ Один'), '79990000011', 'day_own_phone');
insert into _r(t) select is((select r->'instructors'->0->>'name' from json_array_elements(team_day('head-test', current_date + 10)->'requests') r where r->>'guest_name' = 'ТЕСТ Два'), 'Инструктор 2', 'instructors listed');
insert into _r(t) select is(json_array_length(team_day('head-test', current_date + 10)->'instructors'), 4, 'four instructors in the day');
insert into _r(t) select is((team_day('head-test', current_date + 10)->'horses'->>'total')::int, 10, 'horses total');
insert into _r(t) select is(team_request('i1-test', (select id from _ids where k = 'r2'))->>'guest_phone', null, 'team_request masks phone');

insert into _ids select 'ic', team_create_request('i1-test', 'trails', current_date + 10, '14:00', 2, 'ТЕСТ Звонок', '79990000013', 'был раз');
insert into _r(t) select is((select source || '/' || status || '/' || (created_by = (select id from _ids where k = 'i1'))::text from requests where id = (select id from _ids where k = 'ic')),
  'instructor/pending/true', 'instructor_create');
insert into _r(t) select ok((select count(*) from json_array_elements(team_requests('head-test', current_date, current_date + 14, 'pending')) r where r->>'guest_name' = 'ТЕСТ Звонок') = 1, 'pending list for the head');

set local role anon;
insert into _r(t) select lives_ok($$select public.team_whoami('head-test')$$, 'anon may call team_whoami');
insert into _r(t) select throws_ok($$select public._auth('head-test')$$, '42501', null, 'anon cannot call _auth');
reset role;

insert into _r(t) select * from finish();
select string_agg(t, E'\n' order by id) as tap from _r;
rollback;

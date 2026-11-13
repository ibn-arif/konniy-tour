-- Fixes from the final review: inactive instructor keys, day off / deactivation with confirmed rides, global site limit.
begin;
set local search_path = public, extensions;
set local timezone = 'Europe/Moscow';
create temp table _r(id serial, t text) on commit drop;
create temp table _ids(k text primary key, id uuid) on commit drop;
insert into _r(t) select plan(7);

insert into _ids select 'i' || sort, id from instructors where name like 'Инструктор _';
insert into access_keys(role, instructor_id, key_hash) values
  ('head', null, encode(digest('head-test', 'sha256'), 'hex')),
  ('instructor', (select id from _ids where k = 'i4'), encode(digest('i4-test', 'sha256'), 'hex'));

-- I1: a deactivated instructor's link stops working
insert into _r(t) select is(team_whoami('i4-test')->>'name', 'Инструктор 4', 'active instructor key works');
select head_save_instructor('head-test', (select id from _ids where k = 'i4'), 'Инструктор 4', null, false);
insert into _r(t) select throws_ok($$select team_whoami('i4-test')$$, '42501', 'forbidden', 'inactive instructor key is forbidden');

-- I2: instructor 1 has a confirmed ride on D+10
with q as (insert into requests(route_key, day, start_time, people, guest_name, guest_phone, source, status, horses_count)
  values ('short', current_date + 10, '10:30', 2, 'ТЕСТ Ревью', '79990000031', 'site', 'confirmed', 2) returning id)
insert into _ids select 'c1', id from q;
insert into request_instructors values ((select id from _ids where k = 'c1'), (select id from _ids where k = 'i1'));
insert into _r(t) select throws_ok(format('select head_set_day_off(%L, %L, %L, %L, true)', 'head-test', 'instructor', (select id from _ids where k = 'i1'), current_date + 10),
  'P0001', 'У инструктора в этот день подтверждённые выезды — сначала перенесите их или назначьте другого', 'day off refused over a confirmed ride');
insert into _r(t) select lives_ok(format('select head_set_day_off(%L, %L, %L, %L, true)', 'head-test', 'instructor', (select id from _ids where k = 'i1'), current_date + 11), 'day off on a free day works');
insert into _r(t) select throws_ok(format('select head_save_instructor(%L, %L, %L, null, false)', 'head-test', (select id from _ids where k = 'i1'), 'Инструктор 1'),
  'P0001', 'У инструктора есть подтверждённые выезды впереди — сначала перенесите их или назначьте другого', 'deactivation refused over future rides');

-- I3: global limit on site requests per hour
insert into requests(route_key, day, start_time, people, guest_name, guest_phone, source, status)
  select 'short', current_date + 30, '09:00', 1, 'ТЕСТ Поток', '7999100' || lpad(n::text, 4, '0'), 'site', 'rejected' from generate_series(1, 20) n;
insert into _r(t) select throws_ok($$select create_request('short', current_date + 12, '09:00', 1, 'ТЕСТ', '79990000032', '', '')$$, 'P0001', 'Сейчас слишком много заявок, позвоните нам', 'global hourly limit');
update requests set created_at = now() - interval '2 hours' where guest_name = 'ТЕСТ Поток';
insert into _r(t) select lives_ok($$select create_request('short', current_date + 12, '09:00', 1, 'ТЕСТ', '79990000032', '', '')$$, 'limit counts only the last hour');

insert into _r(t) select * from finish();
select string_agg(t, E'\n' order by id) as tap from _r;
rollback;

-- The head's actions. Day D = today + 10, D+1, D+2.
begin;
set local search_path = public, extensions;
set local timezone = 'Europe/Moscow';
create temp table _r(id serial, t text) on commit drop;
create temp table _ids(k text primary key, id uuid) on commit drop;
insert into _r(t) select plan(19);

insert into _ids select 'i' || sort, id from instructors where name like 'Инструктор _';
insert into access_keys(role, instructor_id, key_hash) values
  ('head', null, encode(digest('head-test', 'sha256'), 'hex')),
  ('instructor', (select id from _ids where k = 'i1'), encode(digest('i1-test', 'sha256'), 'hex'));

-- pending 7 people at short 10:30
with q as (insert into requests(route_key, day, start_time, people, guest_name, guest_phone, source)
  values ('short', current_date + 10, '10:30', 7, 'ТЕСТ Семь', '79990000021', 'site') returning id)
insert into _ids select 'p7', id from q;

insert into _r(t) select throws_ok(format('select head_confirm(%L, %L, array[%L, %L]::uuid[], 7)', 'i1-test', (select id from _ids where k = 'p7'), (select id from _ids where k = 'i1'), (select id from _ids where k = 'i2')),
  '42501', 'Только главный может это сделать', 'instructor_cannot_confirm');
insert into _r(t) select throws_ok(format('select head_confirm(%L, %L, array[%L]::uuid[], 7)', 'head-test', (select id from _ids where k = 'p7'), (select id from _ids where k = 'i1')),
  'P0001', 'Не хватает свободных инструкторов или лошадей', 'confirm_too_few_instructors');
insert into _r(t) select throws_ok(format('select head_confirm(%L, %L, array[%L, %L]::uuid[], 11)', 'head-test', (select id from _ids where k = 'p7'), (select id from _ids where k = 'i1'), (select id from _ids where k = 'i2')),
  'P0001', 'Не хватает свободных инструкторов или лошадей', 'confirm_too_many_horses');
insert into _r(t) select lives_ok(format('select head_confirm(%L, %L, array[%L, %L]::uuid[], 7)', 'head-test', (select id from _ids where k = 'p7'), (select id from _ids where k = 'i1'), (select id from _ids where k = 'i2')), 'confirm runs');
insert into _r(t) select is((select status || '/' || horses_count || '/' || (select count(*) from request_instructors where request_id = q.id) from requests q where id = (select id from _ids where k = 'p7')),
  'confirmed/7/2', 'confirm_ok');

-- instructor 3 on a confirmed long ride 08:00–15:00
with q as (insert into requests(route_key, day, start_time, people, guest_name, guest_phone, source, status, horses_count)
  values ('long', current_date + 10, '08:00', 2, 'ТЕСТ Долгий', '79990000022', 'site', 'confirmed', 2) returning id)
insert into _ids select 'long', id from q;
insert into request_instructors values ((select id from _ids where k = 'long'), (select id from _ids where k = 'i3'));
with q as (insert into requests(route_key, day, start_time, people, guest_name, guest_phone, source)
  values ('short', current_date + 10, '12:00', 3, 'ТЕСТ Три', '79990000023', 'site') returning id)
insert into _ids select 'p3', id from q;
insert into _r(t) select throws_ok(format('select head_confirm(%L, %L, array[%L]::uuid[], 3)', 'head-test', (select id from _ids where k = 'p3'), (select id from _ids where k = 'i3')),
  'P0001', 'Не хватает свободных инструкторов или лошадей', 'confirm_busy_instructor');
insert into _r(t) select is((select json_agg(o->>'busy' order by o->>'name') from json_array_elements(head_options('head-test', (select id from _ids where k = 'p3'))->'instructors') o)::text,
  '["false", "false", "true", "false"]', 'head_options marks instructor 3 busy');

-- move
insert into _r(t) select lives_ok(format('select head_move(%L, %L, %L, %L)', 'head-test', (select id from _ids where k = 'p3'), current_date + 11, '13:30'), 'move runs');
insert into _r(t) select is((select (day - current_date) || ' ' || to_char(start_time, 'HH24:MI') || ' ' || status from requests where id = (select id from _ids where k = 'p3')), '11 13:30 pending', 'move_ok');
insert into _r(t) select throws_ok(format('select head_move(%L, %L, %L, %L)', 'head-test', (select id from _ids where k = 'p3'), current_date + 10, '10:00'), 'P0001', 'Это время только что заняли', 'move to a non-slot time');

-- a confirmed ride with instructor 3 on D+1 moved into D 12:00, where instructor 3 is on the long ride
with q as (insert into requests(route_key, day, start_time, people, guest_name, guest_phone, source, status, horses_count)
  values ('short', current_date + 11, '10:30', 2, 'ТЕСТ Перенос', '79990000024', 'site', 'confirmed', 2) returning id)
insert into _ids select 'c3', id from q;
insert into request_instructors values ((select id from _ids where k = 'c3'), (select id from _ids where k = 'i3'));
insert into _r(t) select is(head_move('head-test', (select id from _ids where k = 'c3'), current_date + 10, '12:00'), 'pending', 'move returns the new status');
insert into _r(t) select is((select status || '/' || (select count(*) from request_instructors where request_id = q.id) from requests q where id = (select id from _ids where k = 'c3')), 'pending/0', 'move_drops_confirmation');

-- reject
select head_reject('head-test', (select id from _ids where k = 'c3'));
insert into _r(t) select is((select status from requests where id = (select id from _ids where k = 'c3')), 'rejected', 'reject');

-- issue key
create temp table _key(k text) on commit drop;
insert into _key select head_issue_key('head-test', 'instructor', (select id from _ids where k = 'i1'));
insert into _r(t) select throws_ok($$select team_whoami('i1-test')$$, '42501', 'forbidden', 'issue_revokes_old');
insert into _r(t) select is(team_whoami((select k from _key))->>'name', 'Инструктор 1', 'new key works');
insert into _r(t) select is(length((select k from _key)), 64, 'key is 32 bytes hex');

-- days off
insert into _r(t) select is((select free_instructors from slot_capacity('short', current_date + 12, '09:00')), 4, 'before the day off');
select head_set_day_off('head-test', 'instructor', (select id from _ids where k = 'i3'), current_date + 12, true);
insert into _r(t) select is((select free_instructors from slot_capacity('short', current_date + 12, '09:00')), 3, 'day_off_affects_capacity');
insert into _r(t) select is((select json_array_length(i->'days_off') from json_array_elements(head_team('head-test', current_date, current_date + 30)->'instructors') i where i->>'name' = 'Инструктор 3'), 1, 'head_team lists days off');

insert into _r(t) select * from finish();
select string_agg(t, E'\n' order by id) as tap from _r;
rollback;

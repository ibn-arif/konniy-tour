-- History of requests, several instructors per ride.
begin;
set local search_path = public, extensions;
set local timezone = 'Europe/Moscow';
create temp table _r(id serial, t text) on commit drop;
grant all on _r to anon; grant all on sequence _r_id_seq to anon;
create temp table _ids(k text primary key, id uuid) on commit drop;
insert into _r(t) select plan(14);

insert into _ids select 'i' || sort, id from instructors where name like 'Инструктор _';
insert into access_keys(role, instructor_id, key_hash) values
  ('head', null, encode(digest('head-test', 'sha256'), 'hex')),
  ('instructor', (select id from _ids where k = 'i1'), encode(digest('i1-test', 'sha256'), 'hex'));

insert into _ids select 'site', create_request('short', current_date + 10, '10:30', 2, 'ТЕСТ Сайт', '79990000051', '', '');
insert into _r(t) select is((select action || '/' || actor_role || '/' || actor_name from request_events where request_id = (select id from _ids where k = 'site')), 'created/site/Сайт', 'site request logs created');

insert into _ids select 'inst', team_create_request('i1-test', 'short', current_date + 10, '12:00', 7, 'ТЕСТ Звонок', '79990000052', '');
insert into _r(t) select is((select action || '/' || actor_role || '/' || actor_name from request_events where request_id = (select id from _ids where k = 'inst')), 'created/instructor/Инструктор 1', 'instructor request logs created');

-- several instructors on one ride, more than needed
select head_confirm('head-test', (select id from _ids where k = 'site'), array[(select id from _ids where k = 'i1'), (select id from _ids where k = 'i2'), (select id from _ids where k = 'i3')], 2);
insert into _r(t) select is((select count(*)::int from request_instructors where request_id = (select id from _ids where k = 'site')), 3, 'three instructors on a ride for 2');
insert into _r(t) select is((select action || '/' || actor_role || '/' || (details->'instructors')::text || '/' || (details->>'horses') from request_events where request_id = (select id from _ids where k = 'site') and action = 'confirmed'),
  'confirmed/head/["Инструктор 1", "Инструктор 2", "Инструктор 3"]/2', 'confirm logs instructors and horses');

select head_confirm('head-test', (select id from _ids where k = 'site'), array[(select id from _ids where k = 'i1')], 2);
insert into _r(t) select is((select (details->'instructors')::text from request_events where request_id = (select id from _ids where k = 'site') and action = 'updated'), '["Инструктор 1"]', 'reconfirm logs updated');

select head_move('head-test', (select id from _ids where k = 'site'), current_date + 11, '13:30');
insert into _r(t) select is((select (details->>'from_time') || '>' || (details->>'to_time') || '/' || ((details->>'to_day')::date - current_date) from request_events where request_id = (select id from _ids where k = 'site') and action = 'moved'),
  '10:30>13:30/11', 'move logs from and to');

select head_reject('head-test', (select id from _ids where k = 'inst'));
insert into _r(t) select is((select count(*)::int from request_events where request_id = (select id from _ids where k = 'inst') and action = 'rejected'), 1, 'reject logged');

insert into _r(t) select is(json_array_length(team_request('head-test', (select id from _ids where k = 'site'))->'history'), 4, 'request history in team_request');
insert into _r(t) select is(team_request('head-test', (select id from _ids where k = 'site'))->'history'->0->>'action', 'created', 'history oldest first');

insert into _r(t) select ok(json_array_length(head_history('head-test', current_date - 1, current_date + 1)) >= 6, 'head_history lists recent events');
insert into _r(t) select is((select e->>'guest_name' from json_array_elements(head_history('head-test', current_date - 1, current_date + 1)) e where e->>'action' = 'rejected'), 'ТЕСТ Звонок', 'head_history carries the guest');
insert into _r(t) select throws_ok($$select head_history('i1-test', current_date - 1, current_date + 1)$$, '42501', 'Только главный может это сделать', 'instructor cannot read history feed');

-- the same instructor twice does not count as two
insert into _ids select 'p7', create_request('short', current_date + 12, '10:30', 7, 'ТЕСТ Семь', '79990000053', '', '');
insert into _r(t) select throws_ok(format('select head_confirm(%L, %L, array[%L, %L]::uuid[], 7)', 'head-test', (select id from _ids where k = 'p7'), (select id from _ids where k = 'i1'), (select id from _ids where k = 'i1')),
  'P0001', 'Не хватает свободных инструкторов или лошадей', 'duplicate instructor counted once');

set local role anon;
insert into _r(t) select throws_ok('select * from public.request_events', '42501', null, 'anon cannot read events');
reset role;

insert into _r(t) select * from finish();
select string_agg(t, E'\n' order by id) as tap from _r;
rollback;

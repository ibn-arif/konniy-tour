-- Head records a guest who came by phone / WhatsApp / in person; channel is stored and shown.
begin;
set local search_path = public, extensions;
set local timezone = 'Europe/Moscow';
create temp table _r(id serial, t text) on commit drop;
grant all on _r to anon; grant all on sequence _r_id_seq to anon;
create temp table _k(k uuid) on commit drop;
create temp table _c(n int) on commit drop;
insert into _r(t) select plan(8);

insert into access_keys(role, instructor_id, key_hash) values
  ('head', null, encode(digest('head-test', 'sha256'), 'hex')),
  ('instructor', (select id from instructors where name = 'Инструктор 1'), encode(digest('i1-test', 'sha256'), 'hex'));

insert into _c select spots from slot_capacity('short', current_date + 10, '09:00');
insert into _k select team_create_request('head-test', 'short', current_date + 10, '09:00', 2, 'ТЕСТ Звонок', '8 999 000-00-81', '', 'Звонок');
insert into _r(t) select is((select source from requests where id = (select k from _k)), 'head', 'head request has source head');
insert into _r(t) select is((select channel from requests where id = (select k from _k)), 'Звонок', 'channel stored');
insert into _r(t) select is(team_request('head-test', (select k from _k))->>'channel', 'Звонок', 'channel in request json');
insert into _r(t) select is(team_request('head-test', (select k from _k))->'history'->0->>'actor_name', 'Главный', 'history says head created it');
insert into _r(t) select is((select spots from slot_capacity('short', current_date + 10, '09:00')), (select n - 2 from _c), 'head request holds places');

insert into _k select team_create_request('i1-test', 'short', current_date + 10, '10:30', 1, 'ТЕСТ Инстр', '79990000082', '', null);
insert into _r(t) select is((select source from requests where id = (select k from _k offset 1)), 'instructor', 'instructor request keeps source instructor');
insert into _r(t) select is((select channel from requests where id = (select k from _k offset 1)), null, 'channel optional');

insert into _r(t) select throws_ok($$select team_create_request('head-test', 'short', current_date + 10, '12:00', 1, 'ТЕСТ', '79990000083', '', repeat('x', 41))$$,
  'P0001', 'Слишком длинное «Откуда»', 'channel length limited');

insert into _r(t) select * from finish();
select string_agg(t, E'\n' order by id) as tap from _r;
rollback;

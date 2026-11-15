-- Routes managed by the head: public list, add, edit times, deactivate, validation.
begin;
set local search_path = public, extensions;
set local timezone = 'Europe/Moscow';
create temp table _r(id serial, t text) on commit drop;
grant all on _r to anon; grant all on sequence _r_id_seq to anon;
create temp table _k(k text) on commit drop;
insert into _r(t) select plan(14);

insert into access_keys(role, instructor_id, key_hash) values
  ('head', null, encode(digest('head-test', 'sha256'), 'hex')),
  ('instructor', (select id from instructors where name = 'Инструктор 1'), encode(digest('i1-test', 'sha256'), 'hex'));

insert into _r(t) select is(json_array_length(public_routes()), 3, 'three public routes');
insert into _r(t) select is(public_routes()->0->>'dur_label', '45–60 мин', 'short route keeps its site label');

insert into _k select head_save_route('head-test', null, 'ТЕСТ Закат', 90, array['18:30', '17:00'], '1,5 часа', 'на закате', true);
insert into _r(t) select is(json_array_length(public_routes()), 4, 'new route is public');
insert into _r(t) select is((select string_agg(to_char(start_time, 'HH24:MI'), ',' order by start_time) from free_slots((select k from _k), current_date + 10, current_date + 10, 1)), '17:00,18:30', 'new route offers its times, sorted');
insert into _r(t) select ok(create_request((select k from _k), current_date + 10, '17:00', 2, 'ТЕСТ Гость', '79990000071', '', '') is not null, 'guest can book the new route');

select head_save_route('head-test', (select k from _k), 'ТЕСТ Закат', 90, array['17:30'], '1,5 часа', 'на закате', true);
insert into _r(t) select is((select string_agg(to_char(start_time, 'HH24:MI'), ',') from free_slots((select k from _k), current_date + 10, current_date + 10, 1)), '17:30', 'edited times');

select head_save_route('head-test', (select k from _k), 'ТЕСТ Закат', 90, array['17:30'], '1,5 часа', 'на закате', false);
insert into _r(t) select is(json_array_length(public_routes()), 3, 'inactive route hidden from the site');
insert into _r(t) select is((select count(*)::int from free_slots((select k from _k), current_date + 10, current_date + 10, 1)), 0, 'inactive route has no free time');
insert into _r(t) select throws_ok(format('select create_request(%L, current_date + 10, %L, 1, %L, %L, %L, %L)', (select k from _k), '17:30', 'ТЕСТ', '79990000072', '', ''),
  'P0001', 'Этот маршрут сейчас не проводится', 'inactive route cannot be booked');
insert into _r(t) select ok((select bool_or(r->>'name' = 'ТЕСТ Закат' and (r->>'active')::bool = false) from json_array_elements(team_day('head-test', current_date)->'routes') r), 'team still sees the inactive route');

insert into _r(t) select throws_ok($$select head_save_route('head-test', null, 'ТЕСТ', 60, array[]::text[], '', '', true)$$, 'P0001', 'Добавьте хотя бы одно время выезда', 'needs a time');
insert into _r(t) select throws_ok($$select head_save_route('head-test', null, 'ТЕСТ', 10, array['10:00'], '', '', true)$$, 'P0001', 'Длительность — от 30 минут до 12 часов', 'duration bounds');
insert into _r(t) select throws_ok($$select head_save_route('head-test', null, 'ТЕСТ', 120, array['23:00'], '', '', true)$$, 'P0001', 'Прогулка должна закончиться до полуночи', 'ends before midnight');
insert into _r(t) select throws_ok($$select head_save_route('i1-test', null, 'ТЕСТ', 60, array['10:00'], '', '', true)$$, '42501', 'Только главный может это сделать', 'instructor cannot edit routes');

insert into _r(t) select * from finish();
select string_agg(t, E'\n' order by id) as tap from _r;
rollback;

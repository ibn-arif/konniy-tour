-- free_slots and create_request. Test day: today + 10 (inside the 60-day window).
begin;
set local search_path = public, extensions;
set local timezone = 'Europe/Moscow';
create temp table _r(id serial, t text) on commit drop;
grant all on _r to anon; grant all on sequence _r_id_seq to anon;
create temp table _ids(k text primary key, id uuid) on commit drop;
grant all on _ids to anon;
insert into _r(t) select plan(17);

insert into _r(t) select is((select count(*)::int from free_slots('short', current_date + 10, current_date + 10, 1) where spots = 10), 6, 'free_slots_full_day');
insert into _r(t) select is((select count(*)::int from free_slots('short', current_date + 1, current_date + 400, 1) where day > (now() at time zone 'Europe/Moscow')::date + 60), 0, 'p_to capped at 60 days');
insert into _r(t) select is((select count(*)::int from free_slots('short', current_date - 1, current_date + 1, 1)
  where day + start_time < (now() at time zone 'Europe/Moscow') + interval '2 hours'), 0, 'nothing closer than 2 h');

insert into requests(route_key, day, start_time, people, guest_name, guest_phone, source)
  values ('short', current_date + 10, '10:30', 7, 'ТЕСТ', '79990000000', 'site');
insert into _r(t) select is((select count(*)::int from free_slots('short', current_date + 10, current_date + 10, 4) where start_time = '10:30'), 0, 'free_slots_people_filter');
insert into _r(t) select is((select spots from free_slots('short', current_date + 10, current_date + 10, 3) where start_time = '10:30'), 3, 'three spots left at 10:30');

insert into _ids select 'ok', create_request('short', current_date + 10, '12:00', 2, ' ТЕСТ Гость ', '+7 (999) 000-00-01', 'впервые', '');
insert into _r(t) select is((select status || '/' || source || '/' || guest_phone || '/' || guest_name from requests where id = (select id from _ids where k = 'ok')),
  'pending/site/79990000001/ТЕСТ Гость', 'create_ok');
insert into _ids select 'eight', create_request('short', current_date + 10, '12:00', 1, 'ТЕСТ', '8 999 000 00 03', '', '');
insert into _r(t) select is((select guest_phone from requests where id = (select id from _ids where k = 'eight')), '79990000003', 'leading 8 becomes 7');

insert into _r(t) select throws_ok($$select create_request('short', current_date + 10, '10:30', 4, 'ТЕСТ', '79990000004', '', '')$$, 'P0001', 'Это время только что заняли', 'create_full');
insert into _r(t) select throws_ok($$select create_request('short', current_date - 1, '10:30', 1, 'ТЕСТ', '79990000004', '', '')$$, 'P0001', 'Запись на это время уже закрыта', 'create_past');
insert into _r(t) select throws_ok($$select create_request('short', current_date + 61, '10:30', 1, 'ТЕСТ', '79990000004', '', '')$$, 'P0001', 'Запись на это время уже закрыта', 'create_too_far');
insert into _r(t) select throws_ok($$select create_request('short', current_date + 10, '10:00', 1, 'ТЕСТ', '79990000004', '', '')$$, 'P0001', 'Это время только что заняли', 'create_bad_slot');
insert into _r(t) select throws_ok($$select create_request('short', current_date + 10, '13:30', 1, 'ТЕСТ', '123', '', '')$$, 'P0001', 'Проверьте имя и телефон', 'create_bad_phone');

select create_request('short', current_date + 10, t::time, 1, 'ТЕСТ', '79990000002', '', '') from unnest(array['13:30','15:00','16:30']) t;
insert into _r(t) select throws_ok($$select create_request('short', current_date + 11, '09:00', 1, 'ТЕСТ', '79990000002', '', '')$$, 'P0001', 'Слишком много заявок с этого номера, позвоните нам', 'create_rate_limit');

insert into _r(t) select is((select count(*)::int from (select create_request('short', current_date + 10, '09:00', 1, 'ТЕСТ', '79990000005', '', 'x')) x), 1, 'honeypot returns a uuid');
insert into _r(t) select is((select count(*)::int from requests where guest_phone = '79990000005'), 0, 'honeypot writes nothing');

set local role anon;
insert into _r(t) select lives_ok($$select * from public.free_slots('short', current_date + 10, current_date + 10, 1)$$, 'anon_can_call');
insert into _r(t) select throws_ok($$select * from public.slot_capacity('short', current_date + 10, '09:00')$$, '42501', null, 'anon cannot call slot_capacity');
reset role;

insert into _r(t) select * from finish();
select string_agg(t, E'\n' order by id) as tap from _r;
rollback;

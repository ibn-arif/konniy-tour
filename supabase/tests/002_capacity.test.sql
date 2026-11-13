-- slot_capacity: day 2030-06-01, nothing else booked that day.
begin;
set local search_path = public, extensions;
set local timezone = 'Europe/Moscow';
create temp table _r(id serial, t text) on commit drop;
create temp table _ids(k text primary key, id uuid) on commit drop;
insert into _r(t) select plan(8);

insert into _r(t) select is((select row(c.*)::text from slot_capacity('short','2030-06-01','10:30') c), '(4,10,10)', 'capacity_empty');

with q as (insert into requests(route_key, day, start_time, people, guest_name, guest_phone, source)
  values ('short','2030-06-01','10:30',7,'ТЕСТ','79990000000','site') returning id)
insert into _ids select 'p7', id from q;
insert into _r(t) select is((select row(c.*)::text from slot_capacity('short','2030-06-01','10:30') c), '(2,3,3)', 'pending_reserves');
insert into _r(t) select is((select row(c.*)::text from slot_capacity('short','2030-06-01','10:30', (select id from _ids where k='p7')) c), '(4,10,10)', 'ignore_param');
insert into _r(t) select is((select row(c.*)::text from slot_capacity('short','2030-06-01','12:00') c), '(4,10,10)', 'no overlap at 12:00 (back-to-back)');
update requests set status = 'rejected' where guest_name = 'ТЕСТ';

insert into requests(route_key, day, start_time, people, guest_name, guest_phone, source, status)
  values ('short','2030-06-01','10:30',10,'ТЕСТ','79990000000','site','rejected');
insert into _r(t) select is((select c.spots from slot_capacity('short','2030-06-01','10:30') c), 10, 'rejected_ignored');
update requests set status = 'rejected' where guest_name = 'ТЕСТ';

with q as (insert into requests(route_key, day, start_time, people, guest_name, guest_phone, source, status)
  values ('long','2030-06-01','08:00',3,'ТЕСТ','79990000000','site','confirmed') returning id)
insert into request_instructors select q.id, i.id from q, instructors i where i.name = 'Инструктор 1';
insert into _r(t) select is((select row(c.free_instructors, c.free_horses)::text from slot_capacity('short','2030-06-01','13:30') c), '(3,7)', 'long_blocks_day at 13:30');
insert into _r(t) select is((select c.free_instructors from slot_capacity('short','2030-06-01','16:30') c), 4, 'long ends at 15:00');
update requests set status = 'rejected' where guest_name = 'ТЕСТ';

insert into instructor_days_off select id, '2030-06-01' from instructors where name in ('Инструктор 1','Инструктор 2');
insert into horse_rest_days select id, '2030-06-01' from horses where name in ('Лошадь 1','Лошадь 2','Лошадь 3','Лошадь 4');
insert into _r(t) select is((select row(c.*)::text from slot_capacity('short','2030-06-01','10:30') c), '(2,6,6)', 'day_off_and_rest');

insert into _r(t) select * from finish();
select string_agg(t, E'\n' order by id) as tap from _r;
rollback;

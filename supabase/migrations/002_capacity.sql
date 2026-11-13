-- Сколько свободно инструкторов, лошадей и мест на маршрут в данный день и время.
-- Пересечение считается по длительности маршрутов. «ждёт» и «подтверждено» занимают места,
-- «отклонено» — нет. p_ignore исключает одну заявку (при подтверждении или переносе её самой).
create or replace function slot_capacity(p_route text, p_day date, p_start time, p_ignore uuid default null)
returns table (free_instructors int, free_horses int, spots int)
language sql stable security definer set search_path = public as $$
  with win as (
    select p_day + p_start as s, p_day + p_start + make_interval(mins => r.duration_min) as e
    from routes r where r.key = p_route
  ),
  ov as (
    select q.* from requests q join routes rr on rr.key = q.route_key, win
    where q.day = p_day and q.status <> 'rejected'
      and q.id is distinct from p_ignore
      and q.day + q.start_time < win.e
      and q.day + q.start_time + make_interval(mins => rr.duration_min) > win.s
  ),
  working as (
    select i.id from instructors i
    where i.active and not exists (select 1 from instructor_days_off d where d.instructor_id = i.id and d.day = p_day)
  ),
  busy as (
    select count(distinct ri.instructor_id)::int n
    from ov join request_instructors ri on ri.request_id = ov.id
    where ov.status = 'confirmed' and ri.instructor_id in (select id from working)
  ),
  reserve as (select coalesce(sum(ceil(people / 5.0)), 0)::int n from ov where status = 'pending'),
  herd as (
    select count(*)::int n from horses h
    where h.active and not exists (select 1 from horse_rest_days d where d.horse_id = h.id and d.day = p_day)
  ),
  ridden as (select coalesce(sum(coalesce(horses_count, people)), 0)::int n from ov),
  f as (
    select greatest((select count(*)::int from working) - (select n from busy) - (select n from reserve), 0) fi,
           greatest((select n from herd) - (select n from ridden), 0) fh
    where exists (select 1 from win)
  )
  select fi, fh, least(fi * 5, fh) from f;
$$;

revoke all on function slot_capacity(text, date, time, uuid) from public, anon, authenticated;

-- Функции, которые сайт вызывает без входа: свободное время и создание заявки.

create or replace function _now_msk() returns timestamp
language sql stable set search_path = public as $$ select now() at time zone 'Europe/Moscow' $$;

create or replace function free_slots(p_route text, p_from date, p_to date, p_people int)
returns table (day date, start_time time, spots int)
language sql stable security definer set search_path = public as $$
  with n as (select _now_msk() t),
  d as (
    select g::date dd from n,
      generate_series(greatest(p_from, n.t::date), least(p_to, n.t::date + 60), interval '1 day') g
  ),
  s as (select d.dd, x.st from d, routes r, unnest(r.slots) x(st) where r.key = p_route)
  select s.dd, s.st, c.spots
  from s cross join n cross join lateral slot_capacity(p_route, s.dd, s.st) c
  where s.dd + s.st >= n.t + interval '2 hours'
    and c.spots >= greatest(coalesce(p_people, 1), 1)
  order by s.dd, s.st;
$$;

-- Общая проверка и запись заявки: сайт (source='site') и инструктор (source='instructor').
create or replace function _insert_request(
  p_route text, p_day date, p_start time, p_people int,
  p_name text, p_phone text, p_experience text,
  p_source text, p_created_by uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_now timestamp := _now_msk();
  v_spots int;
  v_id uuid;
begin
  if v_name = '' or length(v_name) > 80 or length(v_phone) not between 10 and 15 then
    raise exception using errcode = 'P0001', message = 'Проверьте имя и телефон';
  end if;
  if length(v_phone) = 11 and left(v_phone, 1) = '8' then
    v_phone := '7' || substr(v_phone, 2);
  elsif length(v_phone) = 10 then
    v_phone := '7' || v_phone;
  end if;
  if p_people is null or p_people not between 1 and 10 then
    raise exception using errcode = 'P0001', message = 'В группе может быть от 1 до 10 человек';
  end if;
  if p_source = 'site' and (
    select count(*) from requests
    where guest_phone = v_phone and source = 'site'
      and (created_at at time zone 'Europe/Moscow')::date = v_now::date
  ) >= 3 then
    raise exception using errcode = 'P0001', message = 'Слишком много заявок с этого номера, позвоните нам';
  end if;
  if p_day is null or p_start is null or p_day + p_start < v_now + interval '2 hours' or p_day > v_now::date + 60 then
    raise exception using errcode = 'P0001', message = 'Запись на это время уже закрыта';
  end if;
  if not exists (select 1 from routes where key = p_route and p_start = any (slots)) then
    raise exception using errcode = 'P0001', message = 'Это время только что заняли';
  end if;

  -- Две заявки на один день проверяются по очереди: последнее место не уйдёт дважды.
  perform pg_advisory_xact_lock(hashtext('kt' || p_day));
  select spots into v_spots from slot_capacity(p_route, p_day, p_start);
  if coalesce(v_spots, 0) < p_people then
    raise exception using errcode = 'P0001', message = 'Это время только что заняли';
  end if;

  insert into requests (route_key, day, start_time, people, guest_name, guest_phone, experience, source, created_by)
  values (p_route, p_day, p_start, p_people, v_name, v_phone, left(btrim(p_experience), 200), p_source, p_created_by)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function create_request(
  p_route text, p_day date, p_start time, p_people int,
  p_name text, p_phone text, p_experience text default null, p_hp text default ''
) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_hp, '') <> '' then
    return gen_random_uuid();  -- ловушка для ботов: делаем вид, что всё прошло
  end if;
  return _insert_request(p_route, p_day, p_start, p_people, p_name, p_phone, p_experience, 'site', null);
end;
$$;

revoke all on function _now_msk() from public, anon, authenticated;
revoke all on function _insert_request(text, date, time, int, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function free_slots(text, date, date, int) from public;
revoke all on function create_request(text, date, time, int, text, text, text, text) from public;
grant execute on function free_slots(text, date, date, int) to anon, authenticated;
grant execute on function create_request(text, date, time, int, text, text, text, text) to anon, authenticated;

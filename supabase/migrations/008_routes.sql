-- Маршруты ведёт главный: название, длительность, время выездов, подписи для сайта.
-- Маршрут не удаляется (на него ссылаются заявки), а снимается с сайта: active = false.

alter table routes add column active bool not null default true;
alter table routes add column sort int not null default 0;
alter table routes add column dur_label text;   -- «45–60 мин»: в подсказке «Прогулка длится …»
alter table routes add column note text;        -- «3,5 км, 45–60 мин»: подпись под названием в форме
update routes set sort = 1, dur_label = '45–60 мин',  note = '3,5 км, 45–60 мин'    where key = 'short';
update routes set sort = 2, dur_label = '1,5–2 часа', note = '7 км, 1,5–2 часа'     where key = 'trails';
update routes set sort = 3, dur_label = 'до 7 часов', note = 'до 7 часов, с опытом' where key = 'long';

create or replace function _dur_text(p_min int) returns text
language sql immutable as $$
  select case when p_min % 60 = 0 then (p_min / 60) || ' ч' when p_min < 60 then p_min || ' мин'
              else (p_min / 60) || ' ч ' || (p_min % 60) || ' мин' end;
$$;

-- Маршруты для формы на сайте.
create or replace function public_routes() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
    'key', r.key, 'name', r.name, 'duration_min', r.duration_min,
    'dur_label', coalesce(nullif(r.dur_label, ''), _dur_text(r.duration_min)), 'note', coalesce(r.note, ''),
    'slots', (select json_agg(to_char(s, 'HH24:MI') order by s) from unnest(r.slots) s)) order by r.sort, r.duration_min), '[]'::json)
  from routes r where r.active;
$$;

-- Новый маршрут (p_route = null) или правка существующего. Возвращает ключ маршрута.
create or replace function head_save_route(
  p_key text, p_route text, p_name text, p_duration int, p_slots text[],
  p_dur_label text, p_note text, p_active bool
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_slots time[];
  v_key text := p_route;
begin
  perform _head(p_key);
  if v_name = '' or length(v_name) > 60 then
    raise exception using errcode = 'P0001', message = 'Укажите название маршрута';
  end if;
  if p_duration is null or p_duration not between 30 and 720 then
    raise exception using errcode = 'P0001', message = 'Длительность — от 30 минут до 12 часов';
  end if;
  begin
    select array_agg(distinct t::time order by t::time) into v_slots
    from unnest(coalesce(p_slots, '{}')) t where btrim(t) <> '';
  exception when others then
    raise exception using errcode = 'P0001', message = 'Проверьте время выездов';
  end;
  if v_slots is null then
    raise exception using errcode = 'P0001', message = 'Добавьте хотя бы одно время выезда';
  end if;
  if exists (select 1 from unnest(v_slots) s where extract(epoch from s) / 60 + p_duration > 24 * 60) then
    raise exception using errcode = 'P0001', message = 'Прогулка должна закончиться до полуночи';
  end if;
  if v_key is null then
    v_key := 'r' || substr(md5(gen_random_uuid()::text), 1, 8);
    insert into routes (key, name, duration_min, slots, active, sort, dur_label, note)
    values (v_key, v_name, p_duration, v_slots, coalesce(p_active, true),
            (select coalesce(max(sort), 0) + 1 from routes), nullif(btrim(p_dur_label), ''), nullif(btrim(p_note), ''));
  else
    update routes set name = v_name, duration_min = p_duration, slots = v_slots, active = coalesce(p_active, active),
                      dur_label = nullif(btrim(p_dur_label), ''), note = nullif(btrim(p_note), '')
    where key = v_key;
    if not found then
      raise exception using errcode = 'P0001', message = 'Маршрут не найден';
    end if;
  end if;
  return v_key;
end;
$$;

create or replace function free_slots(p_route text, p_from date, p_to date, p_people int)
returns table (day date, start_time time, spots int)
language sql stable security definer set search_path = public as $$
  with n as (select _now_msk() t),
  d as (
    select g::date dd from n,
      generate_series(greatest(p_from, n.t::date), least(p_to, n.t::date + 60), interval '1 day') g
  ),
  s as (select d.dd, x.st from d, routes r, unnest(r.slots) x(st) where r.key = p_route and r.active)
  select s.dd, s.st, c.spots
  from s cross join n cross join lateral slot_capacity(p_route, s.dd, s.st) c
  where s.dd + s.st >= n.t + interval '2 hours'
    and c.spots >= greatest(coalesce(p_people, 1), 1)
  order by s.dd, s.st;
$$;

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
  -- Общий предел: номера можно выдумывать, поэтому с сайта не больше 20 заявок в час на всех.
  if p_source = 'site' and (
    select count(*) from requests where source = 'site' and created_at > now() - interval '1 hour'
  ) >= 20 then
    raise exception using errcode = 'P0001', message = 'Сейчас слишком много заявок, позвоните нам';
  end if;
  if p_day is null or p_start is null or p_day + p_start < v_now + interval '2 hours' or p_day > v_now::date + 60 then
    raise exception using errcode = 'P0001', message = 'Запись на это время уже закрыта';
  end if;
  if exists (select 1 from routes where key = p_route and not active) then
    raise exception using errcode = 'P0001', message = 'Этот маршрут сейчас не проводится';
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
  perform _log(v_id, 'created',
    case when p_source = 'site' then 'site' when p_created_by is null then 'head' else 'instructor' end,
    case when p_source = 'site' then 'Сайт' when p_created_by is null then 'Главный'
         else (select name from instructors where id = p_created_by) end,
    jsonb_build_object('route', p_route, 'day', p_day, 'time', to_char(p_start, 'HH24:MI'), 'people', p_people));
  return v_id;
end;
$$;

create or replace function team_day(p_key text, p_day date) returns json
language sql stable security definer set search_path = public as $$
  with k as (select * from _auth(p_key))
  select json_build_object(
    'day', p_day,
    'requests', coalesce((
      select json_agg(_request_json(q, k) order by q.start_time, q.created_at)
      from requests q where q.day = p_day and q.status <> 'rejected'), '[]'::json),
    'instructors', coalesce((
      select json_agg(json_build_object(
        'id', i.id, 'name', i.name,
        'day_off', exists (select 1 from instructor_days_off d where d.instructor_id = i.id and d.day = p_day))
        order by i.sort, i.name)
      from instructors i where i.active), '[]'::json),
    'horses', json_build_object(
      'total', (select count(*) from horses where active),
      'resting', coalesce((
        select json_agg(h.name order by h.sort, h.name) from horses h
        where h.active and exists (select 1 from horse_rest_days d where d.horse_id = h.id and d.day = p_day)), '[]'::json)),
    'routes', (select json_agg(json_build_object(
        'key', r.key, 'name', r.name, 'duration_min', r.duration_min, 'active', r.active,
        'dur_label', r.dur_label, 'note', r.note,
        'slots', (select json_agg(to_char(s, 'HH24:MI') order by s) from unnest(r.slots) s))
        order by r.active desc, r.sort, r.duration_min) from routes r)
  ) from k;
$$;

revoke all on function _dur_text(int) from public, anon, authenticated;
revoke all on function _insert_request(text, date, time, int, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public_routes() from public;
revoke all on function head_save_route(text, text, text, int, text[], text, text, bool) from public;
grant execute on function public_routes() to anon, authenticated;
grant execute on function head_save_route(text, text, text, int, text[], text, text, bool) to anon, authenticated;

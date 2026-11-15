-- История заявок: кто и когда создал, подтвердил, перенёс, отклонил. Несколько инструкторов на выезд.

create table request_events (
  id bigserial primary key,
  request_id uuid not null references requests(id) on delete cascade,
  at timestamptz not null default now(),
  action text not null check (action in ('created', 'confirmed', 'updated', 'moved', 'rejected')),
  actor_role text not null check (actor_role in ('site', 'head', 'instructor')),
  actor_name text not null,
  details jsonb not null default '{}'::jsonb
);
create index request_events_request_idx on request_events (request_id, id);
create index request_events_at_idx on request_events (at);
alter table request_events enable row level security;
revoke all on table request_events from anon, authenticated;
revoke all on sequence request_events_id_seq from anon, authenticated;

create or replace function _log(p_request uuid, p_action text, p_role text, p_name text, p_details jsonb) returns void
language sql security definer set search_path = public as $$
  insert into request_events (request_id, action, actor_role, actor_name, details)
  values (p_request, p_action, p_role, coalesce(p_name, '—'), coalesce(p_details, '{}'::jsonb));
$$;

create or replace function _history(p_request uuid) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
    'at', e.at, 'action', e.action, 'actor_role', e.actor_role, 'actor_name', e.actor_name, 'details', e.details) order by e.id), '[]'::json)
  from request_events e where e.request_id = p_request;
$$;

-- Заявка вместе с её историей.
create or replace function team_request(p_key text, p_id uuid) returns json
language sql stable security definer set search_path = public as $$
  select (_request_json(q, k)::jsonb || jsonb_build_object('history', _history(q.id)::jsonb))::json
  from _auth(p_key) k, requests q where q.id = p_id;
$$;

-- Лента изменений для главного: события за период (по московской дате), новые сверху.
create or replace function head_history(p_key text, p_from date, p_to date) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform _head(p_key);
  return coalesce((
    select json_agg(x order by x.id desc) from (
      select e.id, e.at, e.action, e.actor_role, e.actor_name, e.details,
             q.id as request_id, q.guest_name, q.route_key, q.day, to_char(q.start_time, 'HH24:MI') as start_time, q.people, q.status
      from request_events e join requests q on q.id = e.request_id
      where (e.at at time zone 'Europe/Moscow')::date between p_from and least(p_to, p_from + 92)
      order by e.id desc limit 500) x), '[]'::json);
end;
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

create or replace function head_confirm(p_key text, p_id uuid, p_instructors uuid[], p_horses int) returns void
language plpgsql security definer set search_path = public as $$
declare
  q requests;
  c record;
  n int := (select count(distinct x) from unnest(p_instructors) x);  -- один и тот же инструктор считается один раз
begin
  perform _head(p_key);
  q := _get_request(p_id);
  perform pg_advisory_xact_lock(hashtext('kt' || q.day));
  select * into c from slot_capacity(q.route_key, q.day, q.start_time, q.id);
  if n * 5 < q.people
     or n > c.free_instructors
     or p_horses is null or p_horses < q.people or p_horses > c.free_horses
     or exists (
       select 1 from unnest(p_instructors) x(id)
       where not exists (select 1 from instructors i where i.id = x.id and i.active)
          or exists (select 1 from instructor_days_off d where d.instructor_id = x.id and d.day = q.day)
          or x.id in (select _busy_instructors(q.route_key, q.day, q.start_time, q.id)))
  then
    raise exception using errcode = 'P0001', message = 'Не хватает свободных инструкторов или лошадей';
  end if;
  delete from request_instructors where request_id = q.id;
  insert into request_instructors select q.id, x from (select distinct unnest(p_instructors)) t(x);
  update requests set status = 'confirmed', horses_count = p_horses where id = q.id;
  perform _log(q.id, case when q.status = 'confirmed' then 'updated' else 'confirmed' end, 'head', 'Главный',
    jsonb_build_object('horses', p_horses, 'instructors', (
      select jsonb_agg(i.name order by i.sort, i.name) from request_instructors ri join instructors i on i.id = ri.instructor_id
      where ri.request_id = q.id)));
end;
$$;

create or replace function head_reject(p_key text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _head(p_key);
  perform _get_request(p_id);
  update requests set status = 'rejected' where id = p_id;
  perform _log(p_id, 'rejected', 'head', 'Главный', '{}'::jsonb);
end;
$$;

create or replace function head_move(p_key text, p_id uuid, p_day date, p_start time) returns text
language plpgsql security definer set search_path = public as $$
declare
  q requests;
  c record;
  v_status text;
begin
  perform _head(p_key);
  q := _get_request(p_id);
  if not exists (select 1 from routes where key = q.route_key and p_start = any (slots)) then
    raise exception using errcode = 'P0001', message = 'Это время только что заняли';
  end if;
  if p_day < _now_msk()::date then
    raise exception using errcode = 'P0001', message = 'Запись на это время уже закрыта';
  end if;
  perform pg_advisory_xact_lock(hashtext('kt' || least(q.day, p_day)));
  if p_day <> q.day then
    perform pg_advisory_xact_lock(hashtext('kt' || greatest(q.day, p_day)));
  end if;
  select * into c from slot_capacity(q.route_key, p_day, p_start, q.id);
  if c.spots < q.people or c.free_horses < coalesce(q.horses_count, q.people) then
    raise exception using errcode = 'P0001', message = 'Это время только что заняли';
  end if;
  v_status := q.status;
  if q.status = 'confirmed' and exists (
    select 1 from request_instructors ri
    where ri.request_id = q.id and (
      ri.instructor_id in (select _busy_instructors(q.route_key, p_day, p_start, q.id))
      or exists (select 1 from instructor_days_off d where d.instructor_id = ri.instructor_id and d.day = p_day)))
  then
    v_status := 'pending';
    delete from request_instructors where request_id = q.id;
  end if;
  update requests
  set day = p_day, start_time = p_start, status = v_status,
      horses_count = case when v_status = 'pending' then null else horses_count end
  where id = q.id;
  perform _log(q.id, 'moved', 'head', 'Главный', jsonb_build_object(
    'from_day', q.day, 'from_time', to_char(q.start_time, 'HH24:MI'),
    'to_day', p_day, 'to_time', to_char(p_start, 'HH24:MI'),
    'dropped', q.status = 'confirmed' and v_status = 'pending'));
  return v_status;
end;
$$;

revoke all on function _log(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function _history(uuid) from public, anon, authenticated;
revoke all on function _insert_request(text, date, time, int, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function head_history(text, date, date) from public;
grant execute on function head_history(text, date, date) to anon, authenticated;

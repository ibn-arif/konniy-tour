-- Действия главного: подтвердить, отклонить, перенести, выходные, команда и лошади, ссылки.

create or replace function _head(p_key text) returns access_keys
language plpgsql stable security definer set search_path = public as $$
declare k access_keys := _auth(p_key);
begin
  if k.role <> 'head' then
    raise exception using errcode = '42501', message = 'Только главный может это сделать';
  end if;
  return k;
end;
$$;

-- Инструкторы, занятые подтверждёнными выездами, которые пересекаются с маршрутом в это время.
create or replace function _busy_instructors(p_route text, p_day date, p_start time, p_ignore uuid default null)
returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct ri.instructor_id
  from requests q
  join routes rr on rr.key = q.route_key
  join request_instructors ri on ri.request_id = q.id
  cross join (select p_day + p_start s, p_day + p_start + make_interval(mins => r.duration_min) e from routes r where r.key = p_route) w
  where q.day = p_day and q.status = 'confirmed' and q.id is distinct from p_ignore
    and q.day + q.start_time < w.e
    and q.day + q.start_time + make_interval(mins => rr.duration_min) > w.s;
$$;

create or replace function _get_request(p_id uuid) returns requests
language plpgsql security definer set search_path = public as $$
declare q requests;
begin
  select * into q from requests where id = p_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'Заявка не найдена';
  end if;
  return q;
end;
$$;

-- Что можно выбрать при подтверждении: инструкторы (свободен / занят / выходной) и свободные лошади.
create or replace function head_options(p_key text, p_id uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare q requests;
begin
  perform _head(p_key);
  select * into q from requests where id = p_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'Заявка не найдена';
  end if;
  return json_build_object(
    'instructors', coalesce((
      select json_agg(json_build_object(
        'id', i.id, 'name', i.name,
        'day_off', exists (select 1 from instructor_days_off d where d.instructor_id = i.id and d.day = q.day),
        'busy', i.id in (select _busy_instructors(q.route_key, q.day, q.start_time, q.id)),
        'assigned', exists (select 1 from request_instructors ri where ri.request_id = q.id and ri.instructor_id = i.id))
        order by i.sort, i.name)
      from instructors i where i.active), '[]'::json),
    'free_horses', (select free_horses from slot_capacity(q.route_key, q.day, q.start_time, q.id)),
    'free_instructors', (select free_instructors from slot_capacity(q.route_key, q.day, q.start_time, q.id))
  );
end;
$$;

create or replace function head_confirm(p_key text, p_id uuid, p_instructors uuid[], p_horses int) returns void
language plpgsql security definer set search_path = public as $$
declare
  q requests;
  c record;
  n int := coalesce(array_length(p_instructors, 1), 0);
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
end;
$$;

create or replace function head_reject(p_key text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _head(p_key);
  perform _get_request(p_id);
  update requests set status = 'rejected' where id = p_id;
end;
$$;

-- Перенос. Возвращает статус после переноса: если назначенные инструкторы в новое время заняты,
-- подтверждение снимается и заявка снова «ждёт».
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
  return v_status;
end;
$$;

create or replace function head_set_day_off(p_key text, p_kind text, p_id uuid, p_day date, p_off bool) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _head(p_key);
  if p_kind = 'instructor' then
    if p_off then
      insert into instructor_days_off values (p_id, p_day) on conflict do nothing;
    else
      delete from instructor_days_off where instructor_id = p_id and day = p_day;
    end if;
  elsif p_kind = 'horse' then
    if p_off then
      insert into horse_rest_days values (p_id, p_day) on conflict do nothing;
    else
      delete from horse_rest_days where horse_id = p_id and day = p_day;
    end if;
  else
    raise exception using errcode = 'P0001', message = 'Неизвестный вид';
  end if;
end;
$$;

create or replace function head_save_instructor(p_key text, p_id uuid, p_name text, p_phone text, p_active bool) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  v_id uuid;
begin
  perform _head(p_key);
  if v_name = '' or length(v_name) > 60 then
    raise exception using errcode = 'P0001', message = 'Укажите имя';
  end if;
  if length(v_phone) = 11 and left(v_phone, 1) = '8' then v_phone := '7' || substr(v_phone, 2); end if;
  if p_id is null then
    insert into instructors (name, phone, active, sort)
    values (v_name, v_phone, coalesce(p_active, true), (select coalesce(max(sort), 0) + 1 from instructors))
    returning id into v_id;
  else
    update instructors set name = v_name, phone = v_phone, active = coalesce(p_active, active)
    where id = p_id returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function head_save_horse(p_key text, p_id uuid, p_name text, p_active bool) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  perform _head(p_key);
  if v_name = '' or length(v_name) > 60 then
    raise exception using errcode = 'P0001', message = 'Укажите имя';
  end if;
  if p_id is null then
    insert into horses (name, active, sort)
    values (v_name, coalesce(p_active, true), (select coalesce(max(sort), 0) + 1 from horses))
    returning id into v_id;
  else
    update horses set name = v_name, active = coalesce(p_active, active) where id = p_id returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Новая личная ссылка. Прежние ссылки этого человека перестают работать.
create or replace function head_issue_key(p_key text, p_role text, p_instructor uuid) returns text
language plpgsql security definer set search_path = public as $$
declare raw text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  perform _head(p_key);
  if p_role not in ('head', 'instructor') or (p_role = 'instructor') <> (p_instructor is not null) then
    raise exception using errcode = 'P0001', message = 'Неверные данные';
  end if;
  update access_keys set revoked_at = now()
  where revoked_at is null and role = p_role and instructor_id is not distinct from p_instructor;
  insert into access_keys (role, instructor_id, key_hash)
  values (p_role, p_instructor, encode(extensions.digest(raw, 'sha256'), 'hex'));
  return raw;
end;
$$;

create or replace function head_team(p_key text, p_from date, p_to date) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform _head(p_key);
  return json_build_object(
    'instructors', coalesce((
      select json_agg(json_build_object(
        'id', i.id, 'name', i.name, 'phone', i.phone, 'active', i.active,
        'has_key', exists (select 1 from access_keys k where k.instructor_id = i.id and k.revoked_at is null),
        'days_off', coalesce((select json_agg(d.day order by d.day) from instructor_days_off d
                              where d.instructor_id = i.id and d.day between p_from and p_to), '[]'::json))
        order by i.active desc, i.sort, i.name)
      from instructors i), '[]'::json),
    'horses', coalesce((
      select json_agg(json_build_object(
        'id', h.id, 'name', h.name, 'active', h.active,
        'rest_days', coalesce((select json_agg(d.day order by d.day) from horse_rest_days d
                               where d.horse_id = h.id and d.day between p_from and p_to), '[]'::json))
        order by h.active desc, h.sort, h.name)
      from horses h), '[]'::json)
  );
end;
$$;

revoke all on function _head(text) from public, anon, authenticated;
revoke all on function _busy_instructors(text, date, time, uuid) from public, anon, authenticated;
revoke all on function _get_request(uuid) from public, anon, authenticated;
revoke all on function head_options(text, uuid), head_confirm(text, uuid, uuid[], int), head_reject(text, uuid),
  head_move(text, uuid, date, time), head_set_day_off(text, text, uuid, date, bool),
  head_save_instructor(text, uuid, text, text, bool), head_save_horse(text, uuid, text, bool),
  head_issue_key(text, text, uuid), head_team(text, date, date) from public;
grant execute on function head_options(text, uuid), head_confirm(text, uuid, uuid[], int), head_reject(text, uuid),
  head_move(text, uuid, date, time), head_set_day_off(text, text, uuid, date, bool),
  head_save_instructor(text, uuid, text, text, bool), head_save_horse(text, uuid, text, bool),
  head_issue_key(text, text, uuid), head_team(text, date, date) to anon, authenticated;

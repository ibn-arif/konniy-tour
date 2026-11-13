-- Доступ команды по личному ключу из ссылки. В базе хранится только sha256 ключа.

create or replace function _auth(p_key text) returns access_keys
language plpgsql stable security definer set search_path = public as $$
declare k access_keys;
begin
  select * into k from access_keys
  where key_hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex') and revoked_at is null;
  if not found then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  return k;
end;
$$;

-- Заявка в виде JSON. Телефон гостя видят главный, назначенный инструктор и тот, кто записал гостя.
create or replace function _request_json(q requests, k access_keys) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', q.id,
    'route_key', q.route_key,
    'day', q.day,
    'start_time', to_char(q.start_time, 'HH24:MI'),
    'people', q.people,
    'status', q.status,
    'guest_name', q.guest_name,
    'guest_phone', case when k.role = 'head'
                          or q.created_by = k.instructor_id
                          or exists (select 1 from request_instructors ri where ri.request_id = q.id and ri.instructor_id = k.instructor_id)
                        then q.guest_phone end,
    'experience', q.experience,
    'instructors', coalesce((
      select json_agg(json_build_object('id', i.id, 'name', i.name) order by i.sort, i.name)
      from request_instructors ri join instructors i on i.id = ri.instructor_id
      where ri.request_id = q.id), '[]'::json),
    'horses_count', q.horses_count,
    'source', q.source,
    'created_at', q.created_at
  );
$$;

create or replace function team_whoami(p_key text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('role', k.role, 'instructor_id', k.instructor_id, 'name', i.name)
  from _auth(p_key) k left join instructors i on i.id = k.instructor_id;
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
        'key', r.key, 'name', r.name, 'duration_min', r.duration_min,
        'slots', (select json_agg(to_char(s, 'HH24:MI') order by s) from unnest(r.slots) s))
        order by r.duration_min) from routes r)
  ) from k;
$$;

-- Заявки за период: «Новые заявки» у главного (p_status='pending') и «Мои выезды» у инструктора (p_mine).
create or replace function team_requests(p_key text, p_from date, p_to date, p_status text default null, p_mine bool default false)
returns json
language sql stable security definer set search_path = public as $$
  with k as (select * from _auth(p_key))
  select coalesce(json_agg(_request_json(q, k) order by q.day, q.start_time, q.created_at), '[]'::json)
  from requests q, k
  where q.day between p_from and least(p_to, p_from + 62)
    and q.status <> 'rejected'
    and (p_status is null or q.status = p_status)
    and (not p_mine or exists (select 1 from request_instructors ri where ri.request_id = q.id and ri.instructor_id = k.instructor_id));
$$;

create or replace function team_request(p_key text, p_id uuid) returns json
language sql stable security definer set search_path = public as $$
  select _request_json(q, k) from _auth(p_key) k, requests q where q.id = p_id;
$$;

create or replace function team_create_request(
  p_key text, p_route text, p_day date, p_start time, p_people int,
  p_name text, p_phone text, p_experience text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare k access_keys := _auth(p_key);
begin
  return _insert_request(p_route, p_day, p_start, p_people, p_name, p_phone, p_experience, 'instructor', k.instructor_id);
end;
$$;

revoke all on function _auth(text) from public, anon, authenticated;
revoke all on function _request_json(requests, access_keys) from public, anon, authenticated;
revoke all on function team_whoami(text) from public;
revoke all on function team_day(text, date) from public;
revoke all on function team_requests(text, date, date, text, bool) from public;
revoke all on function team_request(text, uuid) from public;
revoke all on function team_create_request(text, text, date, time, int, text, text, text) from public;
grant execute on function team_whoami(text), team_day(text, date), team_requests(text, date, date, text, bool),
  team_request(text, uuid), team_create_request(text, text, date, time, int, text, text, text) to anon, authenticated;

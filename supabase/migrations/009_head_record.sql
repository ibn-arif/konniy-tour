-- Главный записывает гостя, который пришёл не через сайт: звонок, WhatsApp, лично.
-- source = 'head', а channel хранит, откуда пришла заявка (необязательно, до 40 символов).

alter table requests drop constraint requests_source_check;
alter table requests add constraint requests_source_check check (source in ('site', 'instructor', 'head'));
alter table requests add column channel text check (length(channel) <= 40);

drop function team_create_request(text, text, date, time, int, text, text, text);
create function team_create_request(
  p_key text, p_route text, p_day date, p_start time, p_people int,
  p_name text, p_phone text, p_experience text default null, p_channel text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  k access_keys := _auth(p_key);
  v_channel text := nullif(btrim(coalesce(p_channel, '')), '');
  v_id uuid;
begin
  if length(v_channel) > 40 then
    raise exception using errcode = 'P0001', message = 'Слишком длинное «Откуда»';
  end if;
  v_id := _insert_request(p_route, p_day, p_start, p_people, p_name, p_phone, p_experience,
                          case when k.role = 'head' then 'head' else 'instructor' end, k.instructor_id);
  if v_channel is not null then
    update requests set channel = v_channel where id = v_id;
    update request_events set details = details || jsonb_build_object('channel', v_channel)
    where request_id = v_id and action = 'created';
  end if;
  return v_id;
end;
$$;

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
    'channel', q.channel,
    'created_at', q.created_at
  );
$$;

revoke all on function _request_json(requests, access_keys) from public, anon, authenticated;
revoke all on function team_create_request(text, text, date, time, int, text, text, text, text) from public;
grant execute on function team_create_request(text, text, date, time, int, text, text, text, text) to anon, authenticated;

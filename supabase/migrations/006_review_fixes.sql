-- Исправления после ревью: ключи ушедших инструкторов, выходной и отключение при подтверждённых выездах, общий предел заявок с сайта.

-- Ключ инструктора, которого отметили «не работает», больше не открывает расписание.
create or replace function _auth(p_key text) returns access_keys
language plpgsql stable security definer set search_path = public as $$
declare k access_keys;
begin
  select a.* into k from access_keys a
  left join instructors i on i.id = a.instructor_id
  where a.key_hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex')
    and a.revoked_at is null
    and (a.role = 'head' or i.active);
  if not found then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  return k;
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
  return v_id;
end;
$$;

create or replace function head_set_day_off(p_key text, p_kind text, p_id uuid, p_day date, p_off bool) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _head(p_key);
  if p_kind = 'instructor' then
    if p_off and exists (
      select 1 from requests q join request_instructors ri on ri.request_id = q.id
      where ri.instructor_id = p_id and q.day = p_day and q.status = 'confirmed'
    ) then
      raise exception using errcode = 'P0001', message = 'У инструктора в этот день подтверждённые выезды — сначала перенесите их или назначьте другого';
    end if;
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
  if p_id is not null and p_active = false and exists (
    select 1 from requests q join request_instructors ri on ri.request_id = q.id
    where ri.instructor_id = p_id and q.status = 'confirmed' and q.day >= _now_msk()::date
  ) then
    raise exception using errcode = 'P0001', message = 'У инструктора есть подтверждённые выезды впереди — сначала перенесите их или назначьте другого';
  end if;
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

revoke all on function _auth(text) from public, anon, authenticated;
revoke all on function _insert_request(text, date, time, int, text, text, text, text, uuid) from public, anon, authenticated;

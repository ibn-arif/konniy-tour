-- Расписание Konniy Tour: таблицы и начальные данные.
-- Все таблицы закрыты RLS без политик; доступ только через функции security definer.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgtap with schema extensions;

create table instructors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  active bool not null default true,
  sort int not null default 0
);

create table horses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active bool not null default true,
  sort int not null default 0
);

create table routes (
  key text primary key,
  name text not null,
  duration_min int not null check (duration_min > 0),
  slots time[] not null
);

create table instructor_days_off (
  instructor_id uuid not null references instructors(id) on delete cascade,
  day date not null,
  primary key (instructor_id, day)
);

create table horse_rest_days (
  horse_id uuid not null references horses(id) on delete cascade,
  day date not null,
  primary key (horse_id, day)
);

create table requests (
  id uuid primary key default gen_random_uuid(),
  route_key text not null references routes(key),
  day date not null,
  start_time time not null,
  people int not null check (people between 1 and 10),
  guest_name text not null,
  guest_phone text not null,
  experience text,
  source text not null check (source in ('site', 'instructor')),
  created_by uuid references instructors(id),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  horses_count int check (horses_count > 0),
  created_at timestamptz not null default now()
);
create index requests_day_idx on requests (day) where status <> 'rejected';

create table request_instructors (
  request_id uuid not null references requests(id) on delete cascade,
  instructor_id uuid not null references instructors(id),
  primary key (request_id, instructor_id)
);

create table access_keys (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('head', 'instructor')),
  instructor_id uuid references instructors(id),
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check ((role = 'instructor') = (instructor_id is not null))
);

alter table instructors enable row level security;
alter table horses enable row level security;
alter table routes enable row level security;
alter table instructor_days_off enable row level security;
alter table horse_rest_days enable row level security;
alter table requests enable row level security;
alter table request_instructors enable row level security;
alter table access_keys enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;

insert into routes (key, name, duration_min, slots) values
  ('short',  'На смотровую', 60,  array['09:00','10:30','12:00','13:30','15:00','16:30']::time[]),
  ('trails', 'По живописным тропам', 120, array['09:00','11:30','14:00']::time[]),
  ('long',   'Дальний маршрут в горы', 420, array['08:00']::time[]);

insert into instructors (name, sort) select 'Инструктор ' || n, n from generate_series(1, 4) n;
insert into horses (name, sort) select 'Лошадь ' || n, n from generate_series(1, 10) n;

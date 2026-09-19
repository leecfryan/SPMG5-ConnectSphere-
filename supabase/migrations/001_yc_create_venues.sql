-- 001_yc_create_venues.sql
-- SCRUM-15 (view catalogue), SCRUM-16 (update operating info)

create extension if not exists "pgcrypto";

create table if not exists public.venues (
  id                     uuid primary key default gen_random_uuid(),

  -- SCRUM-82: location and capacity
  name                   text not null,
  address                text not null,
  city                   text not null,
  country                text not null,
  capacity               integer not null check (capacity > 0),

  -- SCRUM-83: facilities, accessibility, room layouts
  facilities             text[] not null default '{}',
  accessibility_features text[] not null default '{}',
  room_layouts           text[] not null default '{}',

  -- SCRUM-84 / SCRUM-89: operating information
  operating_hours        jsonb not null default '{}'::jsonb,

  -- SCRUM-90: setup, teardown, turnaround
  setup_minutes          integer not null default 0 check (setup_minutes >= 0),
  teardown_minutes       integer not null default 0 check (teardown_minutes >= 0),
  turnaround_minutes     integer not null default 0 check (turnaround_minutes >= 0),

  notes                  text,
  is_active              boolean not null default true,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- lets SCRUM-91 prove updates are reflected
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists venues_set_updated_at on public.venues;
create trigger venues_set_updated_at
  before update on public.venues
  for each row execute function public.set_updated_at();

-- blocks browser access; the backend uses the secret key and bypasses this
alter table public.venues enable row level security;
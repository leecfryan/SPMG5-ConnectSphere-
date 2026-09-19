-- 003_yc_create_venue_bookings.sql
-- SCRUM-17 view venue availability calendar
--   SCRUM-92 calendar reflects existing bookings
--   SCRUM-93 calendar reflects recorded unavailable periods
--   SCRUM-94 a confirmed booking affects availability for that period
--   SCRUM-95 AM / PM / Night slots, a full day booking occupies all three

-- a gist index over plain equality columns (uuid, date, enum) needs btree_gist
create extension if not exists btree_gist;

-- SCRUM-95: availability is stored per slot, never as free-form timestamps.
-- A full day booking is three rows (am, pm, night). Storing it that way keeps
-- the no-double-booking rule a plain equality check instead of range maths.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'venue_slot') then
    create type public.venue_slot as enum ('am', 'pm', 'night');
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'booking_status') then
    create type public.booking_status as enum
      ('pending', 'confirmed', 'rejected', 'cancelled');
  end if;
end
$$;

-- SCRUM-92: the bookings the calendar reads.
-- Creating rows here is SCRUM-21, not this story. SCRUM-17 only displays them.
create table if not exists public.venue_bookings (
  id           uuid primary key default gen_random_uuid(),
  venue_id     uuid not null references public.venues(id) on delete cascade,
  booking_date date not null,
  slot         public.venue_slot not null,
  status       public.booking_status not null default 'pending',
  event_name   text not null,
  requested_by text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- SCRUM-94: only a confirmed booking consumes the slot. Pending requests may
-- stack until Venue Staff decide, which is what SCRUM-21 will create.
--
-- This lives in Postgres rather than in the Node layer on purpose. Two
-- coordinators confirming the same slot at the same moment would both pass an
-- application-level "is it free?" check, because that check and the insert are
-- not atomic. The database constraint cannot be raced.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'venue_bookings_no_double_booking'
  ) then
    alter table public.venue_bookings
      add constraint venue_bookings_no_double_booking
      exclude using gist (
        venue_id     with =,
        booking_date with =,
        slot         with =
      ) where (status = 'confirmed');
  end if;
end
$$;

-- SCRUM-93: periods Venue Staff record as unavailable, independent of bookings
-- (maintenance, private hire, public holiday).
create table if not exists public.venue_unavailability (
  id               uuid primary key default gen_random_uuid(),
  venue_id         uuid not null references public.venues(id) on delete cascade,
  unavailable_date date not null,
  slot             public.venue_slot not null,
  reason           text not null,
  created_at       timestamptz not null default now()
);

-- the same slot recorded unavailable twice is a data entry mistake
create unique index if not exists venue_unavailability_unique_slot
  on public.venue_unavailability (venue_id, unavailable_date, slot);

-- the calendar always queries one venue over a date range
create index if not exists venue_bookings_lookup
  on public.venue_bookings (venue_id, booking_date);
create index if not exists venue_unavailability_lookup
  on public.venue_unavailability (venue_id, unavailable_date);

-- reuses the trigger function created in 001_yc_create_venues.sql
drop trigger if exists venue_bookings_set_updated_at on public.venue_bookings;
create trigger venue_bookings_set_updated_at
  before update on public.venue_bookings
  for each row execute function public.set_updated_at();

-- blocks browser access, the backend uses the secret key and bypasses this
alter table public.venue_bookings enable row level security;
alter table public.venue_unavailability enable row level security;

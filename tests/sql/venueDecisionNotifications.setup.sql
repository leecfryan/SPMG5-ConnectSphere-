-- SCRUM-41: the venue tables the decision trigger reads, added to the existing
-- notification fixture. Only the columns the trigger touches, so the fixture
-- stays readable and does not pretend to mirror the real schema.
--
-- slot and status are declared as the real enum types, not text. The trigger
-- concatenates and sorts them, and enum concatenation resolves through
-- different operators than text does, so a text stub would not prove the
-- function runs against the real schema.
create type public.venue_slot as enum ('am', 'pm', 'night');
create type public.booking_status as enum ('pending', 'confirmed', 'rejected', 'cancelled', 'hold', 'superseded');

alter table public.events add column coordinator_id uuid;

create table public.venues (
  id uuid primary key,
  name text not null
);

create table public.venue_booking_requests (
  id uuid primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  booking_date date not null,
  requested_by uuid,
  decided_at timestamptz,
  decision_note text
);

create table public.venue_bookings (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.venue_booking_requests(id) on delete cascade,
  slot public.venue_slot not null,
  status public.booking_status not null
);

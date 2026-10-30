-- SCRUM-41: the venue tables the decision trigger reads, added to the existing
-- notification fixture. Only the columns the trigger touches, so the fixture
-- stays readable and does not pretend to mirror the real schema.
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
  slot text not null check (slot in ('am', 'pm', 'night')),
  status text not null check (status in ('pending', 'confirmed', 'rejected', 'cancelled'))
);

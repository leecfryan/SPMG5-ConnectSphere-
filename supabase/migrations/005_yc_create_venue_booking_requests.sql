-- 005_yc_create_venue_booking_requests.sql
-- SCRUM-21 submit venue booking request
--   SCRUM-85 request is associated with the relevant event and selected venue
--   SCRUM-86 request contains event timing for Venue Staff to assess
--   SCRUM-87 request contains relevant venue requirements
--   SCRUM-88 submitted request is available to Venue Staff for review
--
-- Depends on:
--   001_yc_create_venues.sql          venues, set_updated_at()
--   003_yc_create_venue_bookings.sql  venue_bookings, venue_slot, exclusion constraint
--   public.events                     owned by the event request feature
--                                     (feature/eventRequest), referenced the same
--                                     way 003_kl_create_equipment.sql does

-- One row per request. It holds everything that belongs to the request as a
-- whole. The slots themselves are NOT stored here: each requested slot becomes
-- a pending row in venue_bookings, pointing back at this request. That way the
-- calendar from SCRUM-17 shows new requests with no extra code, and the
-- double-booking exclusion constraint still applies once Venue Staff confirm.
create table if not exists public.venue_booking_requests (
  id                          uuid primary key default gen_random_uuid(),

  -- SCRUM-85
  venue_id                    uuid not null references public.venues(id) on delete cascade,
  event_id                    uuid not null references public.events(id) on delete cascade,

  -- SCRUM-86: the day being requested. The slots live on venue_bookings rows.
  -- The event's own start_time / end_time are read from public.events at review
  -- time rather than copied here, so Venue Staff always see the current timing.
  booking_date                date not null,

  -- SCRUM-87
  expected_attendees          integer not null check (expected_attendees > 0),
  room_layout                 text not null,
  required_facilities         text[] not null default '{}',
  accessibility_requirements  text[] not null default '{}',
  additional_requirements     text,

  -- Null until real authentication is merged (SCRUM-13). Then it is filled from
  -- the verified session, never from request input.
  requested_by                uuid references auth.users(id),

  submitted_at                timestamptz not null default now(),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- SCRUM-88: Venue Staff review newest first, and look requests up by venue
create index if not exists venue_booking_requests_submitted
  on public.venue_booking_requests (submitted_at desc);
create index if not exists venue_booking_requests_venue_date
  on public.venue_booking_requests (venue_id, booking_date);
create index if not exists venue_booking_requests_event
  on public.venue_booking_requests (event_id);

drop trigger if exists venue_booking_requests_set_updated_at
  on public.venue_booking_requests;
create trigger venue_booking_requests_set_updated_at
  before update on public.venue_booking_requests
  for each row execute function public.set_updated_at();

-- Links each slot row back to the request that created it. Nullable because
-- the seed bookings from 004_yc_seed_bookings.sql were not made by a request.
alter table public.venue_bookings
  add column if not exists request_id uuid
  references public.venue_booking_requests(id) on delete cascade;

create index if not exists venue_bookings_request
  on public.venue_bookings (request_id);

-- Writes the request and all of its slot rows in ONE transaction.
--
-- supabase-js cannot run a multi-statement transaction from Node. Doing two
-- separate inserts from the backend would leave a request with no slots, or
-- slots with no request, if the second insert failed. A plpgsql function body
-- is atomic, so either everything is written or nothing is.
--
-- All validation happens in the backend before this is called. The function
-- trusts its inputs, which is why only the backend may execute it (see the
-- grants at the bottom).
create or replace function public.submit_venue_booking_request(
  p_venue_id                   uuid,
  p_event_id                   uuid,
  p_event_name                 text,
  p_booking_date               date,
  p_slots                      text[],
  p_expected_attendees         integer,
  p_room_layout                text,
  p_required_facilities        text[],
  p_accessibility_requirements text[],
  p_additional_requirements    text
)
returns uuid
language plpgsql
as $$
declare
  v_request_id uuid;
begin
  insert into public.venue_booking_requests (
    venue_id, event_id, booking_date, expected_attendees, room_layout,
    required_facilities, accessibility_requirements, additional_requirements
  ) values (
    p_venue_id, p_event_id, p_booking_date, p_expected_attendees, p_room_layout,
    coalesce(p_required_facilities, '{}'),
    coalesce(p_accessibility_requirements, '{}'),
    p_additional_requirements
  )
  returning id into v_request_id;

  -- SCRUM-94 carries over: a request is pending, so it shows on the calendar
  -- as Requested but does not consume the slot until Venue Staff confirm it.
  -- The text[] is cast here rather than typed as venue_slot[] in the signature,
  -- because PostgREST passes JSON arrays through as text.
  insert into public.venue_bookings
    (venue_id, booking_date, slot, status, event_name, requested_by, request_id)
  select
    p_venue_id,
    p_booking_date,
    requested_slot::public.venue_slot,
    'pending',
    p_event_name,
    'booking-request',
    v_request_id
  from unnest(p_slots) as requested_slot;

  return v_request_id;
end;
$$;

-- Supabase lets anon and authenticated call public functions through the REST
-- API by default. This one skips validation, so only the backend (service role)
-- may run it.
revoke execute on function public.submit_venue_booking_request(
  uuid, uuid, text, date, text[], integer, text, text[], text[], text
) from public, anon, authenticated;

grant execute on function public.submit_venue_booking_request(
  uuid, uuid, text, date, text[], integer, text, text[], text[], text
) to service_role;

-- blocks browser access, the backend uses the secret key and bypasses this
alter table public.venue_booking_requests enable row level security;

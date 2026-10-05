# Venue integration with sign-in and event requests

This integration preserves main's shared authentication, account page, staff
responsibilities, organiser event submission, Docker configuration and tests.
The Venue branch contributes its catalogue, operating information, calendar,
booking form, request review, validation and SQL schema references.

## Routes and permissions

Every route below requires verified sign-in, `internal.access` and `venues.read`.
The backend independently verifies the bearer token against Supabase on each
request. Roles come only from `app_metadata.roles`; the temporary `x-user-role`
middleware and hardcoded development roles have been removed.

| Frontend URL | Additional capability | Roles |
| --- | --- | --- |
| `/venues` | None | Venue Staff, Event Coordinator |
| `/venues/:id` | None | Venue Staff, Event Coordinator |
| `/venues/:id/availability` | None | Venue Staff, Event Coordinator |
| `/venues/:id/edit` | `venues.update` | Venue Staff, Event Coordinator |
| `/venues/:id/booking-request` | `bookings.request` | Event Coordinator |
| `/venues/booking-requests` | `bookings.read` | Venue Staff, Event Coordinator |
| `/venues/booking-requests` decide controls | `bookings.decide` | Venue Staff |

These are React Router pages with direct links and browser Back/refresh support.
Shared navigation and sign-out stay available. All calls use relative `/api/venues`
URLs through the existing proxy; there is no hardcoded localhost API address.
Frontend visibility is only a convenience; the API enforces each operation.

`GET /api/venues` and `GET /api/venues/:id` retain filters and venue fields.
`PATCH /api/venues/:id` retains the branch's field validation and update behavior.
`GET /api/venues/:id/availability` retains confirmed, requested, unavailable and
closed slots, date windows and AM/PM/Night handling. Catalogue and calendar access
are not restricted to an assigned venue or location. Coordinators see generic
occupied-slot labels instead of other events' names; venue staff keep event labels.

`GET /api/venues/booking-events` returns upcoming, approved (`APPROVED` or `CONFIRMED`, `PLANNING_STATUSES` in `events/lifecycle.js`) events assigned to
the verified coordinator through the existing `events.coordinator_id` column.
`POST /api/venues/:id/booking-requests` checks that same relationship, validates
requirements and slot conflicts, and supplies the verified requester ID to the
database. Submitted requests remain pending and do not consume confirmed slots.

Venue Staff can review venue requests across locations. For coordinators, both
`GET /api/venues/booking-requests` and `GET /api/venues/booking-requests/:id`
filter by their assigned events. The router establishes this scope from the
verified identity; the database service applies it using an inner event join.
Responses select venue requirements and event name/timing/status, not whole
client, attendee or internal planning records. Managers assign events through `/event-management`.
An unassigned event will not appear in a coordinator's picker.

## Deciding a request (SCRUM-22)

`PATCH /api/venues/booking-requests/:requestId/decision` takes
`{ decision: "confirmed" | "rejected", note?: string }` and requires the new
`bookings.decide` permission, held by Venue Staff only. Coordinators keep
`bookings.read`, so they see the outcome on their own requests but cannot
decide them. The reviewer identity comes from the verified session; a
`decided_by` sent in the body is rejected with the other unknown fields.

The decision is applied by `decide_venue_booking_request` (SQL recorded below),
which records `decided_by`, `decided_at` and `decision_note` on the request and
writes the decision to every one of its slot rows in one transaction, so a
request is never half decided. Cancelled slots are left alone: a coordinator
withdrawing a request is not something a later staff decision should undo.

Approving writes `confirmed`, which is where the exclusion constraint from
003 applies. If another request already holds one of those slots, Postgres
rejects the whole statement (SQLSTATE 23P01), nothing changes, and the API
returns 409 rather than 500.

## Blocking a conflicting booking (SCRUM-20)

The block itself is the database constraint described above, not a check in the
backend, because a check followed by a write can always be overtaken between the
two. SCRUM-20 adds the part the constraint cannot do on its own: saying which
slot clashed, and making sure nobody can approve past it.

After a 23P01 refusal the controller re-reads the request and that day's slot
rows and runs `findConfirmedSlotConflicts`, so the 409 names each clashing slot
and the event holding it, for example
`am on 2026-10-14 is already confirmed for "Charity gala"`. A slot already held
by the request's own event is not counted as a clash. If that lookup fails for
any reason the response falls back to the plain message, because explaining a
refusal must never turn it into a 500.

There is deliberately no override, force or priority field on a decision. The
decision allowlist accepts `decision` and `note` and refuses anything else, so
an approval cannot be pushed through a conflict on the grounds that the
requester matters.

In the review list a 409 is treated as an answer rather than a failure: the
decide buttons are replaced by the named conflict, a note that the request is
unchanged and still pending, and a Refresh list action. On the coordinator side
a slot that is already booked is shown with the event holding it and cannot be
selected, and other slots on the same day stay bookable.

A rejection records the decision and nothing else: any resulting booking change
is made by the Event Coordinator, so no counter-offer is applied automatically.

## Rejecting with a reason (SCRUM-102)

A rejection must carry a reason. `validateDecision` refuses a `rejected`
decision whose note is missing, null, not text, or only whitespace, and returns
400 before anything is written. Approving still needs no note, because no
acceptance criterion has asked staff to justify a yes. That one function is the
only place the rule lives.

The suggested alternative shares the same note rather than having a column of
its own. SCRUM-102 says Venue Staff *may* attach a suggested venue or
arrangement, which free text satisfies, and a separate column would mean a hand
made schema change on a shared database plus a field in four layers that nothing
queries. If the team ever needs to report on alternatives separately, that is a
new story and a new column.

The note is trimmed and stored in `decision_note`, returned by both request
endpoints and shown in the Decision block on the request card, so the requesting
coordinator reads the reason and the suggestion without a separate conversation.
In the reject form the reason is required: Confirm rejection stays disabled
until something is typed, and the hint says so.

A rejected request stays in the booking history. `listBookingRequests` applies
no status filter, so the Rejected and All filters still show it with its reason.
Its slot rows leave the calendar, because only pending and confirmed bookings
are drawn. That is the intended split: rejecting frees the slot without erasing
the record of what was asked for and why it was refused.

## Searching and filtering the catalogue (SCRUM-18)

`GET /api/venues` accepts seven filters, and refuses any other query parameter
with 400 rather than ignoring it, so a typo surfaces instead of quietly
returning the whole catalogue.

| Filter | Meaning |
| --- | --- |
| `city` | Case-insensitive match on the venue's city |
| `minCapacity` | A positive whole number; the venue seats at least this many |
| `facilities` | Comma separated; the venue offers **all** of them |
| `accessibility` | Comma separated; the venue offers **all** of them |
| `roomLayout` | The venue supports this layout |
| `date` | `YYYY-MM-DD`; the venue is free that day |
| `slots` | Comma separated `am`, `pm`, `night`; needs a `date` |

Everything stored on the venue row is filtered by Postgres. `facilities`,
`accessibility` and `roomLayout` use array containment, so asking for a
projector and a stage returns venues with both, not either.

Date availability cannot be a column filter, because it depends on
`venue_bookings` and `venue_unavailability`. The controller applies it after
the shortlist comes back: one query for that day's bookings and one for its
blocked periods across every candidate, then `buildAvailabilityCalendar` from
SCRUM-17 decides each venue. A venue is kept when every requested slot is
`available` or `pending`, which is the same list a booking request is allowed
on, so "free" means one thing across the lane. A pending request therefore
leaves a venue in the results: only a confirmed booking takes a slot. A date
with no slots means every slot that day must be open.

Two queries cover the whole shortlist however many venues match, rather than a
round trip per venue.

SCRUM-18 says searching identifies potential venues but does not replace the
separate suitability assessment, so the response carries no score and no
ranking, and the order is the catalogue's own. The catalogue page says the same
in words above the results.

## Database deployment

The root `.env` must contain the existing `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY` and server-only `SUPABASE_SECRET_KEY`. Missing venue
storage configuration returns 503 without preventing sign-in or account access.

The venue schema is already deployed on the team's shared Supabase database.
The earlier venue migration files have been replaced by the SQL reference below;
RBAC's existing event-review SQL reference 007 remains separate. Schema changes are applied by hand in the
dashboard, and the SQL that produced the current schema is kept in
*Venue schema reference* at the end of this guide.

Deploy order matters only when rebuilding from nothing: venues, then bookings
and unavailability, then booking requests (which need the event feature's
`public.events` table), then the two functions (the authenticated booking
wrapper needs `events.coordinator_id`). Do not reset existing tables or
re-seed a shared database.

Migration 006 adds a service-role-only wrapper around the existing atomic booking
RPC. It rechecks the event assignment and records the verified requester on both
the request and its slots in one transaction. Existing rows, the original RPC,
RLS and the confirmed-slot exclusion constraint remain intact. The browser
cannot call the wrapper directly. Deploy 006 before using the new booking API;
GitHub merging and Docker restarts do not apply SQL automatically.

## Integration checks

The added Vitest suites cover 24 API/storage cases: all venue endpoints reject
anonymous, invalid and unrelated identities; forged role and ownership fields
cannot grant access; venue editing and availability retain their behavior;
booking queries apply coordinator scope; request ownership comes from auth;
missing configuration leaves sign-in available.

Six Playwright cases cover protected direct links, catalogue filters, editing,
page refresh and Back, staff/coordinator controls, and an event submitted through
the real event API flowing into a coordinator booking and staff review.
The test assignment endpoint and in-memory storage exist only in test support.
Production controllers, validation, auth and routes are used by the tests.

Frontend lint/build and backend lint are checked. Existing tests are retained;
their exact Venue Staff capability expectations now include `venues.update`.
GitHub CI runs the combined existing and new suites on the merge result.
The tests substitute Supabase storage and do not prove the team's live schema,
migration deployment, grants or database contents. Those require a live check.

## Venue schema reference

Every statement below is already applied to the shared database. It is recorded
here so the schema can be read, reviewed and rebuilt without a migrations
folder, per the no-migration-files rule in [AGENTS.md](../AGENTS.md). Run any of
it by hand in the Supabase SQL Editor; each statement is written to be safe to
re-run.

### Venues table and the shared set_updated_at() trigger

```sql
-- Venues
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
```

### Bookings, unavailability, slot types and the no-double-booking constraint

```sql
-- Bookings and unavailability
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

-- reuses the set_updated_at() trigger function defined above
drop trigger if exists venue_bookings_set_updated_at on public.venue_bookings;
create trigger venue_bookings_set_updated_at
  before update on public.venue_bookings
  for each row execute function public.set_updated_at();

-- blocks browser access, the backend uses the secret key and bypasses this
alter table public.venue_bookings enable row level security;
alter table public.venue_unavailability enable row level security;
```

### Booking requests and the atomic submit function

```sql
-- Booking requests
-- SCRUM-21 submit venue booking request
--   SCRUM-85 request is associated with the relevant event and selected venue
--   SCRUM-86 request contains event timing for Venue Staff to assess
--   SCRUM-87 request contains relevant venue requirements
--   SCRUM-88 submitted request is available to Venue Staff for review
--
-- Depends on:
--   venues, set_updated_at()
--   venue_bookings, venue_slot, exclusion constraint
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
-- the demo bookings below were not made through a request.
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
```

### Authenticated submit wrapper, which records the verified requester

```sql
-- Apply after 005. Keeps its atomic request/slot creation and adds verified
-- requester attribution. The backend alone supplies p_requested_by after auth.
-- Existing requests and the original function remain intact.
create or replace function public.submit_authenticated_venue_booking_request(
  p_venue_id uuid,
  p_event_id uuid,
  p_event_name text,
  p_booking_date date,
  p_slots text[],
  p_expected_attendees integer,
  p_room_layout text,
  p_required_facilities text[],
  p_accessibility_requirements text[],
  p_additional_requirements text,
  p_requested_by uuid
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_request_id uuid;
begin
  if p_requested_by is null then
    raise exception 'Verified requester is required';
  end if;

  -- Recheck the trusted event relationship inside the write transaction.
  perform 1 from public.events
    where id = p_event_id and coordinator_id = p_requested_by
    for share;
  if not found then
    raise exception 'Event is not assigned to this coordinator';
  end if;

  v_request_id := public.submit_venue_booking_request(
    p_venue_id, p_event_id, p_event_name, p_booking_date, p_slots,
    p_expected_attendees, p_room_layout, p_required_facilities,
    p_accessibility_requirements, p_additional_requirements
  );
  update public.venue_booking_requests
    set requested_by = p_requested_by where id = v_request_id;
  update public.venue_bookings
    set requested_by = p_requested_by::text where request_id = v_request_id;
  return v_request_id;
end;
$$;

revoke execute on function public.submit_authenticated_venue_booking_request(
  uuid, uuid, text, date, text[], integer, text, text[], text[], text, uuid
) from public, anon, authenticated;
grant execute on function public.submit_authenticated_venue_booking_request(
  uuid, uuid, text, date, text[], integer, text, text[], text[], text, uuid
) to service_role;
```

### Decision columns and decide_venue_booking_request() (SCRUM-22)

```sql
-- Booking decisions
-- SCRUM-22 decide venue booking request
--   Venue Staff can approve an acceptable booking request.
--   Venue Staff can reject a request that cannot be accepted.
--   A rejection may carry information, a reason or a suggested alternative.
--   Any resulting booking change is made by the Event Coordinator, so a
--   rejection records the decision and nothing else. Nothing is rebooked here.
--
-- Apply after 005 and 006.

-- Who decided, when, and anything they wrote with it. decision_note is
-- deliberately nullable: SCRUM-22 makes it optional, and SCRUM-102 will require
-- one for rejections without needing another migration.
alter table public.venue_booking_requests
  add column if not exists decided_by uuid references auth.users(id),
  add column if not exists decided_at timestamptz,
  add column if not exists decision_note text;

-- SCRUM-88: Venue Staff sort their queue by what is still undecided
create index if not exists venue_booking_requests_decided
  on public.venue_booking_requests (decided_at);

-- Records the decision on the request and applies it to every slot row in ONE
-- transaction, so a request can never be half decided.
--
-- Approving writes 'confirmed' to the slot rows, which is what makes the
-- exclusion constraint from 003 bite: if another request already holds one of
-- these slots, the whole statement is rejected and nothing changes. That is the
-- guarantee behind SCRUM-20, enforced by Postgres rather than by a check the
-- backend could race past.
create or replace function public.decide_venue_booking_request(
  p_request_id uuid,
  p_decision   text,
  p_decided_by uuid,
  p_note       text
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_exists boolean;
begin
  if p_decided_by is null then
    raise exception 'Verified reviewer is required';
  end if;
  if p_decision not in ('confirmed', 'rejected') then
    raise exception 'Decision must be confirmed or rejected';
  end if;

  select true into v_exists
  from public.venue_booking_requests
  where id = p_request_id
  for update;

  if not found then
    return null;
  end if;

  update public.venue_booking_requests
  set decided_by = p_decided_by,
      decided_at = now(),
      decision_note = p_note,
      updated_at = now()
  where id = p_request_id;

  -- Cancelled slots stay cancelled: a coordinator withdrawing a request is not
  -- something a later staff decision should quietly undo.
  update public.venue_bookings
  set status = p_decision::public.booking_status
  where request_id = p_request_id
    and status <> 'cancelled';

  return p_request_id;
end;
$$;

-- Validation lives in the backend, so only the backend may call this.
revoke execute on function public.decide_venue_booking_request(uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.decide_venue_booking_request(uuid, text, uuid, text)
  to service_role;
```

### Demonstration data

The two blocks below are test data, not schema. They are what the manual test
guides in the team's TESTS sheet expect to find. The booking seed anchors its
dates to the next Monday, so re-running it refreshes dates that have gone stale.

#### Demonstration venues

```sql
-- Demo venues
-- Development seed data for SCRUM-15

insert into public.venues
  (name, address, city, country, capacity, facilities,
   accessibility_features, room_layouts, operating_hours,
   setup_minutes, teardown_minutes, turnaround_minutes, notes)
values
  ('Marina Grand Ballroom',
   '10 Bayfront Avenue', 'Singapore', 'Singapore', 500,
   '{"Stage","AV system","Wi-Fi","Catering kitchen"}',
   '{"Step-free access","Accessible restrooms","Hearing loop"}',
   '{"Theatre","Banquet","Cabaret"}',
   '{"mon":{"open":"08:00","close":"22:00"},
     "tue":{"open":"08:00","close":"22:00"},
     "wed":{"open":"08:00","close":"22:00"},
     "thu":{"open":"08:00","close":"22:00"},
     "fri":{"open":"08:00","close":"23:00"},
     "sat":{"open":"10:00","close":"23:00"},
     "sun":{"closed":true}}'::jsonb,
   120, 90, 60, 'Loading bay available at basement level.'),

  ('Orchard Seminar Room 3',
   '350 Orchard Road', 'Singapore', 'Singapore', 60,
   '{"Projector","Whiteboard","Wi-Fi"}',
   '{"Step-free access","Lift access"}',
   '{"Classroom","U-shape","Boardroom"}',
   '{"mon":{"open":"09:00","close":"18:00"},
     "tue":{"open":"09:00","close":"18:00"},
     "wed":{"open":"09:00","close":"18:00"},
     "thu":{"open":"09:00","close":"18:00"},
     "fri":{"open":"09:00","close":"18:00"},
     "sat":{"closed":true},
     "sun":{"closed":true}}'::jsonb,
   30, 30, 15, null),

  ('KLCC Conference Hall A',
   'Jalan Ampang', 'Kuala Lumpur', 'Malaysia', 220,
   '{"Stage","AV system","Wi-Fi","Breakout rooms"}',
   '{"Step-free access","Accessible restrooms"}',
   '{"Theatre","Banquet"}',
   '{"mon":{"open":"08:30","close":"21:00"},
     "tue":{"open":"08:30","close":"21:00"},
     "wed":{"open":"08:30","close":"21:00"},
     "thu":{"open":"08:30","close":"21:00"},
     "fri":{"open":"08:30","close":"21:00"},
     "sat":{"open":"09:00","close":"17:00"},
     "sun":{"closed":true}}'::jsonb,
   90, 60, 45, 'Shared loading dock with adjacent hall.');
```

#### Demonstration bookings and unavailable periods

```sql
-- Demo bookings
-- Dev data for SCRUM-17.
-- Safe to re-run: seed rows are tagged and removed first.
--
-- Every row is anchored to the NEXT MONDAY rather than to a raw offset from
-- current_date. That matters because "closed" outranks every other state on
-- the calendar: a booking or unavailable period placed on a day the venue is
-- shut renders as Closed and the row becomes invisible. All three venues are
-- open Monday to Friday, so anchoring to Monday keeps the seed meaningful on
-- whichever day it happens to be run.
--   date_trunc('week', ...) returns the Monday of the current week in Postgres,
--   so + 7 is always the Monday that is still ahead of us.

-- SCRUM-92 existing bookings, SCRUM-94 confirmed vs pending, SCRUM-95 full day
delete from public.venue_bookings where requested_by = 'seed';
delete from public.venue_unavailability where reason like 'Seed:%';

insert into public.venue_bookings
  (venue_id, booking_date, slot, status, event_name, requested_by)
select
  v.id,
  (date_trunc('week', current_date)::date + 7) + b.weekday_offset,
  b.slot::public.venue_slot,
  b.status::public.booking_status,
  b.event_name,
  'seed'
from (values
  -- Monday
  ('Orchard Seminar Room 3',  0, 'am',    'confirmed', 'IS212 Sprint Review'),

  -- Tuesday, half day across two adjacent slots
  ('Marina Grand Ballroom',   1, 'am',    'confirmed', 'Freshman Orientation'),
  ('Marina Grand Ballroom',   1, 'pm',    'confirmed', 'Freshman Orientation'),

  -- Wednesday, SCRUM-94: pending shows on the calendar but does NOT consume
  -- the slot, so these two stay bookable
  ('Marina Grand Ballroom',   2, 'pm',    'pending',   'Alumni Mixer'),
  ('Orchard Seminar Room 3',  2, 'pm',    'pending',   'Study Group'),

  -- Friday, SCRUM-95: a full day booking occupies all three slots
  ('Marina Grand Ballroom',   4, 'am',    'confirmed', 'Annual Dinner'),
  ('Marina Grand Ballroom',   4, 'pm',    'confirmed', 'Annual Dinner'),
  ('Marina Grand Ballroom',   4, 'night', 'confirmed', 'Annual Dinner'),
  ('KLCC Conference Hall A',  4, 'night', 'confirmed', 'Product Launch')
) as b(venue_name, weekday_offset, slot, status, event_name)
join public.venues v on v.name = b.venue_name;

-- SCRUM-93: recorded unavailable periods, independent of any booking.
-- The full day example is on Marina because it is open into the evening, so
-- all three of its slots are genuinely open and the Unavailable state is
-- visible in every one of them.
insert into public.venue_unavailability
  (venue_id, unavailable_date, slot, reason)
select
  v.id,
  (date_trunc('week', current_date)::date + 7) + u.weekday_offset,
  u.slot::public.venue_slot,
  u.reason
from (values
  -- Tuesday, single slot
  ('KLCC Conference Hall A',  1, 'pm',    'Seed: Floor repairs'),

  -- Thursday, whole day out of service recorded as all three slots
  ('Marina Grand Ballroom',   3, 'am',    'Seed: Deep cleaning'),
  ('Marina Grand Ballroom',   3, 'pm',    'Seed: Deep cleaning'),
  ('Marina Grand Ballroom',   3, 'night', 'Seed: Deep cleaning')
) as u(venue_name, weekday_offset, slot, reason)
join public.venues v on v.name = u.venue_name;
```

-- SCRUM-170: disposable local schema, never run in shared Supabase. Only the
-- columns postpone_event and the SCRUM-41/SCRUM-163 venue triggers read.
reset role;
truncate public.notification_outbox, public.event_assignment_history, public.events cascade;
alter table public.events
  add column coordinator_id uuid, add column start_time timestamptz, add column end_time timestamptz,
  add column expected_attendance integer, add column cancelled_at timestamptz,
  add column postponed_by uuid, add column postponed_at timestamptz, add column postponement_reason text;

insert into auth.users(id) values
  ('22222222-2222-4222-8222-222222222222'), ('33333333-3333-4333-8333-333333333333'),
  ('44444444-0170-4170-8170-000000000001'), ('44444444-0170-4170-8170-000000000002'),
  ('44444444-0170-4170-8170-000000000003'), ('44444444-0170-4170-8170-000000000004')
on conflict do nothing;

create table public.event_activity_log (
  id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id),
  user_id uuid references auth.users(id), action text not null, details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table public.registrations (
  id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id),
  attendee_id uuid not null references auth.users(id),
  status text not null check (status in ('pending', 'confirmed', 'withdrawn'))
);
create table public.event_waitlist_entries (
  id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id),
  attendee_id uuid not null references auth.users(id), status text not null default 'active'
);

-- Real enum types: the release compares and assigns them, which text stubs would not prove.
create type public.booking_status as enum ('pending', 'confirmed', 'rejected', 'cancelled', 'hold', 'superseded');
create type public.venue_slot as enum ('am', 'pm', 'night');
create table public.venues (id uuid primary key, name text not null);
create table public.venue_booking_requests (
  id uuid primary key, event_id uuid not null references public.events(id),
  venue_id uuid not null references public.venues(id), booking_date date not null,
  requested_by uuid, decided_by uuid, decided_at timestamptz, decision_note text
);
create table public.venue_bookings (
  id uuid primary key default gen_random_uuid(), venue_id uuid not null references public.venues(id),
  event_id uuid references public.events(id), coordinator_id uuid references auth.users(id),
  request_id uuid references public.venue_booking_requests(id), booking_date date not null,
  slot public.venue_slot not null, event_name text not null, status public.booking_status not null default 'pending',
  expires_at timestamptz, requested_by text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
grant all on public.events, public.event_activity_log, public.registrations, public.event_waitlist_entries,
  public.venues, public.venue_booking_requests, public.venue_bookings to service_role;

-- E1 is postponed by the assertions; E2 is the unrelated event whose rows must survive.
insert into public.events(id, name, status, organiser_id, coordinator_id, start_time, end_time, expected_attendance) values
('eeeeeeee-0170-4170-8170-000000000001', 'Harbour Festival', 'APPROVED', '11111111-1111-4111-8111-111111111111',
 '22222222-2222-4222-8222-222222222222', '2099-06-01T09:00:00Z', '2099-06-01T17:00:00Z', 120),
('eeeeeeee-0170-4170-8170-000000000002', 'Unrelated Gala', 'APPROVED', '11111111-1111-4111-8111-111111111111',
 '22222222-2222-4222-8222-222222222222', '2099-06-01T09:00:00Z', '2099-06-01T17:00:00Z', 50);
insert into public.venues values
('aaaaaaaa-0170-4170-8170-000000000001', 'Marina Hall'), ('aaaaaaaa-0170-4170-8170-000000000002', 'Garden Room');
insert into public.venue_booking_requests(id, event_id, venue_id, booking_date, decided_at) values
('bbbbbbbb-0170-4170-8170-000000000001', 'eeeeeeee-0170-4170-8170-000000000001', 'aaaaaaaa-0170-4170-8170-000000000001', '2099-06-01', now()),
('bbbbbbbb-0170-4170-8170-000000000002', 'eeeeeeee-0170-4170-8170-000000000001', 'aaaaaaaa-0170-4170-8170-000000000002', '2099-06-01', null),
('bbbbbbbb-0170-4170-8170-000000000003', 'eeeeeeee-0170-4170-8170-000000000002', 'aaaaaaaa-0170-4170-8170-000000000002', '2099-06-02', now());
insert into public.venue_bookings(id, venue_id, event_id, coordinator_id, request_id, booking_date, slot, event_name, status, expires_at, requested_by) values
-- E1: two confirmed slots and one rejected slot on R1, one pending slot on R2.
('cccccccc-0170-4170-8170-000000000001', 'aaaaaaaa-0170-4170-8170-000000000001', null, null, 'bbbbbbbb-0170-4170-8170-000000000001', '2099-06-01', 'am', 'Harbour Festival', 'confirmed', null, 'coordinator'),
('cccccccc-0170-4170-8170-000000000002', 'aaaaaaaa-0170-4170-8170-000000000001', null, null, 'bbbbbbbb-0170-4170-8170-000000000001', '2099-06-01', 'pm', 'Harbour Festival', 'confirmed', null, 'coordinator'),
('cccccccc-0170-4170-8170-000000000003', 'aaaaaaaa-0170-4170-8170-000000000001', null, null, 'bbbbbbbb-0170-4170-8170-000000000001', '2099-06-01', 'night', 'Harbour Festival', 'rejected', null, 'coordinator'),
('cccccccc-0170-4170-8170-000000000004', 'aaaaaaaa-0170-4170-8170-000000000002', null, null, 'bbbbbbbb-0170-4170-8170-000000000002', '2099-06-01', 'am', 'Harbour Festival', 'pending', null, 'coordinator'),
-- E1 holds: active by event_id, expired, and a converted one reached only through R2.
('cccccccc-0170-4170-8170-000000000005', 'aaaaaaaa-0170-4170-8170-000000000001', 'eeeeeeee-0170-4170-8170-000000000001', '22222222-2222-4222-8222-222222222222', null, '2099-06-03', 'am', 'Harbour Festival', 'hold', now() + interval '30 minutes', 'venue-staff'),
('cccccccc-0170-4170-8170-000000000006', 'aaaaaaaa-0170-4170-8170-000000000001', 'eeeeeeee-0170-4170-8170-000000000001', '22222222-2222-4222-8222-222222222222', null, '2099-06-04', 'am', 'Harbour Festival', 'hold', now() - interval '1 day', 'venue-staff'),
('cccccccc-0170-4170-8170-000000000007', 'aaaaaaaa-0170-4170-8170-000000000002', null, '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-0170-4170-8170-000000000002', '2099-06-01', 'pm', 'Harbour Festival', 'hold', now() + interval '2 days', 'venue-staff'),
-- E2: a confirmed slot and an active hold that must be left alone.
('cccccccc-0170-4170-8170-000000000008', 'aaaaaaaa-0170-4170-8170-000000000002', null, null, 'bbbbbbbb-0170-4170-8170-000000000003', '2099-06-02', 'am', 'Unrelated Gala', 'confirmed', null, 'coordinator'),
('cccccccc-0170-4170-8170-000000000009', 'aaaaaaaa-0170-4170-8170-000000000001', 'eeeeeeee-0170-4170-8170-000000000002', '22222222-2222-4222-8222-222222222222', null, '2099-06-05', 'am', 'Unrelated Gala', 'hold', now() + interval '30 minutes', 'venue-staff');

-- A1 confirmed, A2 pending, A3 withdrawn, A4 waitlisted; the organiser also registered.
insert into public.registrations(event_id, attendee_id, status) values
('eeeeeeee-0170-4170-8170-000000000001', '44444444-0170-4170-8170-000000000001', 'confirmed'),
('eeeeeeee-0170-4170-8170-000000000001', '44444444-0170-4170-8170-000000000002', 'pending'),
('eeeeeeee-0170-4170-8170-000000000001', '44444444-0170-4170-8170-000000000003', 'withdrawn'),
('eeeeeeee-0170-4170-8170-000000000001', '11111111-1111-4111-8111-111111111111', 'confirmed'),
('eeeeeeee-0170-4170-8170-000000000002', '44444444-0170-4170-8170-000000000001', 'confirmed');
insert into public.event_waitlist_entries(event_id, attendee_id) values
('eeeeeeee-0170-4170-8170-000000000001', '44444444-0170-4170-8170-000000000004');

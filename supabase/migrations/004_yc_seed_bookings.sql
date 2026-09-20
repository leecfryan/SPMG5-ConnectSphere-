-- 004_yc_seed_bookings.sql
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

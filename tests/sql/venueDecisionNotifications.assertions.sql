-- SCRUM-41: venue booking decision notifications, queued by the trigger on
-- venue_bookings. Disposable local PostgreSQL, after the documented schema
-- blocks. No Supabase and no Novu.
grant usage on schema public, auth to service_role;
truncate public.notification_outbox, public.venue_bookings, public.venue_booking_requests,
         public.venues, public.events cascade;

-- coordinator, requester, organiser, and a fourth who should never be told
insert into auth.users values
 ('c0000000-0000-4000-8000-000000000001'),
 ('c0000000-0000-4000-8000-000000000002'),
 ('c0000000-0000-4000-8000-000000000003'),
 ('c0000000-0000-4000-8000-000000000004')
on conflict do nothing;

insert into public.events(id, name, status, organiser_id, coordinator_id) values
 ('e0000000-0000-4000-8000-000000000001', 'Alumni Gala', 'APPROVED',
  'c0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001');

insert into public.venues(id, name) values
 ('11110000-0000-4000-8000-000000000001', 'Marina Grand Ballroom');

-- A decision, as decide_venue_booking_request makes it: stamp the request,
-- then move every slot that is not already cancelled.
create function pg_temp.decide(p_request uuid, p_decision text, p_note text) returns void
language plpgsql as $$
begin
  update public.venue_booking_requests
     set decided_at = now(), decision_note = p_note
   where id = p_request;
  update public.venue_bookings
     set status = p_decision
   where request_id = p_request and status <> 'cancelled';
end;
$$;

create function pg_temp.new_request(p_id uuid, p_requested_by uuid) returns void
language plpgsql as $$
begin
  insert into public.venue_booking_requests(id, event_id, venue_id, booking_date, requested_by)
  values (p_id, 'e0000000-0000-4000-8000-000000000001',
          '11110000-0000-4000-8000-000000000001', date '2026-10-20', p_requested_by);
end;
$$;

set role service_role;

-- AC1/AC2/AC3: a confirmation reaches the coordinator, the requester and the
-- organiser, and carries the event, venue, date, outcome and note.
do $$ declare request_id uuid := 'a0000000-0000-4000-8000-000000000001'; begin
  perform pg_temp.new_request(request_id, 'c0000000-0000-4000-8000-000000000002');
  insert into public.venue_bookings(request_id, slot, status) values (request_id, 'am', 'pending');
  perform pg_temp.decide(request_id, 'confirmed', 'Stage is already set.');

  if (select count(*) from public.notification_outbox) <> 3 then
    raise exception '[TC-SCRUM-41-S01] a confirmation should reach exactly three people';
  end if;
  if exists (select 1 from public.notification_outbox
             where recipient_id = 'c0000000-0000-4000-8000-000000000004') then
    raise exception '[TC-SCRUM-41-S01] an unrelated account was notified';
  end if;
  if not exists (
    select 1 from public.notification_outbox
    where workflow = 'venue-booking-decision'
      and recipient_id = 'c0000000-0000-4000-8000-000000000001'
      and payload ->> 'eventName' = 'Alumni Gala'
      and payload ->> 'venueName' = 'Marina Grand Ballroom'
      and payload ->> 'bookingDate' = '2026-10-20'
      and payload ->> 'outcome' = 'confirmed'
      and payload ->> 'note' = 'Stage is already set.'
      and payload ->> 'requestPath' = '/venues/booking-requests/' || request_id
  ) then raise exception '[TC-SCRUM-41-S01] the coordinator payload is missing required detail'; end if;
end $$;

-- AC2: a rejection does not reach the organiser, only the coordinator and the
-- requester, and it carries the reason.
delete from public.notification_outbox;
do $$ declare request_id uuid := 'a0000000-0000-4000-8000-000000000002'; begin
  perform pg_temp.new_request(request_id, 'c0000000-0000-4000-8000-000000000002');
  insert into public.venue_bookings(request_id, slot, status) values (request_id, 'pm', 'pending');
  perform pg_temp.decide(request_id, 'rejected', 'Held for another event.');

  if exists (select 1 from public.notification_outbox
             where recipient_id = 'c0000000-0000-4000-8000-000000000003') then
    raise exception '[TC-SCRUM-41-S02] the organiser must not be told about a rejection';
  end if;
  if (select count(*) from public.notification_outbox) <> 2
     or not exists (select 1 from public.notification_outbox
                    where payload ->> 'outcome' = 'rejected'
                      and payload ->> 'note' = 'Held for another event.') then
    raise exception '[TC-SCRUM-41-S02] a rejection should reach the coordinator and requester with its reason';
  end if;
end $$;

-- AC1: when the coordinator made the request themselves, they are told once.
delete from public.notification_outbox;
do $$ declare request_id uuid := 'a0000000-0000-4000-8000-000000000003'; begin
  perform pg_temp.new_request(request_id, 'c0000000-0000-4000-8000-000000000001');
  insert into public.venue_bookings(request_id, slot, status) values (request_id, 'am', 'pending');
  perform pg_temp.decide(request_id, 'confirmed', null);

  if (select count(*) from public.notification_outbox
      where recipient_id = 'c0000000-0000-4000-8000-000000000001') <> 1 then
    raise exception '[TC-SCRUM-41-S03] the coordinator who requested should be notified once, not twice';
  end if;
  if not exists (select 1 from public.notification_outbox where payload ->> 'note' = '') then
    raise exception '[TC-SCRUM-41-S03] a decision with no note should send an empty note, not null';
  end if;
end $$;

-- AC5: every slot's final state is listed, including one cancelled earlier.
delete from public.notification_outbox;
do $$ declare request_id uuid := 'a0000000-0000-4000-8000-000000000004'; begin
  perform pg_temp.new_request(request_id, 'c0000000-0000-4000-8000-000000000002');
  insert into public.venue_bookings(request_id, slot, status) values
    (request_id, 'am', 'pending'), (request_id, 'pm', 'pending'), (request_id, 'night', 'cancelled');
  perform pg_temp.decide(request_id, 'confirmed', null);

  -- The cancelled slot keeps its own state; the trigger fires once for the
  -- whole statement, not once per slot.
  if not exists (select 1 from public.notification_outbox
                 where payload ->> 'slots' = 'am confirmed, pm confirmed, night cancelled') then
    raise exception '[TC-SCRUM-41-S04] every slot and its final state should be listed in order';
  end if;
  if (select count(*) from public.notification_outbox) <> 3 then
    raise exception '[TC-SCRUM-41-S04] a three-slot decision should still queue one message per person';
  end if;
end $$;

-- Cancelling or releasing a booking is not a decision and queues nothing.
delete from public.notification_outbox;
-- The variable is named v_request, not request_id: venue_bookings has a
-- request_id column, and a bare "where request_id = request_id" is ambiguous
-- to PL/pgSQL rather than a comparison.
do $$ declare v_request uuid := 'a0000000-0000-4000-8000-000000000005'; begin
  perform pg_temp.new_request(v_request, 'c0000000-0000-4000-8000-000000000002');
  insert into public.venue_bookings(request_id, slot, status) values (v_request, 'am', 'confirmed');
  update public.venue_bookings set status = 'cancelled' where request_id = v_request;

  if (select count(*) from public.notification_outbox) <> 0 then
    raise exception '[TC-SCRUM-41-S05] cancelling a booking must not queue a decision notification';
  end if;
end $$;

-- A repeated decision cannot queue a second copy for the same person.
delete from public.notification_outbox;
do $$ declare request_id uuid := 'a0000000-0000-4000-8000-000000000006'; begin
  perform pg_temp.new_request(request_id, 'c0000000-0000-4000-8000-000000000002');
  insert into public.venue_bookings(request_id, slot, status) values (request_id, 'am', 'pending');
  perform pg_temp.decide(request_id, 'confirmed', null);
  perform pg_temp.decide(request_id, 'confirmed', null);

  if (select count(*) from public.notification_outbox) <> 3 then
    raise exception '[TC-SCRUM-41-S06] deciding twice should not duplicate notifications';
  end if;
end $$;

-- The browser roles cannot read or write the queue.
reset role;
do $$ begin
  set local role authenticated;
  begin
    perform 1 from public.notification_outbox;
    raise exception '[TC-SCRUM-41-S07] the authenticated role must not read the notification queue';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select 'VENUE DECISION SQL ASSERTIONS PASSED' as result;

-- SCRUM-170: postpone_event scenarios. Disposable database only; these clear and replace fixture data.
reset role;
create temp table fixture_bookings as select id, status from public.venue_bookings;

-- The function is backend-only: the browser roles cannot run it.
set role authenticated;
do $$ begin
  begin
    perform public.postpone_event('eeeeeeee-0170-4170-8170-000000000001', '22222222-2222-4222-8222-222222222222', 'x', true);
    raise exception '[TC-SCRUM-170-02] the authenticated role could postpone';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- A coordinator who is not assigned changes nothing.
set role service_role;
create temp table other_coordinator as
  select * from public.postpone_event('eeeeeeee-0170-4170-8170-000000000001', '33333333-3333-4333-8333-333333333333', 'Not mine', true);
reset role;
do $$ begin
  if (select count(*) from other_coordinator) <> 0
    or (select status from public.events where id = 'eeeeeeee-0170-4170-8170-000000000001') <> 'APPROVED'
    or exists (select 1 from public.venue_bookings b join fixture_bookings f using (id) where b.status <> f.status)
    or exists (select 1 from public.notification_outbox) or exists (select 1 from public.event_activity_log) then
    raise exception '[TC-SCRUM-170-02] an unassigned coordinator postponed or changed something';
  end if;
end $$;

-- A missing or blank reason is refused before anything is written.
set role service_role;
do $$ declare blank text; begin
  foreach blank in array array['', '   '] loop
    begin
      perform public.postpone_event('eeeeeeee-0170-4170-8170-000000000001', '22222222-2222-4222-8222-222222222222', blank, true);
      raise exception '[TC-SCRUM-170-04] a blank reason was accepted';
    exception when sqlstate '22023' then null; end;
  end loop;
  begin
    perform public.postpone_event('eeeeeeee-0170-4170-8170-000000000001', '22222222-2222-4222-8222-222222222222', null, true);
    raise exception '[TC-SCRUM-170-04] a missing reason was accepted';
  exception when sqlstate '22023' then null; end;
end $$;
reset role;
do $$ begin
  if (select status from public.events where id = 'eeeeeeee-0170-4170-8170-000000000001') <> 'APPROVED'
    or exists (select 1 from public.venue_bookings b join fixture_bookings f using (id) where b.status <> f.status) then
    raise exception '[TC-SCRUM-170-04] a refused reason still changed the event or its bookings';
  end if;
end $$;

-- A failure part-way (the queue refusing inserts) saves nothing at all.
alter table public.notification_outbox add constraint fixture_queue_down check (false) not valid;
set role service_role;
do $$ begin
  begin
    perform public.postpone_event('eeeeeeee-0170-4170-8170-000000000001', '22222222-2222-4222-8222-222222222222', 'x', true);
    raise exception '[TC-SCRUM-170-11] the postponement succeeded with the queue down';
  exception when check_violation then null; end;
end $$;
reset role;
alter table public.notification_outbox drop constraint fixture_queue_down;
do $$ begin
  if (select status from public.events where id = 'eeeeeeee-0170-4170-8170-000000000001') <> 'APPROVED'
    or (select postponed_at from public.events where id = 'eeeeeeee-0170-4170-8170-000000000001') is not null
    or exists (select 1 from public.venue_bookings b join fixture_bookings f using (id) where b.status <> f.status)
    or exists (select 1 from public.event_activity_log)
    or exists (select 1 from public.venue_hold_notification_state where ended_at is not null) then
    raise exception '[TC-SCRUM-170-11] a failed postponement left part of its work saved';
  end if;
end $$;

-- The assigned coordinator postpones E1.
set role service_role;
create temp table postponed as
  select * from public.postpone_event('eeeeeeee-0170-4170-8170-000000000001', '22222222-2222-4222-8222-222222222222', '  Speaker unavailable  ', true);
reset role;
do $$ declare e public.events%rowtype; begin
  select * into e from public.events where id = 'eeeeeeee-0170-4170-8170-000000000001';
  if (select count(*) from postponed) <> 1 or (select status from postponed) <> 'POSTPONED' then
    raise exception '[TC-SCRUM-170-01] the postponed event was not returned';
  end if;
  if e.status <> 'POSTPONED' or e.postponed_by <> '22222222-2222-4222-8222-222222222222'
    or e.postponement_reason <> 'Speaker unavailable' or e.postponed_at is null then
    raise exception '[TC-SCRUM-170-01] the postponement was not recorded';
  end if;
  if e.name <> 'Harbour Festival' or e.start_time <> '2099-06-01T09:00:00Z' or e.end_time <> '2099-06-01T17:00:00Z'
    or e.expected_attendance <> 120 or e.coordinator_id <> '22222222-2222-4222-8222-222222222222' then
    raise exception '[TC-SCRUM-170-05] the event details changed';
  end if;
  if exists (select 1 from public.venue_bookings where status <> 'cancelled' and id in (
    'cccccccc-0170-4170-8170-000000000001', 'cccccccc-0170-4170-8170-000000000002', 'cccccccc-0170-4170-8170-000000000004',
    'cccccccc-0170-4170-8170-000000000005', 'cccccccc-0170-4170-8170-000000000007')) then
    raise exception '[TC-SCRUM-170-01] a live slot or hold of the event was not released';
  end if;
  if (select status from public.venue_bookings where id = 'cccccccc-0170-4170-8170-000000000003') <> 'rejected'
    or (select status from public.venue_bookings where id = 'cccccccc-0170-4170-8170-000000000006') <> 'hold'
    or (select status from public.venue_bookings where id = 'cccccccc-0170-4170-8170-000000000008') <> 'confirmed'
    or (select status from public.venue_bookings where id = 'cccccccc-0170-4170-8170-000000000009') <> 'hold' then
    raise exception '[TC-SCRUM-170-08] a rejected row, an expired hold or another event''s row was changed';
  end if;
  if (select count(*) from public.event_activity_log where event_id = e.id and action = 'EVENT_POSTPONED'
      and user_id = '22222222-2222-4222-8222-222222222222' and details ->> 'from_status' = 'APPROVED'
      and details ->> 'to_status' = 'POSTPONED' and details ->> 'note' = 'Speaker unavailable') <> 1 then
    raise exception '[TC-SCRUM-170-01] the history entry is missing or wrong';
  end if;
  if (select array_agg(recipient_id order by recipient_id) from public.notification_outbox where workflow = 'event-postponed')
      is distinct from array['11111111-1111-4111-8111-111111111111', '44444444-0170-4170-8170-000000000001',
                             '44444444-0170-4170-8170-000000000002']::uuid[] then
    raise exception '[TC-SCRUM-170-09] the notices did not go once each to the organiser and registered attendees';
  end if;
  if not exists (select 1 from public.notification_outbox where workflow = 'event-postponed'
      and recipient_id = '11111111-1111-4111-8111-111111111111' and event_id = e.id
      and payload ->> 'requestPath' = '/my-event-requests/' || e.id and payload ->> 'reason' = 'Speaker unavailable')
    or exists (select 1 from public.notification_outbox where workflow = 'event-postponed'
      and recipient_id <> '11111111-1111-4111-8111-111111111111' and payload ->> 'requestPath' <> '/registrations/me') then
    raise exception '[TC-SCRUM-170-09] a notice has the wrong link or reason';
  end if;
  if exists (select 1 from public.notification_outbox where workflow <> 'event-postponed') then
    raise exception '[TC-SCRUM-170-09] releasing the venues queued another lane''s notification';
  end if;
end $$;

-- SCRUM-163 must stay quiet about the released hold, while still warning about E2's.
select public.enqueue_venue_hold_notifications();
do $$ begin
  if exists (select 1 from public.notification_outbox where workflow = 'venue-hold-expiry'
      and event_id = 'eeeeeeee-0170-4170-8170-000000000001') then
    raise exception '[TC-SCRUM-170-09] the released hold still produced a hold notification';
  end if;
  if not exists (select 1 from public.notification_outbox where workflow = 'venue-hold-expiry'
      and event_id = 'eeeeeeee-0170-4170-8170-000000000002') then
    raise exception '[TC-SCRUM-170-09] fixture check: the unrelated hold should still warn';
  end if;
end $$;

-- Postponing again changes nothing and queues nothing.
create temp table before_again as select
  (select count(*) from public.notification_outbox) as queued,
  (select count(*) from public.event_activity_log) as history,
  (select postponed_at from public.events where id = 'eeeeeeee-0170-4170-8170-000000000001') as postponed_at;
create temp table bookings_after_first as select id, status from public.venue_bookings;
set role service_role;
create temp table postponed_again as
  select * from public.postpone_event('eeeeeeee-0170-4170-8170-000000000001', '22222222-2222-4222-8222-222222222222', 'again', true);
reset role;
do $$ begin
  if (select count(*) from postponed_again) <> 0
    or (select count(*) from public.notification_outbox) <> (select queued from before_again)
    or (select count(*) from public.event_activity_log) <> (select history from before_again)
    or (select postponed_at from public.events where id = 'eeeeeeee-0170-4170-8170-000000000001') <> (select postponed_at from before_again)
    or (select postponement_reason from public.events where id = 'eeeeeeee-0170-4170-8170-000000000001') <> 'Speaker unavailable'
    or exists (select 1 from public.venue_bookings b join bookings_after_first f using (id) where b.status <> f.status) then
    raise exception '[TC-SCRUM-170-06] postponing again changed or queued something';
  end if;
end $$;

-- Only the six postponable stages can be postponed.
do $$ declare stage text; stage_event uuid; returned integer; postponable boolean; begin
  foreach stage in array array['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'SAFETY_REVIEW',
                               'PREPARATION', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'POSTPONED'] loop
    postponable := stage in ('SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'SAFETY_REVIEW', 'CONFIRMED');
    insert into public.events(id, name, status, organiser_id, coordinator_id)
      values (gen_random_uuid(), 'Stage ' || stage, stage, '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')
      returning id into stage_event;
    select count(*) into returned from public.postpone_event(stage_event, '22222222-2222-4222-8222-222222222222', 'x', true);
    if returned <> postponable::integer
      or (select status from public.events where id = stage_event) <> (case when postponable then 'POSTPONED' else stage end) then
      raise exception '[TC-SCRUM-170-10] % gave the wrong outcome', stage;
    end if;
  end loop;
end $$;

-- SCRUM-149 AC1 (pending SCRUM-170's clarification): with p_assigned_only false the lead may postpone
-- an event assigned to someone else, and is recorded as the actor. A missing flag is refused.
do $$ declare lead_event uuid; returned integer; begin
  insert into public.events(id, name, status, organiser_id, coordinator_id)
    values (gen_random_uuid(), 'Lead postpones', 'APPROVED', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')
    returning id into lead_event;
  select count(*) into returned from public.postpone_event(lead_event, '33333333-3333-4333-8333-333333333333', 'x', null);
  if returned <> 0 or (select status from public.events where id = lead_event) <> 'APPROVED' then
    raise exception '[TC-SCRUM-170-02] a missing assignment flag was treated as permission';
  end if;
  select count(*) into returned from public.postpone_event(lead_event, '33333333-3333-4333-8333-333333333333', 'Lead decision', false);
  if returned <> 1 or (select postponed_by from public.events where id = lead_event) <> '33333333-3333-4333-8333-333333333333'
    or (select count(*) from public.event_activity_log where event_id = lead_event and action = 'EVENT_POSTPONED'
        and user_id = '33333333-3333-4333-8333-333333333333') <> 1 then
    raise exception '[TC-SCRUM-170-15] the lead could not postpone, or was not recorded as the actor';
  end if;
end $$;

-- Phase 2: postponing with a new date. Request 4 passed the backend's checks and moves a week later;
-- request 5 failed and is released; a move naming E2's request 3 is ignored.
insert into public.events(id, name, status, organiser_id, coordinator_id, start_time, end_time)
values ('eeeeeeee-0170-4170-8170-000000000004', 'Moved festival', 'APPROVED', '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222', '2099-07-01T01:00:00Z', '2099-07-01T09:00:00Z');
insert into public.venue_booking_requests(id, event_id, venue_id, booking_date, decided_at, decision_note) values
('bbbbbbbb-0170-4170-8170-000000000004', 'eeeeeeee-0170-4170-8170-000000000004', 'aaaaaaaa-0170-4170-8170-000000000001', '2099-07-01', now(), 'Approved'),
('bbbbbbbb-0170-4170-8170-000000000005', 'eeeeeeee-0170-4170-8170-000000000004', 'aaaaaaaa-0170-4170-8170-000000000002', '2099-07-01', now(), null);
insert into public.venue_bookings(venue_id, request_id, booking_date, slot, event_name, status, requested_by) values
('aaaaaaaa-0170-4170-8170-000000000001', 'bbbbbbbb-0170-4170-8170-000000000004', '2099-07-01', 'am', 'Moved festival', 'confirmed', 'coordinator'),
('aaaaaaaa-0170-4170-8170-000000000001', 'bbbbbbbb-0170-4170-8170-000000000004', '2099-07-01', 'pm', 'Moved festival', 'confirmed', 'coordinator'),
('aaaaaaaa-0170-4170-8170-000000000002', 'bbbbbbbb-0170-4170-8170-000000000005', '2099-07-01', 'am', 'Moved festival', 'confirmed', 'coordinator');
delete from public.notification_outbox;

set role service_role;
do $$ begin
  begin
    perform public.postpone_event('eeeeeeee-0170-4170-8170-000000000004', '22222222-2222-4222-8222-222222222222', 'x', true, '2099-08-01T01:00:00Z', null, '[]');
    raise exception '[TC-SCRUM-170-23] a start without an end was accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.postpone_event('eeeeeeee-0170-4170-8170-000000000004', '22222222-2222-4222-8222-222222222222', 'x', true, now() - interval '1 day', now() + interval '1 day', '[]');
    raise exception '[TC-SCRUM-170-23] a start in the past was accepted';
  exception when sqlstate '22023' then null; end;
end $$;
create temp table moved as select * from public.postpone_event('eeeeeeee-0170-4170-8170-000000000004', '22222222-2222-4222-8222-222222222222',
  'Venue roof repairs', true, '2099-07-08T01:00:00Z', '2099-07-08T09:00:00Z',
  '[{"request_id": "bbbbbbbb-0170-4170-8170-000000000004", "booking_date": "2099-07-08"},
    {"request_id": "bbbbbbbb-0170-4170-8170-000000000003", "booking_date": "2099-07-09"}]');
reset role;
do $$ begin
  if (select count(*) from moved) <> 1 or (select status from public.events where id = 'eeeeeeee-0170-4170-8170-000000000004') <> 'POSTPONED'
    or (select start_time from public.events where id = 'eeeeeeee-0170-4170-8170-000000000004') <> '2099-07-08T01:00:00Z'
    or (select end_time from public.events where id = 'eeeeeeee-0170-4170-8170-000000000004') <> '2099-07-08T09:00:00Z' then
    raise exception '[TC-SCRUM-170-20] the event is not POSTPONED with the new dates';
  end if;
  if (select booking_date from public.venue_booking_requests where id = 'bbbbbbbb-0170-4170-8170-000000000004') <> '2099-07-08'
    or (select decided_at from public.venue_booking_requests where id = 'bbbbbbbb-0170-4170-8170-000000000004') is not null
    or (select array_agg(slot::text order by slot) from public.venue_bookings where request_id = 'bbbbbbbb-0170-4170-8170-000000000004'
        and status = 'pending' and booking_date = '2099-07-08') is distinct from array['am', 'pm']
    or exists (select 1 from public.venue_bookings where request_id = 'bbbbbbbb-0170-4170-8170-000000000004'
        and booking_date = '2099-07-01' and status <> 'cancelled') then
    raise exception '[TC-SCRUM-170-21] the passing booking did not move to the new date as pending';
  end if;
  if exists (select 1 from public.venue_bookings where request_id = 'bbbbbbbb-0170-4170-8170-000000000005' and status <> 'cancelled') then
    raise exception '[TC-SCRUM-170-22] the failing booking was not released';
  end if;
  if (select booking_date from public.venue_booking_requests where id = 'bbbbbbbb-0170-4170-8170-000000000003') <> '2099-06-02'
    or (select status from public.venue_bookings where id = 'cccccccc-0170-4170-8170-000000000008') <> 'confirmed' then
    raise exception '[TC-SCRUM-170-22] a move naming another event''s booking changed it';
  end if;
  if not exists (select 1 from public.event_activity_log where event_id = 'eeeeeeee-0170-4170-8170-000000000004'
      and action = 'EVENT_POSTPONED' and (details ->> 'new_start')::timestamptz = '2099-07-08T01:00:00Z'
      and (details ->> 'previous_start')::timestamptz = '2099-07-01T01:00:00Z'
      and details -> 'moved_bookings' = '["bbbbbbbb-0170-4170-8170-000000000004"]'::jsonb) then
    raise exception '[TC-SCRUM-170-20] the history entry does not record the dates and the moved booking';
  end if;
  if not exists (select 1 from public.notification_outbox where workflow = 'event-postponed'
      and recipient_id = '11111111-1111-4111-8111-111111111111'
      and payload ->> 'message' = 'Moved festival has been postponed to 8 Jul 2099.') then
    raise exception '[TC-SCRUM-170-24] the notice does not name the new date';
  end if;
end $$;

select 'POSTPONE SQL ASSERTIONS PASSED' as evidence;

-- SCRUM-163: actual documented SQL, never a storage-double implementation.
do $$ declare accepted_workflow text;begin
  if (select body from fixture_decision_definition) is distinct from pg_get_functiondef('public.decide_venue_booking_request(uuid,text,uuid,text)'::regprocedure) then raise exception '[TC-SCRUM-163-S01] existing conversion function changed';end if;
  foreach accepted_workflow in array array['event-decision','event-assignment','equipment-issue','event-changes-requested','event-request-resubmitted','registration-status','waitlist-offer-expiring','venue-hold-expiry'] loop
    insert into public.notification_outbox(event_id,recipient_id,workflow,payload) values('eeeeeeee-0163-4163-8163-000000000001','11111111-1111-4111-8111-111111111111',accepted_workflow,'{}');
  end loop;
  delete from public.notification_outbox;
  if (select count(*) from public.venue_hold_notification_state) is distinct from 1
    or public.enqueue_venue_hold_notifications() is distinct from 0 then raise exception '[TC-SCRUM-163-S01] historical expiries replayed or existing active hold not tracked'; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.notification_outbox'::regclass
    and pg_get_constraintdef(oid) like '%registration-status%' and pg_get_constraintdef(oid) like '%waitlist-offer-expiring%') then
    raise exception '[TC-SCRUM-163-S01] existing workflow values lost'; end if;
end $$;
truncate public.notification_outbox,public.venue_hold_notification_state,public.venue_bookings;
begin;
insert into public.venue_bookings(venue_id,event_id,coordinator_id,booking_date,slot,event_name,status,expires_at,requested_by)
select 'aaaaaaaa-0163-4163-8163-000000000001','eeeeeeee-0163-4163-8163-000000000001','11111111-1111-4111-8111-111111111111','2099-10-10',s::public.venue_slot,'FORGED client name','hold',now()+interval '1 hour 0.001 seconds','venue-staff'
from unnest(array['am','pm','night']) s;
do $$ begin
  if public.enqueue_venue_hold_notifications() is distinct from 0 then raise exception '[TC-SCRUM-163-S02] warning sent early';end if;
end $$;
update public.venue_bookings set expires_at=now()+interval '1 hour';
do $$ declare q public.notification_outbox%rowtype; begin
  if public.enqueue_venue_hold_notifications() is distinct from 1 then raise exception '[TC-SCRUM-163-S03] exact threshold or slot grouping incorrect';end if;
  select * into strict q from public.claim_notification_outbox();
  if q.recipient_id is distinct from '11111111-1111-4111-8111-111111111111'::uuid
    or q.workflow is distinct from 'venue-hold-expiry' or q.payload->>'venueName' is distinct from 'Marina Hall'
    or q.payload->>'eventName' is distinct from 'Community Open Day' or q.payload->>'changeType' is distinct from 'expiring'
    or jsonb_array_length(q.payload->'stateIds') is distinct from 3
    or q.payload->>'requestPath' is distinct from '/venues/aaaaaaaa-0163-4163-8163-000000000001/availability'
    or (q.payload->>'expiresAt')::timestamptz is distinct from now()+interval '1 hour'
    or q.payload->>'message' is distinct from 'Your tentative hold at Marina Hall for Community Open Day on 2099-10-10 expires at '||to_char((now()+interval '1 hour') at time zone 'UTC','YYYY-MM-DD HH24:MI:SS')||' UTC. Open venue availability to review it.' then
    raise exception '[TC-SCRUM-163-S04] venue/event/deadline/recipient contract incorrect'; end if;
  if public.validate_venue_hold_notification(q.id,q.lease_token) is distinct from true then raise exception '[TC-SCRUM-163-S05] active warning rejected';end if;
  if public.validate_venue_hold_notification(q.id,gen_random_uuid()) is distinct from false then raise exception '[TC-SCRUM-163-S05] wrong lease accepted';end if;
  update public.notification_outbox set locked_until=clock_timestamp()-interval '1 second' where id=q.id;
  begin perform public.validate_venue_hold_notification(q.id,q.lease_token);
    raise exception '[TC-SCRUM-163-S06] expired lease silently discarded';exception when sqlstate '55000' then null;end;
  if not exists(select 1 from public.notification_outbox where id=q.id) then raise exception '[TC-SCRUM-163-S06] unsent work lost';end if;
  perform public.finish_notification_outbox(q.id,q.lease_token,true);
  if public.enqueue_venue_hold_notifications() is distinct from 0 then raise exception '[TC-SCRUM-163-S07] completed warning recreated';end if;
end $$;
-- A changed deadline is a new generation; the original reservation ended before expiry.
update public.venue_bookings set expires_at=now()+interval '59 minutes 59.999 seconds';
do $$ begin
  if public.enqueue_venue_hold_notifications() is distinct from 1 then raise exception '[TC-SCRUM-163-S08] inside-window replacement missing';end if;
end $$;
commit;
do $$ declare q public.notification_outbox%rowtype; begin
  select * into strict q from public.claim_notification_outbox();
  update public.venue_bookings set status='cancelled' where slot='am';
  if public.validate_venue_hold_notification(q.id,q.lease_token) is distinct from true then raise exception '[TC-SCRUM-163-S09] partial conversion suppressed remaining active hold';end if;
  update public.venue_bookings set status='cancelled';
  if public.validate_venue_hold_notification(q.id,q.lease_token) is distinct from false then raise exception '[TC-SCRUM-163-S09] confirmed/cancelled cohort warning accepted';end if;
end $$;
truncate public.notification_outbox,public.venue_hold_notification_state,public.venue_bookings;
begin;
insert into public.venue_bookings(venue_id,event_id,coordinator_id,booking_date,slot,event_name,status,expires_at,requested_by)
select 'aaaaaaaa-0163-4163-8163-000000000001','eeeeeeee-0163-4163-8163-000000000001',owner::uuid,'2099-10-10','pm','Client name','hold',now(),'venue-staff'
from unnest(array['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222']) owner;
do $$ declare q public.notification_outbox%rowtype; begin
  if public.enqueue_venue_hold_notifications() is distinct from 2 then raise exception '[TC-SCRUM-163-S10] exact expiry or distinct owners collapsed';end if;
  if exists(select 1 from public.notification_outbox where payload->>'changeType'<>'expired') then raise exception '[TC-SCRUM-163-S10] late warning queued';end if;
  select * into q from public.claim_notification_outbox() limit 1;
  if public.validate_venue_hold_notification(q.id,q.lease_token) is distinct from true then raise exception '[TC-SCRUM-163-S10] due expiry rejected';end if;
  if q.payload->>'message' is distinct from 'Your tentative hold at Marina Hall for Community Open Day on 2099-10-10 expired at '||to_char(now() at time zone 'UTC','YYYY-MM-DD HH24:MI:SS')||' UTC. The expired reservation has been released.' then raise exception '[TC-SCRUM-163-S11] expiry content incorrect';end if;
  update public.notification_outbox set recipient_id='33333333-3333-4333-8333-333333333333' where id=q.id;
  if public.validate_venue_hold_notification(q.id,q.lease_token) is distinct from false then raise exception '[TC-SCRUM-163-S11] forged owner accepted';end if;
  delete from public.notification_outbox;
  if public.enqueue_venue_hold_notifications() is distinct from 0 then raise exception '[TC-SCRUM-163-S12] completed expiry recreated';end if;
end $$;
commit;
-- The exported decision function must still cancel hold rows before confirmation.
truncate public.notification_outbox,public.venue_hold_notification_state,public.venue_bookings,public.venue_booking_requests;
insert into public.venue_booking_requests(id,event_id,venue_id) values('dddddddd-0163-4163-8163-000000000001','eeeeeeee-0163-4163-8163-000000000001','aaaaaaaa-0163-4163-8163-000000000001');
insert into public.venue_bookings(venue_id,event_id,coordinator_id,request_id,booking_date,slot,event_name,status,expires_at,requested_by) values
('aaaaaaaa-0163-4163-8163-000000000001','eeeeeeee-0163-4163-8163-000000000001','11111111-1111-4111-8111-111111111111','dddddddd-0163-4163-8163-000000000001','2099-10-10','am','Client name','hold',now()+interval '30 minutes','venue-staff'),
('aaaaaaaa-0163-4163-8163-000000000001','eeeeeeee-0163-4163-8163-000000000001',null,'dddddddd-0163-4163-8163-000000000001','2099-10-10','am','Client name','pending',null,'coordinator');
select public.enqueue_venue_hold_notifications();
do $$ declare q public.notification_outbox%rowtype; begin
  select * into strict q from public.claim_notification_outbox();
  perform public.decide_venue_booking_request('dddddddd-0163-4163-8163-000000000001','confirmed','33333333-3333-4333-8333-333333333333',null);
  if (select count(*) from public.venue_bookings where status='confirmed') is distinct from 1
    or public.validate_venue_hold_notification(q.id,q.lease_token) is distinct from false then raise exception '[TC-SCRUM-163-S13] conversion changed or obsolete warning accepted';end if;
  if exists(select 1 from public.venue_hold_notification_state where ended_at is null) then raise exception '[TC-SCRUM-163-S13] confirmed conversion not closed';end if;
end $$;
-- Failure atomicity: marker/outbox failure must not lose pending state.
delete from public.notification_outbox;
truncate public.venue_hold_notification_state,public.venue_bookings;
insert into public.venue_bookings(venue_id,event_id,coordinator_id,booking_date,slot,event_name,status,expires_at,requested_by)
values('aaaaaaaa-0163-4163-8163-000000000001','eeeeeeee-0163-4163-8163-000000000001','11111111-1111-4111-8111-111111111111','2099-10-10','pm','Client','hold',now()+interval '30 minutes','venue-staff');
alter table public.notification_outbox add constraint fixture_provider_storage_down check(workflow<>'venue-hold-expiry');
do $$ begin
  begin perform public.enqueue_venue_hold_notifications();raise exception '[TC-SCRUM-163-S14] expected storage failure';exception when check_violation then null;end;
  if exists(select 1 from public.venue_hold_notification_state where warning_id is not null) or (select count(*) from public.venue_bookings)<>1 then raise exception '[TC-SCRUM-163-S14] marker or business state lost';end if;
end $$;
alter table public.notification_outbox drop constraint fixture_provider_storage_down;
select public.enqueue_venue_hold_notifications();
do $$ declare q public.notification_outbox%rowtype;begin
  select * into strict q from public.claim_notification_outbox();
  update public.events set cancelled_at=now();
  if public.validate_venue_hold_notification(q.id,q.lease_token) is distinct from false then raise exception '[TC-SCRUM-163-S15] cancelled event warning accepted';end if;
end $$;
set role authenticated;
do $$ begin
  begin perform * from public.venue_hold_notification_state;raise exception '[TC-SCRUM-163-S16] browser history access';exception when insufficient_privilege then null;end;
  begin perform public.enqueue_venue_hold_notifications();raise exception '[TC-SCRUM-163-S16] browser preparation access';exception when insufficient_privilege then null;end;
  begin perform public.validate_venue_hold_notification(gen_random_uuid(),gen_random_uuid());raise exception '[TC-SCRUM-163-S16] browser validation access';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- Ended-after-expiry history remains deliverable even after another booking is confirmed.
truncate public.notification_outbox,public.venue_hold_notification_state,public.venue_bookings;
update public.events set cancelled_at=null;
insert into public.venue_bookings(venue_id,event_id,coordinator_id,booking_date,slot,event_name,status,expires_at,requested_by)
values('aaaaaaaa-0163-4163-8163-000000000001','eeeeeeee-0163-4163-8163-000000000001','11111111-1111-4111-8111-111111111111','2099-10-10','pm','Client','hold',now()-interval '1 second','venue-staff');
update public.venue_bookings set status='cancelled';
do $$ begin
  if public.enqueue_venue_hold_notifications() is distinct from 1 then raise exception '[TC-SCRUM-163-S17] historical expiry lost after later conversion';end if;
end $$;
-- Capture errors must roll back the associated hold write, not leave an untracked reservation.
update public.events set name='Capture failure';
alter table public.venue_hold_notification_state add constraint fixture_capture_down check(event_name<>'Capture failure');
do $$ begin
  begin
    insert into public.venue_bookings(id,venue_id,event_id,coordinator_id,booking_date,slot,event_name,status,expires_at,requested_by)
    values('bbbbbbbb-0163-4163-8163-000000000019','aaaaaaaa-0163-4163-8163-000000000001','eeeeeeee-0163-4163-8163-000000000001','11111111-1111-4111-8111-111111111111','2099-10-19','am','Client','hold',now()+interval '1 hour','venue-staff');
    raise exception '[TC-SCRUM-163-S19] expected capture failure';
  exception when check_violation then null; end;
  if exists(select 1 from public.venue_bookings where id='bbbbbbbb-0163-4163-8163-000000000019') then raise exception '[TC-SCRUM-163-S19] untracked business hold survived capture failure';end if;
end $$;
alter table public.venue_hold_notification_state drop constraint fixture_capture_down;
update public.events set name='Community Open Day';
truncate public.notification_outbox,public.venue_hold_notification_state,public.venue_bookings;
-- A persisted close-before-expiry fact must remain suppressed when the worker next runs after the deadline.
insert into public.venue_hold_notification_state(hold_id,venue_id,event_id,coordinator_id,venue_name,event_name,booking_date,held_at,expires_at,ended_at)
values(gen_random_uuid(),'aaaaaaaa-0163-4163-8163-000000000001','eeeeeeee-0163-4163-8163-000000000001','11111111-1111-4111-8111-111111111111','Marina Hall','Community Open Day','2099-10-10',now()-interval '2 hours',now()-interval '1 hour',now()-interval '1 hour 0.001 seconds');
do $$ begin
  if public.enqueue_venue_hold_notifications() is distinct from 0 then raise exception '[TC-SCRUM-163-S20] converted-before-expiry history produced a false expiry';end if;
end $$;
-- Legacy holds with missing linkage must not fall back to notifying the staff creator.
insert into public.venue_bookings(venue_id,event_id,coordinator_id,booking_date,slot,event_name,status,expires_at,requested_by)
values('aaaaaaaa-0163-4163-8163-000000000001',null,null,'2099-10-21','am','Legacy','hold',now()+interval '30 minutes','33333333-3333-4333-8333-333333333333');
do $$ begin
  if public.enqueue_venue_hold_notifications() is distinct from 0 then raise exception '[TC-SCRUM-163-S21] legacy hold notified its creator';end if;
end $$;
truncate public.notification_outbox,public.venue_hold_notification_state,public.venue_bookings;
begin;
insert into public.venue_bookings(venue_id,event_id,coordinator_id,booking_date,slot,event_name,status,expires_at,requested_by)
values('aaaaaaaa-0163-4163-8163-000000000001','eeeeeeee-0163-4163-8163-000000000001','11111111-1111-4111-8111-111111111111','2099-10-22','am','Client','hold',now()+interval '0.001 seconds','venue-staff');
do $$ declare queued integer;begin
  queued:=public.enqueue_venue_hold_notifications();
  if queued is distinct from 1
    or not exists(select 1 from public.notification_outbox where payload->>'changeType'='expiring') then raise exception '[TC-SCRUM-163-S22] last live millisecond excluded';end if;
end $$;
-- Deliberately advance past a known deadline; do not assume asynchronous work completes during a sleep.
select pg_sleep(0.02);
do $$ declare q public.notification_outbox%rowtype;begin
  select * into strict q from public.claim_notification_outbox();
  if public.validate_venue_hold_notification(q.id,q.lease_token) is distinct from false then raise exception '[TC-SCRUM-163-S22] expired warning accepted by real delivery clock';end if;
end $$;
commit;
do $$ declare queued integer;begin
  queued:=public.enqueue_venue_hold_notifications();
  if queued is distinct from 1 or (select count(*) from public.notification_outbox where payload->>'changeType'='expired')<>1 then raise exception '[TC-SCRUM-163-S22] subsequent expiry fact missing';end if;
end $$;
truncate public.notification_outbox,public.venue_hold_notification_state,public.venue_bookings;
insert into public.venue_bookings(venue_id,event_id,coordinator_id,booking_date,slot,event_name,status,expires_at,requested_by)
select 'aaaaaaaa-0163-4163-8163-000000000001','eeeeeeee-0163-4163-8163-000000000001','11111111-1111-4111-8111-111111111111',date '2099-01-01'+n,'am','Client','hold',now()+interval '30 minutes','venue-staff' from generate_series(1,101) n;
do $$ declare first_batch integer;second_batch integer;empty_batch integer;begin
  first_batch:=public.enqueue_venue_hold_notifications();
  second_batch:=public.enqueue_venue_hold_notifications();
  empty_batch:=public.enqueue_venue_hold_notifications();
  if first_batch is distinct from 100 or second_batch is distinct from 1
    or empty_batch is distinct from 0 or (select count(*) from public.notification_outbox)<>101 then raise exception '[TC-SCRUM-163-S23] batch boundary lost or duplicated a cohort';end if;
  delete from public.notification_outbox;
  if public.enqueue_venue_hold_notifications() is distinct from 0 then raise exception '[TC-SCRUM-163-S23] completed batch recreated';end if;
end $$;

select 'VENUE HOLD SQL ASSERTIONS PASSED';

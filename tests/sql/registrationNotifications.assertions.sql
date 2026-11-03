-- SCRUM-43: exact documented SQL, exercised against disposable tables only.
do $$ begin
  if public.enqueue_registration_notifications() <> 0 then
    raise exception '[TC-SCRUM-43-S01] existing offer must not backfill promotion'; end if;
  if public.enqueue_waitlist_offer_reminders() <> 1 then
    raise exception '[TC-SCRUM-43-S01] existing active offer must receive due reminder'; end if;
  if not exists(select 1 from public.notification_outbox where workflow='waitlist-offer-expiring'
    and recipient_id='11111111-1111-4111-8111-111111111111'
    and payload->>'eventName'='Community Open Day') then
    raise exception '[TC-SCRUM-43-S01] wrong existing-offer recipient or event'; end if;
end $$;
delete from public.notification_outbox;
delete from public.event_waitlist_entries;
delete from public.registration_notification_history;

-- AC1: pending is not confirmed; confirmed inserts and updates both matter.
insert into public.registrations(id,event_id,attendee_id,status) values
('cccccccc-0043-4043-8043-000000000001','eeeeeeee-0043-4043-8043-000000000001','11111111-1111-4111-8111-111111111111','pending'),
('cccccccc-0043-4043-8043-000000000002','eeeeeeee-0043-4043-8043-000000000001','22222222-2222-4222-8222-222222222222','confirmed');
update public.registrations set status='confirmed' where id='cccccccc-0043-4043-8043-000000000001';
update public.registrations set status='confirmed';
do $$ begin
  if (select count(*) from public.registration_notification_history) <> 2
    or exists(select 1 from public.registration_notification_history where change_type <> 'confirmed') then
    raise exception '[TC-SCRUM-43-S02] confirmed transitions or unchanged-save suppression incorrect'; end if;
end $$;

-- AC1: actual queue transition, automatic/coordinator offers, then acceptance.
insert into public.event_waitlist_entries(id,event_id,attendee_id) values
('dddddddd-0043-4043-8043-000000000002','eeeeeeee-0043-4043-8043-000000000001','33333333-3333-4333-8333-333333333333');
update public.event_waitlist_entries set offer_state='offered',offered_at=now(),offer_expires_at=now()+interval '3 days';
update public.event_waitlist_entries set offer_state='offered';
do $$ begin
  if (select count(*) from public.registration_notification_history where change_type='waitlisted') <> 1
    or (select count(*) from public.registration_notification_history where change_type='promoted') <> 1 then
    raise exception '[TC-SCRUM-43-S03] join/promotion missing or duplicated'; end if;
end $$;

-- AC3/AC4: snapshot is used after an event rename; exact recipient-message set.
update public.events set name='Renamed later';
do $$ begin
  if public.enqueue_registration_notifications() <> 4 then
    raise exception '[TC-SCRUM-43-S04] missing transition notices'; end if;
  if (select count(*) from public.notification_outbox) <> 4
    or exists(select 1 from public.notification_outbox q
      left join public.registration_notification_history h on h.id=q.id
      where h.id is null or q.recipient_id is distinct from h.attendee_id
        or q.event_id is distinct from h.event_id
        or q.payload->>'changeId' is distinct from h.id::text
        or q.payload->>'eventId' is distinct from h.event_id::text
        or q.payload->>'eventName' is distinct from 'Community Open Day'
        or q.payload->>'requestPath' is distinct from '/registrations/me'
        or q.payload->>'changeType' is distinct from h.change_type)
    or not exists(select 1 from public.notification_outbox
      where recipient_id='22222222-2222-4222-8222-222222222222'
      and payload->>'message'='Your registration for Community Open Day is confirmed.')
    or not exists(select 1 from public.notification_outbox
      where recipient_id='33333333-3333-4333-8333-333333333333'
      and payload->>'message'='You have joined the waitlist for Community Open Day.')
    or not exists(select 1 from public.notification_outbox
      where payload->>'changeType'='promoted' and payload->>'message' like 'A place is available for you at Community Open Day. Accept your offer by % UTC.') then
    raise exception '[TC-SCRUM-43-S04] recipient or event/change snapshot incorrect'; end if;
  if public.enqueue_registration_notifications() <> 0 then
    raise exception '[TC-SCRUM-43-S05] repeated preparation duplicated history'; end if;
end $$;
delete from public.notification_outbox;
do $$ begin
  if public.enqueue_registration_notifications() <> 0 then
    raise exception '[TC-SCRUM-43-S05] completed deliveries were recreated'; end if;
end $$;

-- History failure rolls the business write back; provider work is independent.
alter table public.registration_notification_history add constraint fixture_history_down check(false) not valid;
do $$ begin
  begin
    insert into public.registrations(event_id,attendee_id,status) values
    ('eeeeeeee-0043-4043-8043-000000000001','44444444-4444-4444-8444-444444444444','confirmed');
    raise exception '[TC-SCRUM-43-S06] expected history constraint failure';
  exception when check_violation then null; end;
  if exists(select 1 from public.registrations where attendee_id='44444444-4444-4444-8444-444444444444') then
    raise exception '[TC-SCRUM-43-S06] failed capture left a business row'; end if;
end $$;
alter table public.registration_notification_history drop constraint fixture_history_down;
insert into public.registrations(event_id,attendee_id,status) values
('eeeeeeee-0043-4043-8043-000000000001','44444444-4444-4444-8444-444444444444','confirmed');
alter table public.notification_outbox add constraint fixture_delivery_down check(false) not valid;
do $$ begin
  begin perform public.enqueue_registration_notifications();
    raise exception '[TC-SCRUM-43-S07] expected queue failure';
  exception when check_violation then null; end;
  if (select count(*) from public.registration_notification_history where notifications_queued_at is null)<>1
    or not exists(select 1 from public.registrations where attendee_id='44444444-4444-4444-8444-444444444444') then
    raise exception '[TC-SCRUM-43-S07] queue failure lost saved registration or pending history'; end if;
end $$;
alter table public.notification_outbox drop constraint fixture_delivery_down;
select public.enqueue_registration_notifications();
delete from public.notification_outbox;

-- AC2: threshold before/exact/after and effective event-start cap. now() is fixed
-- within this transaction so these assertions measure the exact SQL boundary.
begin;
update public.event_waitlist_entries set offer_expires_at=now()+interval '1 hour 0.001 seconds';
do $$ begin
  if public.enqueue_waitlist_offer_reminders()<>0 then
    raise exception '[TC-SCRUM-43-S08] early reminder'; end if;
end $$;
update public.event_waitlist_entries set offer_expires_at=now()+interval '1 hour';
do $$ declare q public.notification_outbox%rowtype; begin
  if public.enqueue_waitlist_offer_reminders()<>1 then
    raise exception '[TC-SCRUM-43-S08] exact-threshold reminder missing'; end if;
  select * into strict q from public.claim_notification_outbox();
  if public.validate_waitlist_offer_reminder(q.id,q.lease_token) is distinct from true then
    raise exception '[TC-SCRUM-43-S09] active owned offer rejected'; end if;
  if public.validate_waitlist_offer_reminder(q.id,gen_random_uuid()) is distinct from false then
    raise exception '[TC-SCRUM-43-S09] stale worker token accepted'; end if;
  if public.enqueue_waitlist_offer_reminders()<>0 then
    raise exception '[TC-SCRUM-43-S10] repeated preparation duplicated reminder'; end if;
  perform public.finish_notification_outbox(q.id,q.lease_token,true);
  if public.enqueue_waitlist_offer_reminders()<>0 then
    raise exception '[TC-SCRUM-43-S10] completed reminder recreated'; end if;
end $$;
-- A later genuine offer gets a new history/reminder identity.
update public.event_waitlist_entries set offered_at=now()+interval '0.001 seconds',offer_expires_at=now()+interval '59 minutes 59.999 seconds';
select public.enqueue_registration_notifications();
delete from public.notification_outbox;
do $$ begin
  if public.enqueue_waitlist_offer_reminders()<>1 then
    raise exception '[TC-SCRUM-43-S11] later genuine offer suppressed'; end if;
end $$;
-- Event start moved: retire the stale deadline and prepare the updated one.
update public.events set start_time=now()+interval '20 minutes';
do $$ declare q public.notification_outbox%rowtype; begin
  select * into strict q from public.claim_notification_outbox();
  if public.validate_waitlist_offer_reminder(q.id,q.lease_token) is distinct from false then
    raise exception '[TC-SCRUM-43-S12] stale deadline accepted'; end if;
  perform public.finish_notification_outbox(q.id,q.lease_token,true);
  if public.enqueue_waitlist_offer_reminders()<>1 then
    raise exception '[TC-SCRUM-43-S12] changed deadline not rescheduled'; end if;
  if not exists(select 1 from public.notification_outbox where
    (payload->>'effectiveDeadline')::timestamptz=now()+interval '20 minutes') then
    raise exception '[TC-SCRUM-43-S12] effective event-start cap missing'; end if;
end $$;
-- A queued reminder must not be sent after acceptance, even on retry.
-- SCRUM-43: the supplied acceptance/decline functions delete the active offer.
delete from public.event_waitlist_entries;
do $$ declare q public.notification_outbox%rowtype; begin
  select * into strict q from public.claim_notification_outbox();
  if public.validate_waitlist_offer_reminder(q.id,q.lease_token) is distinct from false then
    raise exception '[TC-SCRUM-43-S13] accepted-offer reminder accepted'; end if;
  perform public.finish_notification_outbox(q.id,q.lease_token,true);
end $$;
commit;

-- SCRUM-43-S14: live-schema partitions use null/offered and deleted rows.
insert into public.event_waitlist_entries(id,event_id,attendee_id)
values('dddddddd-0043-4043-8043-000000000003','eeeeeeee-0043-4043-8043-000000000001','33333333-3333-4333-8333-333333333333');
do $$ begin
  if public.enqueue_waitlist_offer_reminders()<>0 then raise exception '[TC-SCRUM-43-S14] ordinary queue entry reminded'; end if;
end $$;
update public.event_waitlist_entries set offer_state='offered',offered_at=now(),offer_expires_at=now();
do $$ begin
  if public.enqueue_waitlist_offer_reminders()<>0 then raise exception '[TC-SCRUM-43-S14] expired deadline queued'; end if;
end $$;
delete from public.event_waitlist_entries;
do $$ begin
  if public.enqueue_waitlist_offer_reminders()<>0 then raise exception '[TC-SCRUM-43-S14] deleted/withdrawn offer queued'; end if;
end $$;
insert into public.event_waitlist_entries(id,event_id,attendee_id,offer_state,offered_at,offer_expires_at)
values('dddddddd-0043-4043-8043-000000000004','eeeeeeee-0043-4043-8043-000000000001','33333333-3333-4333-8333-333333333333','offered',now(),now()+interval '10 minutes');
update public.events set cancelled_at=now();
do $$ begin
  if public.enqueue_waitlist_offer_reminders()<>0 then raise exception '[TC-SCRUM-43-S14] cancelled_at ignored'; end if;
end $$;
update public.events set cancelled_at=null,start_time=null;
do $$ begin
  if public.enqueue_waitlist_offer_reminders()<>0 then raise exception '[TC-SCRUM-43-S14] missing start time ignored'; end if;
end $$;
update public.events set start_time=now()+interval '20 minutes';
select public.enqueue_registration_notifications();
delete from public.notification_outbox;
do $$ declare q public.notification_outbox%rowtype; begin
  if public.enqueue_waitlist_offer_reminders()<>1 then raise exception '[TC-SCRUM-43-S14] valid control offer not queued'; end if;
  select * into strict q from public.claim_notification_outbox();
  update public.events set cancelled_at=now();
  if public.validate_waitlist_offer_reminder(q.id,q.lease_token) is distinct from false then raise exception '[TC-SCRUM-43-S14] queued reminder survived cancelled_at'; end if;
  update public.events set cancelled_at=null,start_time=null;
  if public.validate_waitlist_offer_reminder(q.id,q.lease_token) is distinct from false then raise exception '[TC-SCRUM-43-S14] queued reminder survived missing start time'; end if;
  perform public.finish_notification_outbox(q.id,q.lease_token,true);
end $$;
update public.events set start_time=now()+interval '20 minutes',status='CANCELLED';
do $$ begin
  if public.enqueue_waitlist_offer_reminders()<>0 then raise exception '[TC-SCRUM-43-S14] cancelled event queued'; end if;
end $$;

-- Service-only access: denies browser users even without any row policies.
set role authenticated;
do $$ begin
  begin perform count(*) from public.registration_notification_history;
    raise exception '[TC-SCRUM-43-S15] browser could read other attendees history';
  exception when insufficient_privilege then null; end;
  begin perform public.enqueue_registration_notifications();
    raise exception '[TC-SCRUM-43-S15] browser could prepare notifications';
  exception when insufficient_privilege then null; end;
  begin perform public.enqueue_waitlist_offer_reminders();
    raise exception '[TC-SCRUM-43-S15] browser could prepare reminders';
  exception when insufficient_privilege then null; end;
  begin perform public.validate_waitlist_offer_reminder(gen_random_uuid(),gen_random_uuid());
    raise exception '[TC-SCRUM-43-S15] browser could validate arbitrary recipient';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
-- SCRUM-43-S17..S20: exact supplied RPC bodies with explicit ancillary stubs.
truncate public.notification_outbox, public.registration_notification_history,
  public.registrations, public.event_waitlist_entries;
update public.events set status='APPROVED',cancelled_at=null,
  start_time=now()+interval '10 days',expected_attendance=1,enrolled_attendees=1;
insert into public.event_waitlist_entries(id,event_id,attendee_id,registration_data)
values('dddddddd-0043-4043-8043-000000000010','eeeeeeee-0043-4043-8043-000000000001','11111111-1111-4111-8111-111111111111','{}');
do $$ declare result jsonb; begin
  result := public.promote_waitlist_entry('eeeeeeee-0043-4043-8043-000000000001','dddddddd-0043-4043-8043-000000000010','44444444-4444-4444-8444-444444444444',null);
  if result->>'outcome' is distinct from 'registered_over_capacity' then raise exception '[TC-SCRUM-43-S17] direct promotion outcome incorrect: %',result; end if;
  if (select count(*) from public.registration_notification_history)<>2
    or (select count(*) from public.registration_notification_history where change_type='confirmed')<>1
    or exists(select 1 from public.registration_notification_history where change_type='promoted')
    or not exists(select 1 from public.event_waitlist_entries where status='promoted' and offer_state is null) then
    raise exception '[TC-SCRUM-43-S17] direct promotion duplicated/missed confirmation or altered existing outcome'; end if;
  result := public.promote_waitlist_entry('eeeeeeee-0043-4043-8043-000000000001','dddddddd-0043-4043-8043-000000000010','44444444-4444-4444-8444-444444444444',null);
  if result->>'outcome' is distinct from 'already_promoted' or (select count(*) from public.registration_notification_history)<>2 then
    raise exception '[TC-SCRUM-43-S17] repeat direct promotion added a notice'; end if;
end $$;
update public.events set expected_attendance=10;
insert into public.event_waitlist_entries(id,event_id,attendee_id,registration_data)
values('dddddddd-0043-4043-8043-000000000011','eeeeeeee-0043-4043-8043-000000000001','22222222-2222-4222-8222-222222222222','{}');
do $$ declare result jsonb; begin
  result := public.promote_waitlist_entry('eeeeeeee-0043-4043-8043-000000000001','dddddddd-0043-4043-8043-000000000011','44444444-4444-4444-8444-444444444444',null);
  if result->>'outcome' is distinct from 'offered' or (select count(*) from public.registration_notification_history where change_type='promoted')<>1 then
    raise exception '[TC-SCRUM-43-S18] coordinator offer not captured: %',result; end if;
end $$;
update public.event_waitlist_entries set offer_expires_at=now()+interval '30 minutes' where status='active';
select public.enqueue_registration_notifications();
delete from public.notification_outbox;
select public.enqueue_waitlist_offer_reminders();
do $$ declare result jsonb; q public.notification_outbox%rowtype; begin
  select * into strict q from public.claim_notification_outbox();
  result := public.accept_waitlist_offer('eeeeeeee-0043-4043-8043-000000000001','22222222-2222-4222-8222-222222222222');
  if result->>'outcome' is distinct from 'accepted' or exists(select 1 from public.event_waitlist_entries where attendee_id='22222222-2222-4222-8222-222222222222')
    or (select count(*) from public.registration_notification_history where change_type='confirmed')<>2 then
    raise exception '[TC-SCRUM-43-S19] acceptance/delete/confirmation incorrect: %',result; end if;
  if public.validate_waitlist_offer_reminder(q.id,q.lease_token) is distinct from false then raise exception '[TC-SCRUM-43-S19] deleted accepted offer remained deliverable'; end if;
  perform public.finish_notification_outbox(q.id,q.lease_token,true);
end $$;
insert into public.event_waitlist_entries(id,event_id,attendee_id,registration_data,offer_state,offered_at,offer_expires_at)
values('dddddddd-0043-4043-8043-000000000012','eeeeeeee-0043-4043-8043-000000000001','33333333-3333-4333-8333-333333333333','{}','offered',now(),now()+interval '30 minutes');
select public.enqueue_registration_notifications();
delete from public.notification_outbox;
select public.enqueue_waitlist_offer_reminders();
do $$ declare result jsonb; q public.notification_outbox%rowtype; begin
  select * into strict q from public.claim_notification_outbox();
  result := public.decline_waitlist_offer('eeeeeeee-0043-4043-8043-000000000001','33333333-3333-4333-8333-333333333333');
  if result->>'outcome' is distinct from 'declined' or exists(select 1 from public.event_waitlist_entries where attendee_id='33333333-3333-4333-8333-333333333333') then
    raise exception '[TC-SCRUM-43-S20] declined offer was not deleted: %',result; end if;
  if public.validate_waitlist_offer_reminder(q.id,q.lease_token) is distinct from false then raise exception '[TC-SCRUM-43-S20] deleted declined offer remained deliverable'; end if;
  perform public.finish_notification_outbox(q.id,q.lease_token,true);
end $$;
-- Leave one offer for the existing two-worker concurrency assertion (S16).
insert into public.event_waitlist_entries(id,event_id,attendee_id,offer_state,offered_at,offer_expires_at)
values('dddddddd-0043-4043-8043-000000000013','eeeeeeee-0043-4043-8043-000000000001','33333333-3333-4333-8333-333333333333','offered',now(),now()+interval '30 minutes');
select 'REGISTRATION EXPORTED RPC ASSERTIONS PASSED';

-- SCRUM-43-S21: an expired delivery lease is not an obsolete business offer.
truncate public.notification_outbox, public.registration_notification_history,
  public.registrations, public.event_waitlist_entries;
update public.events set status='APPROVED',cancelled_at=null,start_time=now()+interval '1 day';
insert into public.event_waitlist_entries(id,event_id,attendee_id,offer_state,offered_at,offer_expires_at)
values('dddddddd-0043-4043-8043-000000000021','eeeeeeee-0043-4043-8043-000000000001',
 '11111111-1111-4111-8111-111111111111','offered',now(),now()+interval '30 minutes');
select public.enqueue_registration_notifications();
delete from public.notification_outbox;
select public.enqueue_waitlist_offer_reminders();
do $$ declare q public.notification_outbox%rowtype; begin
  select * into strict q from public.claim_notification_outbox();
  if public.validate_waitlist_offer_reminder(q.id,q.lease_token) is distinct from true then
    raise exception '[TC-SCRUM-43-S21] positive control is not a valid offer'; end if;
  update public.notification_outbox set locked_until=clock_timestamp()-interval '1 second' where id=q.id;
  begin
    perform public.validate_waitlist_offer_reminder(q.id,q.lease_token);
    raise exception '[TC-SCRUM-43-S21] expired lease was classified as complete/discardable';
  exception when sqlstate '55000' then null; end;
  if not exists(select 1 from public.notification_outbox where id=q.id and recipient_id=q.recipient_id) then
    raise exception '[TC-SCRUM-43-S21] unsent reminder disappeared'; end if;
  perform public.finish_notification_outbox(q.id,q.lease_token,false);
  if not exists(select 1 from public.notification_outbox where id=q.id and lease_token is null)
    or not exists(select 1 from public.registration_notification_history where reminder_id=q.id and reminder_queued_at is not null) then
    raise exception '[TC-SCRUM-43-S21] stable retry identity or processed marker lost'; end if;
end $$;

-- SCRUM-43-S22: reminder identity is per offer, not per event.
truncate public.notification_outbox, public.registration_notification_history, public.event_waitlist_entries;
insert into public.event_waitlist_entries(id,event_id,attendee_id,offer_state,offered_at,offer_expires_at) values
('dddddddd-0043-4043-8043-000000000022','eeeeeeee-0043-4043-8043-000000000001','11111111-1111-4111-8111-111111111111','offered',now(),now()+interval '30 minutes'),
('dddddddd-0043-4043-8043-000000000023','eeeeeeee-0043-4043-8043-000000000001','22222222-2222-4222-8222-222222222222','offered',now(),now()+interval '30 minutes');
select public.enqueue_registration_notifications();
delete from public.notification_outbox;
do $$ begin
  begin
    if public.enqueue_waitlist_offer_reminders() is distinct from 2 then
      raise exception '[TC-SCRUM-43-S22] simultaneous owners were collapsed'; end if;
  exception when unique_violation then
    raise exception '[TC-SCRUM-43-S22] per-event uniqueness rejects the second owner'; end;
  if (select count(*) from public.notification_outbox)<>2
    or (select count(distinct recipient_id) from public.notification_outbox)<>2
    or exists(select 1 from public.notification_outbox q left join public.registration_notification_history h
      on h.id=(q.payload->>'offerChangeId')::uuid
      left join public.event_waitlist_entries w on w.id=h.source_id
      where h.id is null or q.id is distinct from h.reminder_id or q.recipient_id is distinct from h.attendee_id
        or q.payload->>'changeType' is distinct from 'offer-expiring'
        or q.payload->>'eventName' is distinct from 'Renamed later'
        or q.payload->>'requestPath' is distinct from '/registrations/me'
        or (q.payload->>'effectiveDeadline')::timestamptz is distinct from w.offer_expires_at
        or q.payload->>'message' is null
        or q.payload->>'message' !~ '^Your place offer for Renamed later expires at [0-9-]{10} [0-9:]{8} UTC[.] Open My Registrations to accept or decline[.]$'
        or (substring(q.payload->>'message' from 'expires at ([0-9-]{10} [0-9:]{8}) UTC')::timestamp at time zone 'UTC')
          is distinct from date_trunc('second',w.offer_expires_at)) then
    raise exception '[TC-SCRUM-43-S22] reminder identity, owner or content fields incorrect'; end if;
  if public.enqueue_waitlist_offer_reminders()<>0 then raise exception '[TC-SCRUM-43-S22] reminder repeated'; end if;
end $$;
delete from public.notification_outbox;
do $$ begin
  if public.enqueue_waitlist_offer_reminders()<>0 then raise exception '[TC-SCRUM-43-S22] completed reminders recreated'; end if;
end $$;

-- SCRUM-43-S23: a fixed transaction clock gives exact, repeatable deadline boundaries.
begin;
truncate public.notification_outbox, public.registration_notification_history, public.event_waitlist_entries;
insert into public.event_waitlist_entries(id,event_id,attendee_id,offer_state,offered_at,offer_expires_at)
values('dddddddd-0043-4043-8043-000000000024','eeeeeeee-0043-4043-8043-000000000001',
 '11111111-1111-4111-8111-111111111111','offered',now(),now());
do $$ begin
  if public.enqueue_waitlist_offer_reminders()<>0 then raise exception '[TC-SCRUM-43-S23] exact expiry was queued'; end if;
end $$;
update public.event_waitlist_entries set offer_expires_at=now()-interval '0.001 seconds';
do $$ begin
  if public.enqueue_waitlist_offer_reminders()<>0 then raise exception '[TC-SCRUM-43-S23] after expiry was queued'; end if;
end $$;
update public.event_waitlist_entries set offer_expires_at=now()+interval '0.001 seconds';
select public.enqueue_registration_notifications();
delete from public.notification_outbox;
do $$ begin
  if public.enqueue_waitlist_offer_reminders()<>1 then raise exception '[TC-SCRUM-43-S23] final live millisecond was excluded from preparation'; end if;
end $$;
-- Real delivery clock has passed the one-millisecond deadline; it must now refuse delivery.
select pg_sleep(0.01);
do $$ declare q public.notification_outbox%rowtype; begin
  select * into strict q from public.claim_notification_outbox();
  if public.validate_waitlist_offer_reminder(q.id,q.lease_token) is distinct from false then
    raise exception '[TC-SCRUM-43-S23] expired reminder stayed deliverable'; end if;
end $$;
commit;

-- SCRUM-43-S25: a backlog beyond the 100-row preparation batch is neither lost nor repeated.
truncate public.notification_outbox, public.registration_notification_history, public.event_waitlist_entries;
insert into public.registration_notification_history(event_id,event_name,attendee_id,source_id,change_type)
select 'eeeeeeee-0043-4043-8043-000000000001','Batch snapshot',
 '11111111-1111-4111-8111-111111111111',gen_random_uuid(),'confirmed'
from generate_series(1,101);
do $$ declare first_batch integer; second_batch integer; begin
  first_batch := public.enqueue_registration_notifications();
  second_batch := public.enqueue_registration_notifications();
  if first_batch is null or second_batch is null or first_batch<1 or first_batch>100
    or second_batch<1 or second_batch>100 or first_batch+second_batch<>101
    or (select count(*) from public.notification_outbox)<>101
    or (select count(distinct id) from public.notification_outbox)<>101
    or exists(select 1 from public.registration_notification_history where notifications_queued_at is null) then
    raise exception '[TC-SCRUM-43-S25] registration preparation lost or repeated a batch boundary row'; end if;
  delete from public.notification_outbox;
  if public.enqueue_registration_notifications() is distinct from 0 then
    raise exception '[TC-SCRUM-43-S25] completed status batches were recreated'; end if;
end $$;
truncate public.notification_outbox, public.registration_notification_history, public.event_waitlist_entries;
insert into public.events(id,name,organiser_id,status,start_time)
select gen_random_uuid(),'SCRUM-43 batch offer fixture '||n,
 '11111111-1111-4111-8111-111111111111','APPROVED',now()+interval '1 day'
from generate_series(1,101) n;
insert into public.event_waitlist_entries(event_id,attendee_id,offer_state,offered_at,offer_expires_at)
select id,'11111111-1111-4111-8111-111111111111','offered',now(),now()+interval '30 minutes'
from public.events where name like 'SCRUM-43 batch offer fixture %';
do $$ declare first_batch integer; second_batch integer; begin
  first_batch := public.enqueue_waitlist_offer_reminders();
  second_batch := public.enqueue_waitlist_offer_reminders();
  if first_batch is null or second_batch is null or first_batch<1 or first_batch>100
    or second_batch<1 or second_batch>100 or first_batch+second_batch<>101
    or (select count(*) from public.notification_outbox)<>101
    or (select count(distinct payload->>'offerChangeId') from public.notification_outbox)<>101 then
    raise exception '[TC-SCRUM-43-S25] reminder preparation lost or repeated a batch boundary row'; end if;
  delete from public.notification_outbox;
  if public.enqueue_waitlist_offer_reminders() is distinct from 0 then
    raise exception '[TC-SCRUM-43-S25] completed reminder batches were recreated'; end if;
end $$;
truncate public.notification_outbox, public.registration_notification_history, public.event_waitlist_entries;
delete from public.events where name like 'SCRUM-43 batch offer fixture %';

-- Restore one offer for the existing concurrent-worker case S16.
truncate public.notification_outbox, public.registration_notification_history, public.event_waitlist_entries;
insert into public.event_waitlist_entries(id,event_id,attendee_id,offer_state,offered_at,offer_expires_at)
values('dddddddd-0043-4043-8043-000000000025','eeeeeeee-0043-4043-8043-000000000001',
 '33333333-3333-4333-8333-333333333333','offered',now(),now()+interval '30 minutes');

select 'REGISTRATION SQL ASSERTIONS PASSED';

-- SCRUM-155: notification preparation only, seeded with saved assignment history.
-- Disposable local PostgreSQL after both documented notification schema blocks.
grant usage on schema public, auth to service_role;
truncate public.notification_outbox, public.event_assignment_history, public.events;
insert into auth.users values
 ('22222222-2222-4222-8222-222222222222'),
 ('33333333-3333-4333-8333-333333333333'),
 ('44444444-4444-4444-8444-444444444444');
insert into public.events(id, name, status) values
 ('aaaaaaaa-0001-4000-8000-000000000000', 'Community Open Day', 'SUBMITTED');
set role service_role;

-- AC1/AC3: notify only the incoming coordinator from an initial saved assignment.
insert into public.event_assignment_history(event_id,event_name,incoming_coordinator_id,assigned_by_id,assigned_by_name)
 values ('aaaaaaaa-0001-4000-8000-000000000000','Community Open Day',
 '22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444','Ada Lead');
do $$ begin
 perform public.enqueue_assignment_notifications();
 if (select count(*) from public.notification_outbox) <> 1 or not exists(
   select 1 from public.notification_outbox q join public.event_assignment_history h on q.payload->>'assignmentChangeId' = h.id::text
   where q.recipient_id = '22222222-2222-4222-8222-222222222222' and q.workflow = 'event-assignment'
     and q.payload = jsonb_build_object('assignmentChangeId', h.id, 'eventId', h.event_id,
       'eventName', 'Community Open Day', 'assignedById', '44444444-4444-4444-8444-444444444444',
       'assignedByName', 'Ada Lead', 'assignmentType', 'assigned')
 ) then raise exception '[TC-SCRUM-155-S01] initial recipient or attribution incorrect'; end if;
end $$;

-- AC2/AC3: process saved reassignment history, not the current event name.
delete from public.notification_outbox;
insert into public.event_assignment_history(event_id,event_name,incoming_coordinator_id,outgoing_coordinator_id,assigned_by_id,assigned_by_name)
 values ('aaaaaaaa-0001-4000-8000-000000000000','Community Open Day',
 '33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222',
 '44444444-4444-4444-8444-444444444444','Ben Lead');
reset role;
update public.events set name = 'Renamed after reassignment';
set role service_role;
do $$ declare change_id uuid; begin
 select id into strict change_id from public.event_assignment_history where notifications_queued_at is null;
 perform public.enqueue_assignment_notifications();
 if (select count(*) from public.notification_outbox) <> 2 then
   raise exception '[TC-SCRUM-155-S02] reassignment must notify exactly incoming and outgoing'; end if;
 if (select jsonb_agg(jsonb_build_object('recipient', recipient_id, 'payload', payload, 'workflow', workflow) order by recipient_id)
     from public.notification_outbox) is distinct from jsonb_build_array(
   jsonb_build_object('recipient', '22222222-2222-4222-8222-222222222222', 'workflow', 'event-assignment', 'payload',
     jsonb_build_object('assignmentChangeId', change_id, 'eventId', 'aaaaaaaa-0001-4000-8000-000000000000',
       'eventName', 'Community Open Day', 'assignedById', '44444444-4444-4444-8444-444444444444',
       'assignedByName', 'Ben Lead', 'assignmentType', 'reassigned-away')),
   jsonb_build_object('recipient', '33333333-3333-4333-8333-333333333333', 'workflow', 'event-assignment', 'payload',
     jsonb_build_object('assignmentChangeId', change_id, 'eventId', 'aaaaaaaa-0001-4000-8000-000000000000',
       'eventName', 'Community Open Day', 'assignedById', '44444444-4444-4444-8444-444444444444',
       'assignedByName', 'Ben Lead', 'assignmentType', 'reassigned'))
 ) then raise exception '[TC-SCRUM-155-S02] recipient, message variant or saved names incorrect'; end if;
end $$;

-- Supporting notification regression: repeated preparation does not replay queued history.
do $$ declare prepared integer; begin
 prepared := public.enqueue_assignment_notifications();
 if prepared <> 0 or (select count(*) from public.notification_outbox) <> 2
    or (select count(*) from public.event_assignment_history) <> 2 then
   raise exception '[TC-SCRUM-155-S03] repeat preparation duplicated messages or lost history'; end if;
end $$;
reset role;

-- Supporting delivery failure: pending notification history survives and can be retried.
alter table public.notification_outbox add constraint fixture_queue_down check(false) not valid;
set role service_role;
insert into public.event_assignment_history(event_id,event_name,incoming_coordinator_id,outgoing_coordinator_id,assigned_by_id,assigned_by_name)
 values ('aaaaaaaa-0001-4000-8000-000000000000','Another saved name',
 '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
 '44444444-4444-4444-8444-444444444444','Lead');
do $$ begin
 begin
   perform public.enqueue_assignment_notifications();
   raise exception '[TC-SCRUM-155-S04] queue failure fixture was not exercised';
 exception when check_violation then null;
 end;
 if (select count(*) from public.event_assignment_history where notifications_queued_at is null) <> 1
    or (select count(*) from public.notification_outbox) <> 2 then
   raise exception '[TC-SCRUM-155-S04] failed preparation lost history or changed existing deliveries'; end if;
end $$;
reset role;
alter table public.notification_outbox drop constraint fixture_queue_down;
set role service_role;
do $$ declare prepared integer; begin
 prepared := public.enqueue_assignment_notifications();
 if prepared <> 1 or (select count(*) from public.notification_outbox) <> 4 then
   raise exception '[TC-SCRUM-155-S04] pending notifications did not recover'; end if;
end $$;
reset role;

-- Supporting notification security: browser roles cannot access pending delivery work.
set role authenticated;
do $$ begin
 begin perform * from public.event_assignment_history; raise exception '[TC-SCRUM-155-S05] history exposed'; exception when insufficient_privilege then null; end;
 begin perform * from public.notification_outbox; raise exception '[TC-SCRUM-155-S05] queue exposed'; exception when insufficient_privilege then null; end;
 begin perform public.enqueue_assignment_notifications(); raise exception '[TC-SCRUM-155-S05] queue RPC exposed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'ASSIGNMENT SQL ASSERTIONS PASSED' as evidence;

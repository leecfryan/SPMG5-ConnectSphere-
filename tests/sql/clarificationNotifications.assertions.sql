-- SCRUM-117: exercise the exact documented function and notification trigger.
set role service_role;
do $$ begin
 -- S01: refused identity and invalid input leave no side effects.
 perform public.request_event_changes('aaaaaaaa-0001-4000-8000-000000000000','33333333-3333-4333-8333-333333333333','Wrong coordinator');
 begin
   perform public.request_event_changes('aaaaaaaa-0001-4000-8000-000000000000','22222222-2222-4222-8222-222222222222','   ');
   raise exception 'SCRUM-117-S01 blank message accepted';
 exception when invalid_parameter_value then null; end;
 if exists(select 1 from public.event_activity_log) or exists(select 1 from public.notification_outbox)
   or (select status from public.events limit 1) <> 'UNDER_REVIEW' then raise exception 'SCRUM-117-S01 refusal mutated data'; end if;
 -- S02: successful return queues the exact saved message, owner and path once.
 perform public.request_event_changes('aaaaaaaa-0001-4000-8000-000000000000','22222222-2222-4222-8222-222222222222','  Clarify layout & attendance.  ');
 if (select count(*) from public.notification_outbox) <> 1 or not exists (
   select 1 from public.notification_outbox q join public.event_activity_log h on h.id = q.id
   join public.events e on e.id = q.event_id
   where q.workflow = 'event-changes-requested' and q.recipient_id = e.organiser_id
     and e.status = 'CHANGES_REQUESTED' and e.coordinator_id = '22222222-2222-4222-8222-222222222222'
     and q.payload = jsonb_build_object('eventId',e.id,'cycleId',h.id,'eventName','Community Workshop',
       'message','Clarify layout & attendance.','requestPath','/my-event-requests/aaaaaaaa-0001-4000-8000-000000000000')
 ) then raise exception 'SCRUM-117-S02 notice or transition incorrect'; end if;
 perform public.request_event_changes('aaaaaaaa-0001-4000-8000-000000000000','22222222-2222-4222-8222-222222222222','Duplicate');
 if (select count(*) from public.notification_outbox) <> 1 or (select count(*) from public.event_activity_log) <> 1 then
   raise exception 'SCRUM-117-S02 duplicate return queued'; end if;
end $$;
reset role;
-- S03: simulate a later review cycle; this fixture does not implement resubmission.
update public.events set status='UNDER_REVIEW';
set role service_role;
select public.request_event_changes('aaaaaaaa-0001-4000-8000-000000000000','22222222-2222-4222-8222-222222222222','Clarify equipment.');
do $$ begin
 if (select count(distinct id) from public.notification_outbox) <> 2
   or (select count(*) from public.notification_outbox where payload->>'message'='Clarify layout & attendance.') <> 1
   or (select count(*) from public.notification_outbox where payload->>'message'='Clarify equipment.') <> 1 then
   raise exception 'SCRUM-117-S03 cycles lost or overwritten'; end if;
end $$;
reset role;
-- S04: force queue failure and prove rollback of status and newly inserted history.
update public.events set status='UNDER_REVIEW';
alter table public.notification_outbox add constraint fixture_queue_down check(false) not valid;
set role service_role;
do $$ begin
 begin
  perform public.request_event_changes('aaaaaaaa-0001-4000-8000-000000000000','22222222-2222-4222-8222-222222222222','Must roll back');
  raise exception 'SCRUM-117-S04 unavailable queue accepted';
 exception when check_violation then null; end;
 if (select status from public.events limit 1) <> 'UNDER_REVIEW'
   or (select count(*) from public.event_activity_log) <> 2
   or (select count(*) from public.notification_outbox) <> 2 then raise exception 'SCRUM-117-S04 partial return persisted'; end if;
end $$;
reset role;
alter table public.notification_outbox drop constraint fixture_queue_down;
-- S05: browser roles cannot invoke transition/trigger or read queued message data.
do $$ declare browser_role text; begin
 foreach browser_role in array array['anon','authenticated'] loop
  if has_function_privilege(browser_role,'public.request_event_changes(uuid,uuid,text)','EXECUTE')
    or has_function_privilege(browser_role,'public.enqueue_event_changes_requested_notification()','EXECUTE')
    or has_table_privilege(browser_role,'public.notification_outbox','SELECT') then
    raise exception 'SCRUM-117-S05 browser role has backend access'; end if;
 end loop;
end $$;
select 'CLARIFICATION SQL ASSERTIONS PASSED' as evidence;

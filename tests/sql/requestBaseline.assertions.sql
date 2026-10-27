
reset role;
insert into public.events(id,name,status,organiser_id,coordinator_id,purpose,description,start_time,end_time,expected_attendance)
values('bbbbbbbb-0117-4117-8117-000000000001','Baseline proof','SUBMITTED',
 '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','Workshop','Original details','2099-01-01T01:00:00Z','2099-01-01T03:00:00Z',30);
update public.events set status='UNDER_REVIEW' where id='bbbbbbbb-0117-4117-8117-000000000001';
update public.events set expected_attendance=45 where id='bbbbbbbb-0117-4117-8117-000000000001';
set role service_role;
do $$ declare eid uuid:='bbbbbbbb-0117-4117-8117-000000000001'; cycle uuid; expected jsonb; begin
 if not exists(select 1 from public.event_activity_log where event_id=eid and action='REQUEST_BASELINE_RECORDED'
   and details->>'source'='SUBMITTED' and details->'snapshot'->>'expected_attendance'='30') then raise exception 'BASELINE01 ordinary save replaced submitted baseline'; end if;
 perform public.request_event_changes(eid,'22222222-2222-4222-8222-222222222222','Confirm the saved edit');
 select id,details->'before' into cycle,expected from public.event_activity_log where event_id=eid and action='CHANGES_REQUESTED';
 if expected->>'expected_attendance'<>'45' then raise exception 'BASELINE01 return snapshot incorrect'; end if;
 perform public.resubmit_event_request(eid,'11111111-1111-4111-8111-111111111111',cycle,expected);
 if not exists(select 1 from public.event_activity_log where event_id=eid and action='REQUEST_RESUBMITTED'
   and details->'changes'='[{"field":"expected_attendance","before":30,"after":45}]'::jsonb) then raise exception 'BASELINE01 pre-return edit omitted'; end if;
 if not exists(select 1 from public.notification_outbox where event_id=eid and workflow='event-request-resubmitted' and payload->>'changedFieldCount'='1') then raise exception 'BASELINE01 wrong notice count'; end if;
 if (select details->'snapshot'->>'expected_attendance' from public.event_activity_log where event_id=eid and action='REQUEST_BASELINE_RECORDED' order by created_at desc,id desc limit 1)<>'45' then raise exception 'BASELINE01 baseline not advanced'; end if;
end $$;
do $$ declare eid uuid:='bbbbbbbb-0117-4117-8117-000000000001'; cycle uuid; expected jsonb; begin
 update public.events set expected_attendance=50 where id=eid;
 if (select details->'snapshot'->>'expected_attendance' from public.event_activity_log where event_id=eid and action='REQUEST_BASELINE_RECORDED' order by created_at desc,id desc limit 1)<>'45' then raise exception 'BASELINE02 later save reset baseline'; end if;
 update public.events set expected_attendance=45 where id=eid;
 perform public.request_event_changes(eid,'22222222-2222-4222-8222-222222222222','Confirm reverted values');
 select id,details->'before' into cycle,expected from public.event_activity_log where event_id=eid and action='CHANGES_REQUESTED' order by created_at desc,id desc limit 1;
 perform public.resubmit_event_request(eid,'11111111-1111-4111-8111-111111111111',cycle,expected);
 if not exists(select 1 from public.event_activity_log where event_id=eid and action='REQUEST_RESUBMITTED' and details->>'cycle_id'=cycle::text and details->'changes'='[]') then raise exception 'BASELINE02 reverted values counted as changes'; end if;
 if not exists(select 1 from public.event_activity_log where event_id=eid and action='REQUEST_RESUBMITTED' and details->'changes'='[{"field":"expected_attendance","before":30,"after":45}]'::jsonb) then raise exception 'BASELINE02 previous comparison overwritten'; end if;
end $$;
update public.events set expected_attendance=60 where id='bbbbbbbb-0117-4117-8117-000000000001';
select public.request_event_changes('bbbbbbbb-0117-4117-8117-000000000001','22222222-2222-4222-8222-222222222222','Queue failure proof');
reset role;
alter table public.notification_outbox add constraint baseline_queue_down check(false) not valid;
set role service_role;
do $$ declare eid uuid:='bbbbbbbb-0117-4117-8117-000000000001'; cycle uuid; expected jsonb; baseline_count integer; begin
 select id,details->'before' into cycle,expected from public.event_activity_log where event_id=eid and action='CHANGES_REQUESTED' order by created_at desc,id desc limit 1;
 select count(*) into baseline_count from public.event_activity_log where event_id=eid and action='REQUEST_BASELINE_RECORDED';
 begin
 perform public.resubmit_event_request(eid,'11111111-1111-4111-8111-111111111111',cycle,expected);
 raise exception 'BASELINE03 queue failure accepted';
 exception when check_violation then null; end;
 if (select count(*) from public.event_activity_log where event_id=eid and action='REQUEST_BASELINE_RECORDED')<>baseline_count
  or (select status from public.events where id=eid)<>'CHANGES_REQUESTED' then raise exception 'BASELINE03 baseline/status partially committed'; end if;
end $$;
reset role;
alter table public.notification_outbox drop constraint baseline_queue_down;
insert into public.events(id,name,status,organiser_id,expected_attendance)
values('bbbbbbbb-0117-4117-8117-000000000002','Draft proof','DRAFT','11111111-1111-4111-8111-111111111111',10);
update public.events set expected_attendance=35 where id='bbbbbbbb-0117-4117-8117-000000000002';
do $$ begin
 if exists(select 1 from public.event_activity_log where event_id='bbbbbbbb-0117-4117-8117-000000000002') then raise exception 'BASELINE04 draft baseline created early'; end if;
end $$;
update public.events set status='SUBMITTED' where id='bbbbbbbb-0117-4117-8117-000000000002';
do $$ begin
 if not exists(select 1 from public.event_activity_log where event_id='bbbbbbbb-0117-4117-8117-000000000002' and action='REQUEST_BASELINE_RECORDED' and details->'snapshot'->>'expected_attendance'='35' and details->>'source'='SUBMITTED') then raise exception 'BASELINE04 draft submission missing'; end if;
 if has_function_privilege('anon','public.capture_event_request_baseline()','EXECUTE') or has_function_privilege('authenticated','public.capture_event_request_baseline()','EXECUTE') then raise exception 'BASELINE05 browser access granted'; end if;
end $$;
-- SCRUM-117: all twelve snapshot fields survive the new baseline and resubmission path.
insert into public.events(id,name,status,organiser_id,coordinator_id,purpose,description,start_time,end_time,
 registration_start,registration_end,expected_attendance,venue_requirements,accessibility_needs,equipment_needs,other_comments)
values('bbbbbbbb-0117-4117-8117-000000000003','Original','SUBMITTED','11111111-1111-4111-8111-111111111111',
 '22222222-2222-4222-8222-222222222222','Purpose','Description','2099-01-01T01:00:00Z','2099-01-01T03:00:00Z',
 '2098-12-01T00:00:00Z','2098-12-31T00:00:00Z',30,'Theatre','Ramp','Projector','Notes');
update public.events set status='UNDER_REVIEW',name='Revised',purpose='New purpose',description='New description',
 start_time='2099-01-02T01:00:00Z',end_time='2099-01-02T03:00:00Z',registration_start='2098-12-02T00:00:00Z',
 registration_end='2098-12-30T00:00:00Z',expected_attendance=45,venue_requirements='Round tables',
 accessibility_needs=null,equipment_needs='Microphone',other_comments='New notes'
 where id='bbbbbbbb-0117-4117-8117-000000000003';
set role service_role;
do $$ declare eid uuid:='bbbbbbbb-0117-4117-8117-000000000003'; cycle uuid; expected jsonb; original jsonb; changes jsonb; begin
 select details->'snapshot' into original from public.event_activity_log where event_id=eid and action='REQUEST_BASELINE_RECORDED';
 perform public.request_event_changes(eid,'22222222-2222-4222-8222-222222222222','All field proof');
 select id,details->'before' into cycle,expected from public.event_activity_log where event_id=eid and action='CHANGES_REQUESTED';
 perform public.resubmit_event_request(eid,'11111111-1111-4111-8111-111111111111',cycle,expected);
 select details->'changes' into changes from public.event_activity_log where event_id=eid and action='REQUEST_RESUBMITTED';
 if changes is null or jsonb_array_length(changes)<>12 then raise exception 'BASELINE06 editable field omitted'; end if;
 if exists(select 1 from jsonb_array_elements(changes) c where c->'before' is distinct from original->(c->>'field')
   or c->'after' is distinct from expected->(c->>'field')) then raise exception 'BASELINE06 snapshot values differ'; end if;
end $$;
reset role;
select 'SAVED EDIT BASELINE ASSERTIONS PASSED' as evidence;

-- SCRUM-117: real PostgreSQL, exact documented RPC and triggers.
reset role;
truncate public.notification_outbox, public.event_activity_log;
update public.events set status='UNDER_REVIEW', name='Original', purpose='Purpose', description='Description',
 start_time='2099-01-01T01:00:00Z',end_time='2099-01-01T03:00:00Z',
 registration_start='2098-12-01T00:00:00Z',registration_end='2098-12-31T00:00:00Z',
 expected_attendance=30,venue_requirements='Theatre',accessibility_needs='Ramp',equipment_needs='Projector',other_comments='Notes';
set role service_role;
do $$
declare
 eid uuid := 'aaaaaaaa-0001-4000-8000-000000000000';
 owner_id uuid := '11111111-1111-4111-8111-111111111111';
 coord uuid := '22222222-2222-4222-8222-222222222222';
 cycle uuid; expected jsonb; original jsonb; history jsonb; fields text[] := array['name','purpose','description','start_time','end_time','registration_start','registration_end','expected_attendance','venue_requirements','accessibility_needs','equipment_needs','other_comments'];
 n integer;
begin
 perform public.request_event_changes(eid,coord,'Update all details');
 select id,details->'before' into cycle,original from public.event_activity_log where action='CHANGES_REQUESTED';
 update public.events set name='Revised',purpose='New purpose',description='New description',
 start_time='2099-01-02T01:00:00Z',end_time='2099-01-02T03:00:00Z',
 registration_start='2098-12-02T00:00:00Z',registration_end='2098-12-30T00:00:00Z',
 expected_attendance=40,venue_requirements='Round tables',accessibility_needs=null,equipment_needs='Microphone',other_comments='Revised notes' where id=eid;
 select jsonb_object_agg(key,value) into expected from jsonb_each((select to_jsonb(e) from public.events e where id=eid)) where key=any(fields);
 -- RSQL01: wrong owner, stale cycle and unvalidated concurrent values refuse without side effects.
 select count(*) into n from public.resubmit_event_request(eid,coord,cycle,expected);
 if n<>0 then raise exception 'RSQL01 wrong owner accepted'; end if;
 select count(*) into n from public.resubmit_event_request(eid,owner_id,gen_random_uuid(),expected);
 if n<>0 then raise exception 'RSQL01 stale cycle accepted'; end if;
 select count(*) into n from public.resubmit_event_request(eid,owner_id,cycle,jsonb_set(expected,'{name}','"Stale name"'));
 if n<>0 then raise exception 'RSQL01 concurrent values accepted'; end if;
 if (select count(*) from public.notification_outbox)<>1 or (select count(*) from public.event_activity_log)<>1 then raise exception 'RSQL01 refused operation wrote records'; end if;
 -- RSQL02: all twelve changes, exact notice, retained assignment, idempotent retry.
 select count(*) into n from public.resubmit_event_request(eid,owner_id,cycle,expected);
 if n<>1 then raise exception 'RSQL02 resubmission missing'; end if;
 select details into history from public.event_activity_log where action='REQUEST_RESUBMITTED';
 if jsonb_array_length(history->'changes')<>12 or history->'after'<>expected then raise exception 'RSQL02 fields missing'; end if;
 if exists(select 1 from jsonb_array_elements(history->'changes') c where c->'before' is distinct from original->(c->>'field') or c->'after' is distinct from expected->(c->>'field')) then raise exception 'RSQL02 wrong before/after'; end if;
 if not exists(select 1 from public.events where id=eid and status='UNDER_REVIEW' and coordinator_id=coord) then raise exception 'RSQL02 assignment lost'; end if;
 if not exists(select 1 from public.notification_outbox where workflow='event-request-resubmitted' and recipient_id=coord and payload=jsonb_build_object('eventId',eid,'cycleId',cycle::text,'eventName','Revised','changedFieldCount',12,'requestPath','/assigned-events/'||eid::text)) then raise exception 'RSQL02 notice mismatch'; end if;
 perform public.resubmit_event_request(eid,owner_id,cycle,expected);
 if (select count(*) from public.event_activity_log)<>2 or (select count(*) from public.notification_outbox)<>2 then raise exception 'RSQL02 duplicate persisted'; end if;
 update public.events set name='Later edit' where id=eid;
 if (select details from public.event_activity_log where action='REQUEST_RESUBMITTED')<>history then raise exception 'RSQL02 history mutated'; end if;
end $$;
-- RSQL03: later cycle, reverted edits and equivalent timestamp/empty optional values have no changes.
select public.request_event_changes('aaaaaaaa-0001-4000-8000-000000000000','22222222-2222-4222-8222-222222222222','Check again');
do $$ declare cycle uuid; expected jsonb; n integer; begin
 select id,details->'before' into cycle,expected from public.event_activity_log where action='CHANGES_REQUESTED' order by created_at desc,id desc limit 1;
 update public.events set name='Temporary edit';
 update public.events set name=expected->>'name',accessibility_needs='';
 expected := jsonb_set(jsonb_set(expected,'{start_time}','"2099-01-02T09:00:00+08:00"'),'{accessibility_needs}','""');
 select count(*) into n from public.resubmit_event_request('aaaaaaaa-0001-4000-8000-000000000000','11111111-1111-4111-8111-111111111111',cycle,expected);
 if n<>1 or not exists(select 1 from public.event_activity_log where action='REQUEST_RESUBMITTED' and details->>'cycle_id'=cycle::text and details->'changes'='[]') then raise exception 'RSQL03 no-change comparison wrong'; end if;
end $$;
reset role;
-- RSQL04: failed queue insert rolls back the transition and resubmission history.
select public.request_event_changes('aaaaaaaa-0001-4000-8000-000000000000','22222222-2222-4222-8222-222222222222','Retry after recovery');
alter table public.notification_outbox add constraint fixture_queue_down check(false) not valid;
set role service_role;
do $$ declare cycle uuid; expected jsonb; h integer; q integer; begin
 select id,details->'before' into cycle,expected from public.event_activity_log where action='CHANGES_REQUESTED' order by created_at desc,id desc limit 1;
 select count(*) into h from public.event_activity_log;
 select count(*) into q from public.notification_outbox;
 begin
 perform public.resubmit_event_request('aaaaaaaa-0001-4000-8000-000000000000','11111111-1111-4111-8111-111111111111',cycle,expected);
 raise exception 'RSQL04 queue failure ignored';
 exception when check_violation then null; end;
 if (select status from public.events limit 1)<>'CHANGES_REQUESTED' or (select count(*) from public.event_activity_log)<>h or (select count(*) from public.notification_outbox)<>q then raise exception 'RSQL04 partial transaction'; end if;
end $$;
reset role;
alter table public.notification_outbox drop constraint fixture_queue_down;
do $$ declare browser_role text; begin
 foreach browser_role in array array['anon','authenticated'] loop
 if has_function_privilege(browser_role,'public.resubmit_event_request(uuid,uuid,uuid,jsonb)','EXECUTE') or has_function_privilege(browser_role,'public.enqueue_event_request_resubmitted_notification()','EXECUTE') then raise exception 'RSQL05 browser execute permitted'; end if;
 end loop;
end $$;
select 'RESUBMISSION SQL ASSERTIONS PASSED' as evidence;

-- Run after the isolated setup and migrations 001-007. Any failed assertion
-- aborts psql with ON_ERROR_STOP enabled. All test mutations are rolled back.
begin;
do $$
declare
  v_event uuid;
  v_venue uuid;
  v_request uuid;
  v_count integer;
begin
  if not exists (select 1 from public.events where name = 'Existing published event' and status = 'APPROVED') or
     not exists (select 1 from public.events where name = 'Existing legacy event' and status = 'LEGACY_STATUS') then
    raise exception '[SQL-ACCESS-001] Existing statuses were changed';
  end if;
  select id into strict v_event from public.events where name = 'New request';
  update public.events set status = 'ACCEPTED' where id = v_event;
  begin
    update public.events set status = 'typo' where id = v_event;
    raise exception '[SQL-ACCESS-002] Unknown status was allowed';
  exception when check_violation then null;
  end;
  begin
    update public.events set name = '' where id = v_event;
    raise exception '[SQL-ACCESS-003] Unrelated constraint was lost';
  exception when check_violation then null;
  end;
  select id into v_venue from public.venues limit 1;
  v_request := public.submit_authenticated_venue_booking_request(v_venue, v_event, 'New request', '2099-10-10',
    array['am'], 10, 'Theatre', array[]::text[], array[]::text[], null, '11111111-1111-4111-8111-111111111111');
  if not exists (select 1 from public.venue_booking_requests where id = v_request and requested_by = '11111111-1111-4111-8111-111111111111') then
    raise exception '[SQL-ACCESS-004] Requester attribution missing';
  end if;
  select count(*) into v_count from public.venue_booking_requests;
  update public.events set status = 'REJECTED' where id = v_event;
  begin
    perform public.submit_authenticated_venue_booking_request(v_venue, v_event, 'New request', '2099-10-11',
      array['am'], 10, 'Theatre', array[]::text[], array[]::text[], null, '11111111-1111-4111-8111-111111111111');
    raise exception '[SQL-ACCESS-005] Rejected event booked a venue';
  exception when raise_exception then
    if sqlerrm <> 'Event must be accepted and assigned to this coordinator' then raise; end if;
  end;
  update public.events set status = 'ACCEPTED' where id = v_event;
  begin
    perform public.submit_authenticated_venue_booking_request(v_venue, v_event, 'New request', '2099-10-11',
      array['am'], 10, 'Theatre', array[]::text[], array[]::text[], null, '22222222-2222-4222-8222-222222222222');
    raise exception '[SQL-ACCESS-006] Another coordinator booked this event';
  exception when raise_exception then
    if sqlerrm <> 'Event must be accepted and assigned to this coordinator' then raise; end if;
  end;
  if (select count(*) from public.venue_booking_requests) <> v_count then
    raise exception '[SQL-ACCESS-007] Denied request left partial rows';
  end if;
  if has_function_privilege('authenticated', 'public.submit_authenticated_venue_booking_request(uuid,uuid,text,date,text[],integer,text,text[],text[],text,uuid)', 'execute') or
     has_function_privilege('anon', 'public.submit_authenticated_venue_booking_request(uuid,uuid,text,date,text[],integer,text,text[],text[],text,uuid)', 'execute') then
    raise exception '[SQL-ACCESS-008] Browser roles may not call the administrative booking function';
  end if;
end;
$$;
rollback;

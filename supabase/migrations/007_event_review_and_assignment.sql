-- Apply after 006 before deploying the event workspace. Existing rows and
-- existing status values are preserved. Only single-column status CHECKs are
-- extended; unrelated business constraints remain intact.
begin;
do $$
declare
  v_check record;
  v_status_column smallint;
begin
  select attnum into strict v_status_column from pg_attribute
    where attrelid = 'public.events'::regclass and attname = 'status' and not attisdropped;
  if (select atttypid from pg_attribute where attrelid = 'public.events'::regclass and attnum = v_status_column)
      not in ('text'::regtype, 'varchar'::regtype) then
    raise exception 'Expected events.status to be text/varchar. Review its type before applying this migration.';
  end if;
  for v_check in select conname, pg_get_expr(conbin, conrelid) as expression
    from pg_constraint where conrelid = 'public.events'::regclass and contype = 'c'
      and conkey = array[v_status_column]::smallint[]
  loop
    execute format('alter table public.events drop constraint %I', v_check.conname);
    execute format('alter table public.events add constraint %I check ((%s) or status in (''ACCEPTED'', ''REJECTED''))',
      v_check.conname, v_check.expression);
  end loop;
end;
$$;
create index if not exists events_coordinator_id_idx on public.events (coordinator_id);
create index if not exists events_organiser_id_idx on public.events (organiser_id);

create or replace function public.submit_authenticated_venue_booking_request(
  p_venue_id uuid,
  p_event_id uuid,
  p_event_name text,
  p_booking_date date,
  p_slots text[],
  p_expected_attendees integer,
  p_room_layout text,
  p_required_facilities text[],
  p_accessibility_requirements text[],
  p_additional_requirements text,
  p_requested_by uuid
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_request_id uuid;
begin
  if p_requested_by is null then
    raise exception 'Verified requester is required';
  end if;

  -- Recheck the trusted event relationship inside the write transaction.
  perform 1 from public.events
    where id = p_event_id and coordinator_id = p_requested_by
      and status in ('ACCEPTED', 'APPROVED')
    for share;
  if not found then
    raise exception 'Event must be accepted and assigned to this coordinator';
  end if;

  v_request_id := public.submit_venue_booking_request(
    p_venue_id, p_event_id, p_event_name, p_booking_date, p_slots,
    p_expected_attendees, p_room_layout, p_required_facilities,
    p_accessibility_requirements, p_additional_requirements
  );
  update public.venue_booking_requests
    set requested_by = p_requested_by where id = v_request_id;
  update public.venue_bookings
    set requested_by = p_requested_by::text where request_id = v_request_id;
  return v_request_id;
end;
$$;

revoke execute on function public.submit_authenticated_venue_booking_request(
  uuid, uuid, text, date, text[], integer, text, text[], text[], text, uuid
) from public, anon, authenticated;
grant execute on function public.submit_authenticated_venue_booking_request(
  uuid, uuid, text, date, text[], integer, text, text[], text[], text, uuid
) to service_role;

commit;

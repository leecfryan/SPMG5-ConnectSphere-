-- Apply after 005. Keeps its atomic request/slot creation and adds verified
-- requester attribution. The backend alone supplies p_requested_by after auth.
-- Existing requests and the original function remain intact.
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
    for share;
  if not found then
    raise exception 'Event is not assigned to this coordinator';
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

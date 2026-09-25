-- 007_yc_decide_venue_booking_request.sql
-- SCRUM-22 decide venue booking request
--   Venue Staff can approve an acceptable booking request.
--   Venue Staff can reject a request that cannot be accepted.
--   A rejection may carry information, a reason or a suggested alternative.
--   Any resulting booking change is made by the Event Coordinator, so a
--   rejection records the decision and nothing else. Nothing is rebooked here.
--
-- Apply after 005 and 006.

-- Who decided, when, and anything they wrote with it. decision_note is
-- deliberately nullable: SCRUM-22 makes it optional, and SCRUM-102 will require
-- one for rejections without needing another migration.
alter table public.venue_booking_requests
  add column if not exists decided_by uuid references auth.users(id),
  add column if not exists decided_at timestamptz,
  add column if not exists decision_note text;

-- SCRUM-88: Venue Staff sort their queue by what is still undecided
create index if not exists venue_booking_requests_decided
  on public.venue_booking_requests (decided_at);

-- Records the decision on the request and applies it to every slot row in ONE
-- transaction, so a request can never be half decided.
--
-- Approving writes 'confirmed' to the slot rows, which is what makes the
-- exclusion constraint from 003 bite: if another request already holds one of
-- these slots, the whole statement is rejected and nothing changes. That is the
-- guarantee behind SCRUM-20, enforced by Postgres rather than by a check the
-- backend could race past.
create or replace function public.decide_venue_booking_request(
  p_request_id uuid,
  p_decision   text,
  p_decided_by uuid,
  p_note       text
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_exists boolean;
begin
  if p_decided_by is null then
    raise exception 'Verified reviewer is required';
  end if;
  if p_decision not in ('confirmed', 'rejected') then
    raise exception 'Decision must be confirmed or rejected';
  end if;

  select true into v_exists
  from public.venue_booking_requests
  where id = p_request_id
  for update;

  if not found then
    return null;
  end if;

  update public.venue_booking_requests
  set decided_by = p_decided_by,
      decided_at = now(),
      decision_note = p_note,
      updated_at = now()
  where id = p_request_id;

  -- Cancelled slots stay cancelled: a coordinator withdrawing a request is not
  -- something a later staff decision should quietly undo.
  update public.venue_bookings
  set status = p_decision::public.booking_status
  where request_id = p_request_id
    and status <> 'cancelled';

  return p_request_id;
end;
$$;

-- Validation lives in the backend, so only the backend may call this.
revoke execute on function public.decide_venue_booking_request(uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.decide_venue_booking_request(uuid, text, uuid, text)
  to service_role;

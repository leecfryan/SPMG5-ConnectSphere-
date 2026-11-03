-- SCRUM-163: disposable schema shaped from Ryan's 2026-10-28 export.
-- Disposable fixture only: include related clarification tables when both local suites run together.
truncate public.notification_outbox,public.event_assignment_history,public.events cascade;
alter table public.events add column cancelled_at timestamptz;
insert into auth.users(id) values('22222222-2222-4222-8222-222222222222'),('33333333-3333-4333-8333-333333333333') on conflict do nothing;
create extension if not exists btree_gist;
create type public.booking_status as enum('pending','confirmed','rejected','cancelled','hold','superseded');
create type public.venue_slot as enum('am','pm','night');
create table public.venues(id uuid primary key,name text not null);
create table public.venue_booking_requests(id uuid primary key,event_id uuid references public.events(id),
  venue_id uuid references public.venues(id),decided_by uuid,decided_at timestamptz,decision_note text,updated_at timestamptz default now());
create table public.venue_bookings(
  id uuid primary key default gen_random_uuid(),venue_id uuid not null references public.venues(id),
  event_id uuid references public.events(id) on delete set null,
  coordinator_id uuid references auth.users(id) on delete set null,
  request_id uuid references public.venue_booking_requests(id) on delete cascade,
  booking_date date not null,slot public.venue_slot not null,event_name text not null,
  status public.booking_status not null default 'pending',expires_at timestamptz,requested_by text not null,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  exclude using gist(venue_id with =,booking_date with =,slot with =) where(status='confirmed')
);
create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at:=now();return new;end $$;
create trigger venue_bookings_set_updated_at before update on public.venue_bookings for each row execute function public.set_updated_at();
insert into public.events(id,name,status) values('eeeeeeee-0163-4163-8163-000000000001','Community Open Day','APPROVED');
insert into public.venues values('aaaaaaaa-0163-4163-8163-000000000001','Marina Hall');
insert into public.venue_bookings(venue_id,event_id,coordinator_id,booking_date,slot,event_name,status,expires_at,requested_by) values
('aaaaaaaa-0163-4163-8163-000000000001','eeeeeeee-0163-4163-8163-000000000001','11111111-1111-4111-8111-111111111111','2099-10-10','am','Untrusted display','hold',now()-interval '1 day','venue-staff'),
('aaaaaaaa-0163-4163-8163-000000000001','eeeeeeee-0163-4163-8163-000000000001','11111111-1111-4111-8111-111111111111','2099-10-11','am','Untrusted display','hold',now()+interval '2 hours','venue-staff');
-- Supplied workflow check and exact SCRUM-162 decision body are appended by the local authoring step.

CREATE OR REPLACE FUNCTION public.decide_venue_booking_request(p_request_id uuid, p_decision text, p_decided_by uuid, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$declare
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

  -- SCRUM-162: must run before the booking UPDATE below. On confirm, cancelling
  -- holds first prevents a 23P01 exclusion constraint violation (both the hold
  -- and pending booking rows would otherwise be set to 'confirmed' in one
  -- statement). On reject, clearing request_id releases the hold so the
  -- coordinator can convert it again with a new booking request.
  if p_decision = 'confirmed' then
    update public.venue_bookings
    set status = 'cancelled', updated_at = now()
    where request_id = p_request_id
      and status = 'hold';
  else
    update public.venue_bookings
    set request_id = null, updated_at = now()
    where request_id = p_request_id
      and status = 'hold';
  end if;

  update public.venue_bookings
  set status = p_decision::public.booking_status
  where request_id = p_request_id
    and status <> 'cancelled';

  return p_request_id;
end;$function$
;
alter table public.notification_outbox drop constraint notification_outbox_workflow_check;
alter table public.notification_outbox add constraint notification_outbox_workflow_check CHECK (((workflow = ANY (ARRAY['event-decision'::text, 'event-assignment'::text, 'equipment-issue'::text, 'event-changes-requested'::text, 'event-request-resubmitted'::text])) OR (workflow = ANY (ARRAY['registration-status'::text, 'waitlist-offer-expiring'::text]))));

create temp table fixture_decision_definition as select pg_get_functiondef('public.decide_venue_booking_request(uuid,text,uuid,text)'::regprocedure) as body;

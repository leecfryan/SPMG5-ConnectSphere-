-- SCRUM-43: disposable PostgreSQL fixture, never an application migration.
reset role;
truncate public.notification_outbox, public.event_assignment_history, public.events;
alter table public.events add column start_time timestamptz,
  add column cancelled_at timestamptz,
  add column expected_attendance integer default 10,
  add column enrolled_attendees smallint default 0;
create table public.registrations (
  id uuid primary key default gen_random_uuid(), event_id uuid not null,
  attendee_id uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'withdrawn')),
  registration_data jsonb, updated_at timestamptz not null default now(),
  unique (attendee_id, event_id)
);
create table public.event_waitlist_entries (
  id uuid primary key default gen_random_uuid(), event_id uuid not null,
  attendee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'promoted')),
  created_at timestamptz not null default now(), registration_data jsonb,
  promoted_at timestamptz, promoted_by uuid references auth.users(id) on delete set null,
  override_at timestamptz, override_by uuid references auth.users(id) on delete set null, override_reason text,
  offer_state text, offered_at timestamptz, offer_expires_at timestamptz,
  check (offer_state is null or (offer_state = 'offered' and offered_at is not null and offer_expires_at is not null))
);
insert into public.events(id, name, status, start_time) values
('eeeeeeee-0043-4043-8043-000000000001', 'Community Open Day', 'APPROVED', now() + interval '10 days');
-- Existing offer must get a future reminder without a historical promotion notice.
insert into public.event_waitlist_entries(id,event_id,attendee_id,offer_state,offered_at,offer_expires_at)
values('dddddddd-0043-4043-8043-000000000001','eeeeeeee-0043-4043-8043-000000000001',
'11111111-1111-4111-8111-111111111111','offered',now()-interval '2 days',now()+interval '30 minutes');

-- SCRUM-43: ancillary helper/reconciliation stubs isolate notification integration.
-- These are disposable fixtures, not replacements for the shared database helpers.
create function public.waitlist_offer_ttl() returns interval language sql as $$ select interval '3 days' $$;
create function public.waitlist_effective_deadline(timestamptz,timestamptz) returns timestamptz language sql as $$ select least($1,$2) $$;
create function public.waitlist_registration_data_is_valid(uuid,jsonb) returns boolean language sql as $$ select true $$;
create function public.reconcile_event_waitlist(uuid) returns jsonb language sql as $$ select jsonb_build_object('outcome','reconciled') $$;
create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger registrations_updated_at before update on public.registrations for each row execute function public.set_updated_at();
-- SCRUM-43: exact RPC body exported by Ryan on 2026-10-27.
CREATE OR REPLACE FUNCTION public.promote_waitlist_entry(p_event_id uuid, p_entry_id uuid, p_actor_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_entry public.event_waitlist_entries%ROWTYPE;
  v_registration public.registrations%ROWTYPE;
  v_registration_id uuid;
  v_enrolled bigint;
  v_offered bigint;
  v_deadline timestamptz;
  v_has_registration boolean;
  v_reason text;
BEGIN
  IF p_event_id IS NULL OR p_entry_id IS NULL OR p_actor_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid_request');
  END IF;

  v_reason := NULLIF(btrim(p_reason), '');
  IF length(v_reason) > 500 THEN
    RETURN jsonb_build_object('outcome', 'invalid_reason');
  END IF;

  SELECT event_row.*
    INTO v_event
  FROM public.events AS event_row
  WHERE event_row.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'event_not_found');
  END IF;

  SELECT entry_row.*
    INTO v_entry
  FROM public.event_waitlist_entries AS entry_row
  WHERE entry_row.id = p_entry_id
    AND entry_row.event_id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'entry_not_found');
  END IF;

  IF v_entry.status = 'promoted' THEN
    SELECT registration_row.id
      INTO v_registration_id
    FROM public.registrations AS registration_row
    WHERE registration_row.event_id = p_event_id
      AND registration_row.attendee_id = v_entry.attendee_id
      AND registration_row.status IN ('pending', 'confirmed');

    RETURN jsonb_build_object(
      'outcome', 'already_promoted',
      'entry_id', v_entry.id,
      'registration_id', v_registration_id,
      'enrolled_attendees', COALESCE(v_event.enrolled_attendees, 0),
      'server_time', now()
    );
  END IF;

  IF v_event.status <> 'APPROVED'
     OR v_event.cancelled_at IS NOT NULL
     OR v_event.start_time IS NULL
     OR v_event.start_time <= now() THEN
    RETURN jsonb_build_object('outcome', 'event_ineligible');
  END IF;

  IF v_entry.status <> 'active' THEN
    RETURN jsonb_build_object('outcome', 'entry_not_active');
  END IF;

  IF v_entry.offer_state = 'offered' THEN
    RETURN jsonb_build_object('outcome', 'already_offered');
  END IF;

  SELECT registration_row.*
    INTO v_registration
  FROM public.registrations AS registration_row
  WHERE registration_row.event_id = p_event_id
    AND registration_row.attendee_id = v_entry.attendee_id
  FOR UPDATE;

  v_has_registration := FOUND;

  IF v_has_registration
     AND v_registration.status IN ('pending', 'confirmed') THEN
    DELETE FROM public.event_waitlist_entries AS entry_row
    WHERE entry_row.id = v_entry.id;

    PERFORM public.reconcile_event_waitlist(p_event_id);

    RETURN jsonb_build_object('outcome', 'already_registered');
  END IF;

  IF NOT public.waitlist_registration_data_is_valid(
    p_event_id,
    v_entry.registration_data
  ) THEN
    RETURN jsonb_build_object('outcome', 'details_required');
  END IF;

  v_enrolled := COALESCE(v_event.enrolled_attendees, 0)::bigint;
  IF v_enrolled >= 32767 THEN
    RETURN jsonb_build_object('outcome', 'capacity_counter_overflow');
  END IF;

  SELECT count(*)::bigint
    INTO v_offered
  FROM public.event_waitlist_entries AS offered_row
  WHERE offered_row.event_id = p_event_id
    AND offered_row.status = 'active'
    AND offered_row.offer_state = 'offered';

  IF v_event.expected_attendance IS NULL
     OR v_enrolled + v_offered < v_event.expected_attendance::bigint THEN
    v_deadline := LEAST(
      now() + public.waitlist_offer_ttl(),
      v_event.start_time
    );

    IF v_deadline < now() + interval '1 hour' THEN
      RETURN jsonb_build_object(
        'outcome', 'too_late',
        'effective_deadline', v_deadline,
        'server_time', now()
      );
    END IF;

    UPDATE public.event_waitlist_entries AS entry_row
    SET override_at = now(),
        override_by = p_actor_id,
        override_reason = v_reason,
        offer_state = 'offered',
        offered_at = now(),
        offer_expires_at = v_deadline
    WHERE entry_row.id = v_entry.id;

    RETURN jsonb_build_object(
      'outcome', 'offered',
      'entry_id', v_entry.id,
      'effective_deadline', v_deadline,
      'server_time', now()
    );
  END IF;

  IF v_has_registration AND v_registration.status = 'withdrawn' THEN
    UPDATE public.registrations AS registration_row
    SET status = 'confirmed',
        registration_data = v_entry.registration_data,
        updated_at = now()
    WHERE registration_row.id = v_registration.id
    RETURNING registration_row.id INTO v_registration_id;
  ELSE
    INSERT INTO public.registrations AS registration_target (
      event_id,
      attendee_id,
      status,
      registration_data
    )
    VALUES (
      p_event_id,
      v_entry.attendee_id,
      'confirmed',
      v_entry.registration_data
    )
    ON CONFLICT (attendee_id, event_id)
    DO UPDATE SET
      status = 'confirmed',
      registration_data = EXCLUDED.registration_data,
      updated_at = now()
    WHERE registration_target.status = 'withdrawn'
    RETURNING id INTO v_registration_id;
  END IF;

  IF v_registration_id IS NULL THEN
    DELETE FROM public.event_waitlist_entries AS entry_row
    WHERE entry_row.id = v_entry.id;

    PERFORM public.reconcile_event_waitlist(p_event_id);

    RETURN jsonb_build_object('outcome', 'already_registered');
  END IF;

  UPDATE public.events AS event_row
  SET enrolled_attendees = (v_enrolled + 1)::smallint
  WHERE event_row.id = p_event_id;

  UPDATE public.event_waitlist_entries AS entry_row
  SET status = 'promoted',
      promoted_at = now(),
      promoted_by = p_actor_id,
      override_at = now(),
      override_by = p_actor_id,
      override_reason = v_reason,
      offer_state = NULL,
      offered_at = NULL,
      offer_expires_at = NULL
  WHERE entry_row.id = v_entry.id;

  RETURN jsonb_build_object(
    'outcome', 'registered_over_capacity',
    'entry_id', v_entry.id,
    'registration_id', v_registration_id,
    'enrolled_attendees', v_enrolled + 1,
    'expected_attendance', v_event.expected_attendance,
    'server_time', now()
  );
END;
$function$;

-- SCRUM-43: exact RPC body exported by Ryan on 2026-10-27.
CREATE OR REPLACE FUNCTION public.accept_waitlist_offer(p_event_id uuid, p_attendee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_entry public.event_waitlist_entries%ROWTYPE;
  v_registration public.registrations%ROWTYPE;
  v_registration_id uuid;
  v_effective_deadline timestamptz;
  v_enrolled bigint;
  v_offered bigint;
  v_has_registration boolean;
BEGIN
  SELECT event_row.*
    INTO v_event
  FROM public.events AS event_row
  WHERE event_row.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'event_not_found');
  END IF;

  IF v_event.status <> 'APPROVED'
     OR v_event.cancelled_at IS NOT NULL
     OR v_event.start_time IS NULL
     OR v_event.start_time <= now() THEN
    DELETE FROM public.event_waitlist_entries AS entry_row
    WHERE entry_row.event_id = p_event_id
      AND entry_row.offer_state = 'offered';
    RETURN jsonb_build_object('outcome', 'event_ineligible');
  END IF;

  SELECT registration_row.*
    INTO v_registration
  FROM public.registrations AS registration_row
  WHERE registration_row.event_id = p_event_id
    AND registration_row.attendee_id = p_attendee_id
    AND registration_row.status IN ('pending', 'confirmed')
  FOR UPDATE;

  IF FOUND THEN
    DELETE FROM public.event_waitlist_entries AS entry_row
    WHERE entry_row.event_id = p_event_id
      AND entry_row.attendee_id = p_attendee_id
      AND entry_row.status = 'active';
    IF FOUND THEN
      PERFORM public.reconcile_event_waitlist(p_event_id);
      RETURN jsonb_build_object('outcome', 'already_registered');
    END IF;
  END IF;

  SELECT entry_row.*
    INTO v_entry
  FROM public.event_waitlist_entries AS entry_row
  WHERE entry_row.event_id = p_event_id
    AND entry_row.attendee_id = p_attendee_id
    AND entry_row.offer_state = 'offered'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'offer_not_found');
  END IF;

  v_effective_deadline := public.waitlist_effective_deadline(
    v_entry.offer_expires_at,
    v_event.start_time
  );

  IF now() >= v_effective_deadline THEN
    DELETE FROM public.event_waitlist_entries AS entry_row
    WHERE entry_row.id = v_entry.id;
    PERFORM public.reconcile_event_waitlist(p_event_id);
    RETURN jsonb_build_object(
      'outcome', 'expired',
      'effective_deadline', v_effective_deadline,
      'server_time', now()
    );
  END IF;

  IF NOT public.waitlist_registration_data_is_valid(
    p_event_id,
    v_entry.registration_data
  ) THEN
    RETURN jsonb_build_object(
      'outcome', 'details_required',
      'effective_deadline', v_effective_deadline,
      'server_time', now()
    );
  END IF;

  SELECT registration_row.*
    INTO v_registration
  FROM public.registrations AS registration_row
  WHERE registration_row.event_id = p_event_id
    AND registration_row.attendee_id = p_attendee_id
  FOR UPDATE;

  v_has_registration := FOUND;

  IF FOUND AND v_registration.status IN ('pending', 'confirmed') THEN
    DELETE FROM public.event_waitlist_entries AS entry_row
    WHERE entry_row.id = v_entry.id;
    PERFORM public.reconcile_event_waitlist(p_event_id);
    RETURN jsonb_build_object('outcome', 'already_registered');
  END IF;

  v_enrolled := COALESCE(v_event.enrolled_attendees, 0)::bigint;

  SELECT count(*)::bigint
    INTO v_offered
  FROM public.event_waitlist_entries AS offered_row
  WHERE offered_row.event_id = p_event_id
    AND offered_row.status = 'active'
    AND offered_row.offer_state = 'offered';

  IF v_enrolled >= 32767 THEN
    RETURN jsonb_build_object('outcome', 'capacity_counter_overflow');
  END IF;

  IF v_event.expected_attendance IS NOT NULL
     AND v_enrolled + v_offered > v_event.expected_attendance::bigint
     AND NOT EXISTS (
       SELECT 1
       FROM public.event_waitlist_entries AS promoted_row
       WHERE promoted_row.event_id = p_event_id
         AND promoted_row.status = 'promoted'
         AND promoted_row.promoted_by IS NOT NULL
         AND promoted_row.promoted_at >= v_entry.offered_at
     ) THEN
    RETURN jsonb_build_object(
      'outcome', 'capacity_unavailable',
      'enrolled_attendees', v_enrolled,
      'offered_seats', v_offered,
      'expected_attendance', v_event.expected_attendance
    );
  END IF;

  IF v_has_registration AND v_registration.status = 'withdrawn' THEN
    UPDATE public.registrations AS registration_row
    SET status = 'confirmed',
        registration_data = v_entry.registration_data,
        updated_at = now()
    WHERE registration_row.id = v_registration.id
    RETURNING registration_row.id INTO v_registration_id;
  ELSE
    INSERT INTO public.registrations AS registration_target (
      event_id,
      attendee_id,
      status,
      registration_data
    )
    VALUES (
      p_event_id,
      p_attendee_id,
      'confirmed',
      v_entry.registration_data
    )
    ON CONFLICT (attendee_id, event_id)
    DO UPDATE SET
      status = 'confirmed',
      registration_data = EXCLUDED.registration_data,
      updated_at = now()
    WHERE registration_target.status = 'withdrawn'
    RETURNING id INTO v_registration_id;
  END IF;

  IF v_registration_id IS NULL THEN
    DELETE FROM public.event_waitlist_entries AS entry_row
    WHERE entry_row.id = v_entry.id;
    PERFORM public.reconcile_event_waitlist(p_event_id);
    RETURN jsonb_build_object('outcome', 'already_registered');
  END IF;

  UPDATE public.events AS event_row
  SET enrolled_attendees = (v_enrolled + 1)::smallint
  WHERE event_row.id = p_event_id;

  DELETE FROM public.event_waitlist_entries AS entry_row
  WHERE entry_row.id = v_entry.id;

  RETURN jsonb_build_object(
    'outcome', 'accepted',
    'registration_id', v_registration_id,
    'server_time', now()
  );
END;
$function$;

-- SCRUM-43: exact RPC body exported by Ryan on 2026-10-27.
CREATE OR REPLACE FUNCTION public.decline_waitlist_offer(p_event_id uuid, p_attendee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_entry public.event_waitlist_entries%ROWTYPE;
  v_effective_deadline timestamptz;
BEGIN
  SELECT event_row.*
    INTO v_event
  FROM public.events AS event_row
  WHERE event_row.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'event_not_found');
  END IF;

  IF v_event.status <> 'APPROVED'
     OR v_event.cancelled_at IS NOT NULL
     OR v_event.start_time IS NULL
     OR v_event.start_time <= now() THEN
    DELETE FROM public.event_waitlist_entries AS entry_row
    WHERE entry_row.event_id = p_event_id
      AND entry_row.offer_state = 'offered';
    RETURN jsonb_build_object('outcome', 'event_ineligible');
  END IF;

  SELECT entry_row.*
    INTO v_entry
  FROM public.event_waitlist_entries AS entry_row
  WHERE entry_row.event_id = p_event_id
    AND entry_row.attendee_id = p_attendee_id
    AND entry_row.offer_state = 'offered'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'offer_not_found');
  END IF;

  v_effective_deadline := public.waitlist_effective_deadline(
    v_entry.offer_expires_at,
    v_event.start_time
  );

  DELETE FROM public.event_waitlist_entries AS entry_row
  WHERE entry_row.id = v_entry.id;

  PERFORM public.reconcile_event_waitlist(p_event_id);

  RETURN jsonb_build_object(
    'outcome',
    CASE WHEN now() >= v_effective_deadline THEN 'expired' ELSE 'declined' END,
    'effective_deadline', v_effective_deadline,
    'server_time', now()
  );
END;
$function$;

-- SCRUM-117: disposable local schema extension, never run in shared Supabase.
reset role;
truncate public.notification_outbox, public.events;
alter table public.events
  add column coordinator_id uuid,
  add column purpose text, add column description text,
  add column start_time timestamptz, add column end_time timestamptz,
  add column registration_start timestamptz, add column registration_end timestamptz,
  add column expected_attendance integer, add column venue_requirements text,
  add column accessibility_needs text, add column equipment_needs text, add column other_comments text,
  add constraint events_status_check check (status in ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'));
create table public.event_activity_log (
  id uuid primary key, event_id uuid not null references public.events(id),
  user_id uuid references auth.users(id), action text not null, details jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.event_activity_log enable row level security;
revoke all on public.event_activity_log from public, anon, authenticated;
grant all on public.event_activity_log, public.events to service_role;
insert into public.events(id,name,status,organiser_id,coordinator_id) values
('aaaaaaaa-0001-4000-8000-000000000000','Community Workshop','UNDER_REVIEW',
 '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');

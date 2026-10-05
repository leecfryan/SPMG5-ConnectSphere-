-- Isolated PostgreSQL fixture only. Never run this setup against Supabase.
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create table auth.users (id uuid primary key);
create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) > 0),
  organiser_id uuid,
  coordinator_id uuid,
  status text not null check (status in ('DRAFT', 'SUBMITTED', 'APPROVED', 'LEGACY_STATUS'))
);
insert into auth.users values ('11111111-1111-4111-8111-111111111111');
insert into public.events (name, status, coordinator_id) values
  ('Existing published event', 'APPROVED', '11111111-1111-4111-8111-111111111111'),
  ('Existing legacy event', 'LEGACY_STATUS', null),
  ('New request', 'SUBMITTED', '11111111-1111-4111-8111-111111111111');

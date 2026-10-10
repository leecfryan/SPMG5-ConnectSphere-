-- SCRUM-143: disposable PostgreSQL fixture only, never Supabase.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key);
create table public.events(id uuid primary key, name text not null, organiser_id uuid, status text not null, approval_rejection_remark text);
insert into auth.users values ('11111111-1111-4111-8111-111111111111');
insert into public.events values
('aaaaaaaa-0001-4000-8000-000000000000', 'Approved event', '11111111-1111-4111-8111-111111111111', 'UNDER_REVIEW', null),
('aaaaaaaa-0002-4000-8000-000000000000', 'Rejected event', '11111111-1111-4111-8111-111111111111', 'UNDER_REVIEW', 'Missing details'),
('aaaaaaaa-0003-4000-8000-000000000000', 'Rollback event', '11111111-1111-4111-8111-111111111111', 'UNDER_REVIEW', null),
('aaaaaaaa-0004-4000-8000-000000000000', 'Not a decision', '11111111-1111-4111-8111-111111111111', 'SUBMITTED', null);

-- 003_kl_create_equipment.sql
-- Equipment catalogue, inventory, and equipment requests.
--
-- A request records a *type* of equipment (e.g. "Wireless Microphone"), not
-- a specific physical unit - a Coordinator submitting a request thinks in
-- terms of what they need, not an inventory id they'd have to look up.
-- equipment_type is that requestable catalogue; equipment is the physical
-- stock behind it (for tech support to manage availability/location).
--
-- has_role() reads roles straight from the verified JWT's app_metadata,
-- the same trusted role source the Express backend already uses
-- (see docs/staff-access.md "Trusted role source and database access" and
-- backend/src/middleware/requireAuth.js, which reads user.app_metadata.roles).
-- A separate public.user_roles table would be a second, unsynced source of
-- truth - nothing in this app writes to one, so it would leave every policy
-- below silently denying everyone. Role names below match the slugs
-- backend/scripts/seedUsers.js actually seeds ("event_coordinator",
-- "technical_support_staff"), not "tech_support".

-- ============================================
-- Equipment type (the requestable catalogue)
-- ============================================
create table public.equipment_type (
    id           uuid not null default gen_random_uuid (),
    name         text not null unique,
    category     text,
    description  text,
    -- Soft-disable a type without breaking existing requests/stock rows
    -- that reference it. listEquipmentTypes() only offers active types.
    is_active    boolean not null default true,
    created_at   timestamptz not null default now (),
    updated_at   timestamptz not null default now (),
    constraint equipment_type_pkey primary key (id)
);

create trigger equipment_type_set_updated_at
    before update on equipment_type
    for each row execute function set_updated_at ();

-- ============================================
-- Equipment (physical stock behind a type)
-- ============================================
create table public.equipment (
    id                uuid not null default gen_random_uuid (),
    equipment_type_id uuid not null references public.equipment_type (id) on delete restrict,
    storage_location  text,
    quantity          integer not null default 0,
    created_at        timestamptz not null default now (),
    updated_at        timestamptz not null default now (),
    constraint equipment_pkey primary key (id),
    constraint equipment_quantity_check check (quantity >= 0)
);

create trigger equipment_set_updated_at
    before update on equipment
    for each row execute function set_updated_at ();

create index on public.equipment (equipment_type_id);

-- ============================================
-- Equipment requests (one row per line item)
-- ============================================
create table public.equipment_request (
    id                      uuid not null default gen_random_uuid (),
    event_id                uuid not null references public.events (id) on delete cascade,
    equipment_type_id       uuid not null references public.equipment_type (id) on delete restrict,
    quantity_requested      integer not null,
    technical_requirements  text,
    requested_by            uuid not null default auth.uid () references auth.users (id),
    created_at              timestamptz not null default now (),
    updated_at              timestamptz not null default now (),
    constraint equipment_request_pkey primary key (id),
    constraint equipment_request_quantity_check check (quantity_requested > 0)
);

create trigger equipment_request_set_updated_at
    before update on equipment_request
    for each row execute function set_updated_at ();

create index on public.equipment_request (event_id);
create index on public.equipment_request (equipment_type_id);

-- ============================================
-- Roles
-- ============================================
-- Reads the roles array already stored in the verified JWT's app_metadata -
-- no separate table, no separate seeding step, one source of truth shared
-- with the Express backend.
create or replace function public.has_role(required_role text)
returns boolean
language sql
stable
as $$
    select coalesce(
        (auth.jwt() -> 'app_metadata' -> 'roles') ? required_role,
        false
    );
$$;

-- ============================================
-- RLS
-- ============================================
-- Backend queries go through the admin/service-role client (see
-- backend/src/supabase.js), which bypasses RLS entirely - so these policies
-- are not what protects backend/src/modules/equipment today; requirePermission
-- in the Express layer is. This RLS is defense-in-depth for the moment
-- something (a future direct-from-browser Supabase call) queries these
-- tables with a user's own session instead of going through Express.
alter table public.equipment_type enable row level security;
alter table public.equipment enable row level security;
alter table public.equipment_request enable row level security;

-- ---------- equipment_type ----------
-- Both roles need to see the catalogue to pick a type when requesting it.
create policy "Coordinators can view equipment types"
    on public.equipment_type for select
    to authenticated
    using (public.has_role('event_coordinator'));

create policy "Tech support can view equipment types"
    on public.equipment_type for select
    to authenticated
    using (public.has_role('technical_support_staff'));

create policy "Tech support can manage equipment types"
    on public.equipment_type for all
    to authenticated
    using (public.has_role('technical_support_staff'))
    with check (public.has_role('technical_support_staff'));

-- ---------- equipment (stock) ----------
create policy "Coordinators can view equipment stock"
    on public.equipment for select
    to authenticated
    using (public.has_role('event_coordinator'));

create policy "Tech support can view equipment stock"
    on public.equipment for select
    to authenticated
    using (public.has_role('technical_support_staff'));

create policy "Tech support can manage equipment stock"
    on public.equipment for all
    to authenticated
    using (public.has_role('technical_support_staff'))
    with check (public.has_role('technical_support_staff'));

-- ---------- equipment_request ----------
create policy "Coordinators can view equipment requests"
    on public.equipment_request for select
    to authenticated
    using (public.has_role('event_coordinator'));

create policy "Tech support can view equipment requests"
    on public.equipment_request for select
    to authenticated
    using (public.has_role('technical_support_staff'));

-- Tech support edits/manages requests (quantity, technical requirements,
-- removal) - Coordinators cannot, once submitted. See auth/permissions.js
-- ("equipment_requests.update" is technical_support_staff-only).
create policy "Tech support can manage equipment requests"
    on public.equipment_request for update
    to authenticated
    using (public.has_role('technical_support_staff'))
    with check (public.has_role('technical_support_staff'));

create policy "Tech support can delete equipment requests"
    on public.equipment_request for delete
    to authenticated
    using (public.has_role('technical_support_staff'));

-- Coordinators can insert requests for events they organised or are
-- assigned to as coordinator (coordinator_id may still be null pre-assignment).
-- Coordinators cannot update or delete requests - only tech support can.
create policy "Coordinators can insert requests for their events"
    on public.equipment_request for insert
    to authenticated
    with check (
        public.has_role('event_coordinator')
        and exists (
            select 1 from public.events e
            where e.id = event_id
              and auth.uid () in (e.coordinator_id, e.organiser_id)
        )
    );

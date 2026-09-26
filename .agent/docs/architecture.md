# Architecture

The stack, how a request travels, where each kind of code goes, the database, and outside services.
Team-facing versions: [../../architecture.md](../../architecture.md), [../../docs/project-structure.md](../../docs/project-structure.md),
[../../docs/staff-access.md](../../docs/staff-access.md), [../../docs/frontend-routing.md](../../docs/frontend-routing.md).

## Stack

The confirmed stack. Anything not listed here needs the team's agreement and an AC that requires it, and the user
installs it, not the agent.

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React 19 + Vite 8, JavaScript (`.jsx` / `.js`) | No TypeScript, no UI framework, no CSS framework, no state library. Plain CSS files per feature |
| Routing | React Router 7 (`react-router`), declarative `<Routes>` in `App.jsx` | `BrowserRouter` is mounted once in `main.jsx` |
| Backend | Node 22 + Express 5, CommonJS (`require` / `module.exports`) | `cors`, `dotenv`; `nodemon` for dev |
| Auth | Supabase Auth, email + password (`@supabase/supabase-js`) | Browser SDK signs in; Express verifies each token with `auth.getUser` |
| Database | Supabase Postgres (cloud) | Accessed only from the backend. Schema in `supabase/migrations/*.sql`, applied by hand |
| Unit / integration tests | Vitest 5 (backend and frontend), React Testing Library + user-event + jsdom on the frontend | A few older backend suites (`auth`, `permissions`, `equipment`) still run on `node:test`. Leave them; new tests use Vitest |
| End-to-end tests | Playwright (root `package.json`), Chromium + direct HTTP API projects | Runs against a local Auth simulator; no cloud, no `.env` needed |
| Lint | ESLint (`backend/eslint.config.mjs`, `frontend/eslint.config.js`) | No Prettier. Match surrounding formatting by hand |
| Local runtime | npm scripts, or Docker Compose (frontend :5173, backend :3000) | Supabase is never run locally |
| CI | GitHub Actions on push / PR to `Staging` | Frontend, backend, Docker build, Playwright |
| External APIs | None | See *External integrations* below |
| Deployment | None planned | Don't add hosting, build pipelines or production config |

### Before suggesting a new package

1. Can the existing stack or the platform do it? `fetch`, `Intl.DateTimeFormat`, native `<dialog>`, `URLSearchParams`
   and Postgres constraints have each replaced a library in this repo already.
2. Which AC needs it? Name it.
3. Tell the user the exact command (`npm --prefix frontend install <pkg>` or `npm --prefix backend install <pkg>`),
   and remind them that Docker users need `docker compose up --build --renew-anon-volumes` afterwards.
4. Update this file in the same change.

## Request path

```
Browser (React)
  └─ features/<f>/<f>Service.js or lib/api.js ── fetch("/api/...", Authorization: Bearer <token>)
       └─ Vite proxy /api → Express :3000
            └─ app.js  createApp({...injected dependencies})
                 └─ routes/<f>.routes.js      authenticate → requirePermission(name, authorizeRecord?) → "configured?" 503 guard
                      └─ modules/<f>/<f>.controller.js   HTTP in/out: params, status codes, response shape
                           └─ modules/<f>/<f>.service.js      rules: validation, transitions, decisions ({ ok, reason })
                                └─ modules/<f>/<f>.repository.js  Supabase queries only
                                     └─ Supabase Postgres (secret key, backend only)
```

The browser never talks to Supabase for data. It uses the Supabase SDK only to sign in and hold the session.

## Backend layers

| Layer | File | Owns | Never does |
|---|---|---|---|
| Composition | `src/server.js` | Reading `.env`, building real clients, calling `createApp` | Business logic |
| App | `src/app.js` | Mount order, the `/api/internal` gate, the error handler | Feature logic. Add one `app.use` line per router |
| Routes | `src/routes/<f>.routes.js` | Which guard protects which path, the order of static paths before `/:id` | Queries, response shaping |
| Controller | `modules/<f>/<f>.controller.js` | Reading `req`, mapping service results to status codes, safe error messages | SQL, permission decisions |
| Service | `modules/<f>/<f>.service.js` | Validation, status transitions, domain rules. Returns `{ ok: true, … }` or `{ ok: false, reason }` | `req` / `res`, Supabase calls |
| Repository | `modules/<f>/<f>.repository.js` | Supabase queries; explicit column lists; `WRITABLE_COLS` allow-list for writes | Deciding who may do it |
| Validation | `modules/<f>/<f>.validation.js` | Pure input checks with named limits | I/O |

Not every module has every layer (registrations uses handler files; venues has no separate repository). Extend the
lane's existing shape rather than restructuring it. New modules should use the full set.

### Dependency injection

`createApp` receives every data dependency (`eventsRepository`, `venuesService`, `equipmentDependencies`, …).
`server.js` builds them only when `SUPABASE_SECRET_KEY` is set, and routes answer **503 "…is not configured"** when
their dependency is missing, so sign-in still works without data access. Tests pass fakes through the same
parameters. A new feature follows the same pattern:

1. `createXRoutes(dependencies, authenticate)` in `routes/`.
2. One new named parameter on `createApp`, one `app.use(...)` line.
3. One line in `server.js` building the real dependency behind the secret-key check.

Repositories get the Supabase client lazily (`const getSupabase = () => require("../../supabase")`) so importing
them in tests needs no credentials.

### Mount order matters

`/api/events` is mounted twice: the Event Lifecycle router first, then Registration's `eventHandlers` (`GET /`,
`GET /:eventId`). Static paths such as `/api/events/reviews` must live in the **first** router, or `/:eventId`
swallows them. Inside any router, declare static paths before parameter paths.

## Auth and permissions

- `requireAuth(authClient)` verifies the bearer token with Supabase on **every** request and builds
  `req.user = { id, email, fullName, roles[], accountTypes[] }` from `app_metadata.roles` only. It never trusts
  headers, query, body or `user_metadata`.
- Roles: internal `event_coordinator`, `venue_staff`, `technical_support_staff`, `event_ops_manager`; external
  `event_organiser`, `attendee`. `roles` is an array, so a person can hold several.
- `backend/src/auth/permissions.js` is the single policy table: `"<area>.<action>": { roles: [...], label?, record? }`.
  - `*.read` permissions are refused for anything but GET/HEAD. A write needs its own action permission
    (`events.submit`, `bookings.decide`, `equipment.review`, …). Never reuse a read permission for a write.
  - `label` puts it in the staff Responsibilities list. Only read permissions get one.
  - `record: true` makes `requirePermission` **throw at startup** unless the route supplies
    `authorizeRecord(req)`, which must load the real relationship from the database and return exactly `true`.
    Missing record → `false` → 403. Lookup error → 503.
- Internal (staff) APIs go under the `/api/internal` gate (`internal.access`) **and** their own permission.
  External-user APIs (organiser, attendee) use `authenticate` + their own permission and scope every query to
  `req.user.id` or a verified relationship.
- The frontend gets the permission list from `GET /api/auth/me` and uses it for routes and navigation only. That is
  UX. The API check is the security boundary, and every AC about "cannot see / cannot change" needs an API-level
  test.

### Adding a permission

1. Add the entry to `permissions.js`, next to related entries, with a *why* comment if the role choice came from a
   customer clarification.
2. Update the matrix and capability table in [../../docs/staff-access.md](../../docs/staff-access.md).
3. Update the permission expectations in `tests/playwright/api.spec.cjs` and any Vitest role matrix that lists
   permissions per role. These tests enumerate permissions, so they will fail until you do.
4. Tell the user: `permissions.js` is shared by every lane.

## Response conventions

- Success: `res.json({ data })` or a named key the lane already uses (`{ event }`, `{ events }`). `lib/api.js`'s
  `request()` unwraps `.data`; `apiFetch()` returns the whole body.
- Failure: a sentence a user can read, never a provider or SQL message. The auth and permission layer uses
  `{ message }`; feature layers use `{ error }` or `{ errors }` / `{ details: [{ field, message }] }` for field
  validation, which `apiFetch` joins into the thrown `Error.message`. Keep a lane's existing shape.
- Status codes: 400 invalid input · 401 not signed in / expired · 403 no permission or not your record · 404 no
  such record · 409 wrong state or lost race · 503 dependency not configured or unreachable · 500 only through
  `errorHandler`.
- Log the real error server-side (`console.error("<route> failed:", error.message)`), return the safe sentence.
- Sensitive responses set `Cache-Control: no-store` (the auth middleware already does).

## Current endpoints

| Area | Method + path | Guard |
|---|---|---|
| Health / config | `GET /api/health`, `GET /api/auth/config` | public (config returns the URL and publishable key only) |
| Identity | `GET /api/auth/me` | authenticated |
| Staff | `GET /api/internal/access` | `internal.access` |
| Event requests | `POST /api/events` | `events.submit` |
| Assignment | `GET /api/internal/events/unassigned`, `GET /api/internal/coordinators`, `PUT /api/internal/events/:eventId/coordinator` | `internal.access` + `events.assign_coordinator` |
| Registration | `GET /api/events`, `GET /api/events/:eventId` (APPROVED only); `POST /api/registrations`, `GET /api/registrations/me`, `GET /api/registrations/me/:registrationId`, `PATCH /api/registrations/:registrationId/withdraw` | authenticated, scoped to `req.user.id` |
| Venues | `GET /api/venues`, `GET /api/venues/:id`, `GET /api/venues/:id/availability`, `PATCH /api/venues/:id`, `GET /api/venues/booking-events`, `POST /api/venues/:id/booking-requests`, `GET /api/venues/booking-requests[/:requestId]`, `PATCH /api/venues/booking-requests/:requestId/decision` | `internal.access` + `venues.read` / `venues.update` / `bookings.request` / `bookings.read` / `bookings.decide` |
| Equipment | `GET /api/equipment`, `GET /api/equipment/events`, `GET|POST /api/events/:eventId/equipment-requests`, `GET /api/technical-support/equipment-requests`, `PATCH /api/equipment-requests/:id/status`, `GET|POST /api/events/:eventId/messages`, `PATCH /api/messages/:id` | `internal.access` + `equipment.*` with an event relationship check |

Keep this table current when adding or removing an endpoint.

## Frontend structure

```
frontend/src/
  main.jsx                BrowserRouter, once
  App.jsx                 every route; guards nest RequireAuth → WorkspaceLayout → RequirePermission
  routes/                 shared routing infrastructure: RequireAuth, RequirePermission, WorkspaceLayout, shared pages
  lib/api.js              apiFetch / request helpers (bearer token, error shaping)
  lib/supabase.js         the browser Auth client
  components/ui/          shared primitives (Modal, ErrorModal)
  features/<f>/
    pages/                one component per route
    components/           used only by this feature
    hooks/                data hooks used only by this feature
    <f>Service.js         API calls for this feature (thin wrappers over apiFetch)
    <f>Format.js          pure display formatting
    <f>.css               feature styles
```

### Adding a page

1. Page in `features/<f>/pages/`, API calls in `features/<f>/<f>Service.js` using `apiFetch(path, token, …)`
   with `token` from `useAuth()`.
2. Route in `App.jsx` under `RequireAuth` → `WorkspaceLayout`; wrap in `<RequirePermission permission="…">`
   (and inside the `internal.access` block for staff pages).
3. `NavLink` in `WorkspaceLayout.jsx` behind the same `hasPermission(...)` checks.
4. If the page needs the full-width layout, add its path to the `fullWorkspace` test in `App.jsx` (see
   [ui.md](ui.md)).
5. Update the route table in [../../docs/frontend-routing.md](../../docs/frontend-routing.md).

## Database

Supabase Postgres in the cloud, shared by the whole team. There is no local database. Only the backend touches data,
through the service-role client in `backend/src/supabase.js` (secret key). The browser uses Supabase for sign-in
only.

### Migrations

Schema lives in `supabase/migrations/NNN_<initials>_<what>.sql`, numbered in order:

| File | Owner lane |
|---|---|
| `001_yc_create_venues.sql` – `006_yc_authenticated_venue_booking_requests.sql` | Venue |
| `007_yc_decide_venue_booking_request.sql` | Venue |

**Before numbering a new file, list the folder on the latest `origin/Staging`.** Another lane may have taken the
next number since you branched. If two open branches collide, the one merged second renumbers.

Nothing applies migrations automatically: not merging, not Docker, not CI. The agent never applies them.

#### Writing one

- Header comment: the file name, the story key and title, and the AC it serves, in plain words (see `007`).
- Idempotent where Postgres allows it: `create table if not exists`, `add column if not exists`,
  `create index if not exists`, `drop constraint if exists` before re-adding.
- State "Apply after NNN" when order matters.
- Rules the database can enforce (a status `check`, a unique pair, an exclusion constraint against double booking,
  `not null`) go in the migration as well as in the service. The constraint is the guarantee; the service check
  gives the friendly message.
- Multi-row changes that must succeed or fail together go in a SQL function called through `rpc`, one
  transaction (see `007`'s decision function).
- New tables: enable RLS and grant nothing to `anon` / `authenticated` unless an AC needs direct access. The
  backend's secret key bypasses RLS, so the Express guards are what protect data.
- Seed data for demos goes in `backend/scripts/seedData.js` or a separate `NNN_…_seed_….sql`, never mixed into a
  schema migration.

#### Walking the user through applying it

Stop after writing the file and tell the user, step by step:

1. Open the team's Supabase project → **SQL Editor** → **New query**.
2. Paste the whole file and **Run**. Expected result: "Success. No rows returned".
3. Check it in **Table Editor**: the new columns or table are there.
4. Tell teammates in the team chat that migration `NNN` is applied, because everyone shares the database.

If it errors, have them paste the error back, then fix the file, not the database.

### Known state

- **Only the venue tables have migrations.** `events`, `registrations`, `equipment`, `equipment_requests` and
  `messages` were created in the dashboard. The live `events.status` check was edited by hand, and `seedData.js`
  writes `APPROVED` rows directly. Before a story changes one of these tables, have the user run this in the SQL
  Editor and paste the result back, then write the migration against what is actually live:

  ```sql
  select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.events'::regclass;
  select column_name, data_type, is_nullable, column_default
    from information_schema.columns where table_schema = 'public' and table_name = 'events';
  ```
- Event statuses in use: `SUBMITTED` (created by organisers), `APPROVED` (read by Registration's event list and
  Venue's bookable events), and `DRAFT` (referenced but never written). Status is written only by the lifecycle
  code, never through `WRITABLE_COLS`.
- Roles are not in a table. They're in Supabase Auth `app_metadata.roles`, set by `backend/scripts/seedUsers.js`.
- Relationships used for record checks: `events.organiser_id`, `events.coordinator_id`,
  `registrations.attendee_id` / `registrations.event_id`, `venue_booking_requests.event_id`,
  `equipment_requests.event_id`.

Keep this section current: when a migration lands, update the table above and remove whatever it resolved.

## External integrations

None. ConnectSphere calls no external API besides Supabase (Auth and Postgres), covered above.

When a story's acceptance criteria require an outside service (email, calendar, payments, maps, …), record it here:
the service, the story that needs it, where the key lives (backend `.env` only, added to `.env.example` without a
value), which module calls it, and how tests fake it. Until then this section stays empty, and no code should call
out to the internet.

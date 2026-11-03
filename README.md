# ConnectSphere
Team 5
Event Planning and Venue Booking System for IS212.
Repository: https://github.com/leecfryan/SPMG5-ConnectSphere-

Tech Stack: 
- React 19 + Vite (frontend)
-  Express 5 on Node 22 (backend)
-  Supabase(Postgres database and email/password sign-in)
-  Novu (notification inbox).

## Running locally
You need Node.js 22 (check with `node --version`) and access to the Supabase
Cloud project.

### 1. Configure .env

Copy .env.example to .env in the repository root and fill it in. 
.env values can be found in the .env file in the zip file attached, under project setup
| Variable | Needed for |
| --- | --- |
| SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY | Required. The backend refuses to start without them. |
| SUPABASE_SECRET_KEY | Server-side data access (events, venues, equipment, registrations), seeding and npm --prefix backend test. Without it you can sign in, but data pages answer "not configured". |
| SEED_USER_PASSWORD | Seeding the demo accounts. |
| NOVU_APPLICATION_IDENTIFIER, NOVU_SECRET_KEY | Optional. The notification inbox; without them /notifications shows a short error with a retry button and everything else works. |
| PORT | Optional backend port (default 3000). |

### 2. Install dependencies (once, and after pulling new dependencies)

From the repository root:


npm ci && npm --prefix backend ci && npm --prefix frontend ci


The root install is only needed for the Playwright tests.

### 3. Start the app

In one terminal, from the repository root, start the backend. It should print
"Server is running on port 3000":


npm --prefix backend run dev


In a second terminal, also from the repository root, start the frontend:


npm --prefix frontend run dev


Open http://localhost:5173 and sign in with one of the demo accounts, the sign in emails for the respective roles can be found in either the seed-users.md doc (/docs/seed-users.md) or in the sign in credentials.md in the attached zip file.

The password for all demo accounts is SEED_USER_PASSWORD from your .env.

If the backend stops with "Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the root
.env", the file is missing, misnamed or not in the repository root.

## Running in Docker

With Docker running and .env configured, from the repository root:


docker compose up --build --renew-anon-volumes

Then open http://localhost:5173. The --renew-anon-volumes flag refreshes the
containers' node_modules so newly added dependencies are picked up. Merging or
restarting Docker never changes the database.

## Features and guides

Each guide covers the feature's pages, permissions, database columns and tests.
[2/11/2026 11:10 pm] Javen: | Feature | Used by | Main pages | Guide |
| --- | --- | --- | --- |
| Sign-in and staff access | Everyone; internal staff | /sign-in, /account, /staff/responsibilities | [Staff access](docs/staff-access.md) |
| Event requests, drafts, edits and change requests | Event Organisers | /events/new, /my-event-requests | [Event requests](docs/event-requests.md), [Event access](docs/event-access.md) |
| Coordinator assignment and event review | Event Coordinators, Coordinator Lead | /events/assignments, /assigned-events, /event-management | [Event assignment](docs/event-assignment.md) |
| Safety review | Safety Officers | /safety-reviews | [Staff access](docs/staff-access.md) |
| Venue catalogue and bookings | Venue Staff, Event Coordinators | /venues | [Venue integration](docs/venue-integration.md) |
| Equipment catalogue, requests and reservations | Event Coordinators, Technical Support | /equipment/catalogue, /equipment/requests, /technical-support | [Equipment integration](docs/equipment-integration.md) |
| Attendee registration and waitlist | Attendees | /events, /registrations/me | [Registrations](docs/registrations.md), [Registration integration](docs/registration-integration.md) |
| Registration figures for managed events | Event Organisers, Event Coordinators | /events/managed | [Managed event registrations](docs/managed-event-registrations.md) |
| Notification inbox | Everyone signed in | /notifications | [Notifications](docs/notifications.md) |

## Running tests
From the repository root:


npm --prefix backend test           # needs SUPABASE_URL and SUPABASE_SECRET_KEY in .env
npm --prefix backend run check      # backend lint
npm --prefix frontend test -- --run
npm --prefix frontend run lint
npm --prefix frontend run build
npm run test:playwright             # browser + API tests against a fake backend store


CI runs all of these on every pull request to staging, plus two more suites:

- SQL tests (`tests/sql`): notification triggers in a throwaway PostgreSQL
  container. Needs Docker, no credentials. See [the SQL test guide](tests/sql/README.md).
- Live-database tests (`tests/e2e`, `npm --prefix tests/e2e test`): the real UI
  against the shared dev Supabase. Tell the team before running them locally.

Setup and reports: [Playwright guide](docs/testing/playwright-acceptance.md),
[test reporting](docs/test-reporting.md),
[sign-in and access test catalogue](docs/testing/frontend-acceptance.md).

## Sign-in and security

- Sign-in is Supabase email/password. The browser keeps the session in local
  storage; the server checks the access token with Supabase on every API request
  and refuses when it is missing, invalid, expired or Supabase is unreachable.
- Roles come only from app_metadata.roles, which users cannot edit. Form fields
  and request parameters can never grant a role.
- The browser only ever receives the project URL and publishable key
  (`GET /api/auth/config`). SUPABASE_SECRET_KEY stays on the server.
- Sign-out ends the current session, but an already-issued access token works
  until it expires. When deployed: use HTTPS, guard against XSS (sessions live in
  local storage) and keep Supabase's sign-in rate limits on.

## Configuration

Locally, Vite forwards /api to http://localhost:3000; in Docker,
API_PROXY_TARGET points it at http://backend:3000. FRONTEND_ORIGIN sets the
origin the backend accepts requests from (default `http://localhost:5173`). In
production, serve the frontend and /api from the same HTTPS address; the Vite
proxy is for development only.

## Branching Strategy

Branch from staging as feature/, fix/ plus a three-word summary,
and open a pull request back to staging. Every PR needs a teammate's review and
green CI; the author merges. The full workflow is in [AGENTS.md](AGENTS.md).
Main Branch is used as production environment and will be merged with new features for bigger releases

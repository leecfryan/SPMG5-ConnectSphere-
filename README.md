# ConnectSphere

Team 5's Event Planning and Venue Booking System for IS212.

Repository: [SPMG5-ConnectSphere-](https://github.com/leecfryan/SPMG5-ConnectSphere-)

Tech stack:

- React 19 + Vite (frontend)
- Express 5 on Node.js 22.13.0 (backend)
- Supabase Cloud (Postgres database and email/password sign-in)
- Novu (notification inbox)

## Set Up Instructions

These instructions use the team's existing Supabase project and the credentials
provided with the project setup ZIP. The database and demo accounts are already
set up. You do not need to create a Supabase project or run seed scripts to try
the application.

You need:

- Git to clone the repository.
- The supplied project setup ZIP, including the private `.env` and sign-in credentials.
- An internet connection to reach Supabase and, if configured, Novu.
- For local Node.js setup: the latest Node.js **22.x**, at least **22.13.0**, with npm.
- For Docker setup: Docker Desktop running Linux containers, with Docker Compose available.
- Ports **3000** (backend) and **5173** (frontend) available on your computer.

Choose either **local Node.js** or **Docker** to run the app. Docker installs the
application dependencies inside its images, so you do not need Node.js or npm
on your computer for that option. Running the tests on your computer requires
Node.js and npm.

Both options connect to the same shared database. Changes you save in the app
can be seen by other team members using that project.

## 1. Clone the project

Open a terminal in the folder where you want to keep the project, then run:

```sh
git clone --branch main https://github.com/leecfryan/SPMG5-ConnectSphere-.git
cd SPMG5-ConnectSphere-
```

These instructions use `main`, the team's release branch. You should now be in
the repository root, containing `README.md`, `package.json`, `backend/` and
`frontend/`. Run the remaining commands from this folder unless stated otherwise.
If cloning fails, check that Git is installed and that you can access the repository.

## 2. Add the supplied configuration

Copy the private `.env` from the supplied project setup google drive folder/zip into the repository
root, beside `README.md` and `package.json`. Keep its supplied values and its
exact filename: **`.env`**, not `.env.txt`.(.env file can be found in the set up sub folder)

If you were given configuration values instead of a ready-made file, copy
`.env.example` to `.env` and enter those supplied values. The example contains
empty placeholders and will not run the application by itself. If the setup
ZIP or values are missing, obtain them from the team before continuing.

Keep `.env` private. It is ignored by Git; do not commit it or put secret keys
in frontend configuration.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Required for backend startup and sign-in. Use the team's supplied project values. |
| `SUPABASE_SECRET_KEY` | Required for the full application's server-side data access and database-backed tests. Without it, sign-in can work but data pages report that the feature is not configured. |
| `SEED_USER_PASSWORD` | The supplied demo-account password is recorded here. The seed script uses it when creating accounts; changing this value does not reset existing account passwords. |
| `NOVU_APPLICATION_IDENTIFIER`, `NOVU_SECRET_KEY` | Optional notification configuration. Without these, Notifications shows an error with a retry button; other features remain available. |
| `PORT` | Keep `3000` for the setup below. The frontend proxy and Docker port mapping use that port. |

## 3A. Run locally with Node.js

### Check Node.js and npm

From the repository root, run:

```sh
node --version
npm --version
```

Node should report `v22.13.0` or a later `v22.x` release, and npm should report
a version number. If either command is missing, or Node is older, install or
update Node.js 22 before continuing.

### Install application dependencies

Run these commands once after cloning, and again after pulling dependency changes:

```sh
npm --prefix backend ci
npm --prefix frontend ci
```


Each command should finish successfully and return to the terminal prompt. If
installation fails, check the error, Node version and internet connection before
starting the app. The root dependencies are only needed for the Playwright tests.

### Start the backend and frontend

In the first terminal, from the repository root:

```sh
npm --prefix backend run dev
```

Expect `Server is running on port 3000`. Leave this terminal running.

Open a second terminal in the same repository root and run:

```sh
npm --prefix frontend run dev
```

Expect Vite to display `http://localhost:5173`. Leave this terminal running too.
If it displays a different port, free port 5173 and restart the frontend so it
matches the supplied setup. See Troubleshooting below if either server fails.

Continue to **4. Sign in and check the setup**. To stop the app, press `Ctrl+C`
in each terminal.

## 3B. Run with Docker

Complete steps 1 and 2, start Docker Desktop, then run from the repository root:

```sh
docker compose version
docker compose up --build --renew-anon-volumes
```

The version check should print the Docker Compose version. If it fails, check
that Docker Desktop and Compose are installed. The second command builds the
images, installs dependencies inside them and starts both servers. Wait for
the backend startup message and Vite's ready message before opening the app.
If Docker cannot connect to its engine, check that Docker Desktop is running
with Linux containers selected.

The `--renew-anon-volumes` flag refreshes the containers' `node_modules` volumes
so newly built dependencies are used. Docker does not automatically create or
update the Supabase database schema. Backend startup can resume pending
notification delivery when Novu is configured.

Continue to step 4. Do not run the local Node.js servers at the same time: both
options use ports 3000 and 5173. To stop Docker, press `Ctrl+C`, then run:

```sh
docker compose down
```

## 4. Sign in and check the setup

1. Open [the application](http://localhost:5173).
2. Choose an account from [the demo-account list](docs/seed-users.md), or the
   supplied `sign in credentials.md` in the project setup ZIP. (found within the setup subfolder)
3. Sign in with that account's supplied password. For the shared demo accounts,
   this is the existing password supplied as `SEED_USER_PASSWORD`; editing your
   local `.env` does not change the password stored in Supabase.
4. Open a page available to that role, such as **Browse Events** for an attendee
   or **My event requests** for an organiser. Confirm the page finishes loading
   without a configuration or connection error. An empty list can be valid.

You can also open [the backend health endpoint](http://localhost:3000/api/health).
It should return `{"message":"Server is healthy"}`. This confirms Express is
running; sign-in and loading a data page separately check the Supabase connection.

Do not rerun `seed:users` or `seed:data` as part of normal setup against the shared
project. If accounts or data are missing, contact the team. Administrator-only
account setup is documented in [the seed-user guide](docs/seed-users.md).

## Troubleshooting


| Symptom | What to check |
| --- | --- |
| Backend says `Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the root .env` | Put the supplied `.env` beside the root `package.json`, check its filename and values, then restart the backend. |
| Installation reports an unsupported Node version | Use the latest Node.js 22.x, at least 22.13.0, then rerun the dependency installation commands. |
| Port 3000 or 5173 is in use, or Vite starts on 5174 | Stop the other local server or Docker instance using that port, then restart your chosen setup. |
| The page opens but API calls fail | Check that the backend is running on port 3000, `PORT=3000`, and the frontend is opened at `http://localhost:5173`. |
| Sign-in fails | Use the supplied credentials for an existing demo account, check internet access, and contact the team if they no longer work. Changing `SEED_USER_PASSWORD` locally does not reset an account. |
| A data page says the feature is not configured | Check the supplied `SUPABASE_SECRET_KEY` is present in the root `.env`, then restart the backend. |
| Only Notifications fails to load | Check the optional Novu values with the team and restart the backend after correcting them. Other features can be used without Novu. |

For Docker startup errors, run `docker compose logs backend frontend` from the
repository root to inspect the failing service. For local setup, read the
backend and frontend terminal output. Keep credentials out of any logs you share.

## Features and guides

Each guide covers the feature's pages, permissions, database columns and tests.

| Feature | Used by | Main pages | Guide |
| --- | --- | --- | --- |
| Sign-in and staff access | Everyone; internal staff | `/sign-in`, `/account`, `/staff/responsibilities` | [Staff access](docs/staff-access.md) |
| Event requests, drafts, edits and change requests | Event Organisers | `/events/new`, `/my-event-requests` | [Event requests](docs/event-requests.md), [Event access](docs/event-access.md) |
| Coordinator assignment and event review | Event Coordinators, Coordinator Lead | `/events/assignments`, `/assigned-events`, `/event-management` | [Event assignment](docs/event-assignment.md) |
| Safety review | Safety Officers | `/safety-reviews` | [Staff access](docs/staff-access.md) |
| Venue catalogue and bookings | Venue Staff, Event Coordinators | `/venues` | [Venue integration](docs/venue-integration.md) |
| Equipment catalogue, requests and reservations | Event Coordinators, Technical Support | `/equipment/catalogue`, `/equipment/requests`, `/technical-support` | [Equipment integration](docs/equipment-integration.md) |
| Attendee registration and waitlist | Attendees | `/events`, `/registrations/me` | [Registrations](docs/registrations.md), [Registration integration](docs/registration-integration.md) |
| Registration figures for managed events | Event Organisers, Event Coordinators | `/events/managed` | [Managed event registrations](docs/managed-event-registrations.md) |
| Notification inbox | Everyone signed in | `/notifications` | [Notifications](docs/notifications.md) |

## Running tests

Tests are optional for trying the application. These commands run on your
computer and require Node.js 22.13.0 or later in the 22.x series, including when
you normally run the app in Docker.

### Install test dependencies

From the repository root, install the root, backend and frontend dependencies:

```sh
npm ci
npm --prefix backend ci
npm --prefix frontend ci
npx playwright install chromium
```

The last command downloads Chromium for browser tests. If a command fails, fix
the reported installation error before running the tests.

### Frontend, code checks and isolated acceptance tests

Run from the repository root:

```sh
npm --prefix backend run check
npm --prefix frontend test -- --run
npm --prefix frontend run lint
npm --prefix frontend run build
npm run test:playwright
```


The checks should complete successfully; the test runners should report passed
tests. Investigate any named failures before treating the run as successful.
The default Playwright suite runs browser and direct API tests against real app
code with simulated Auth and storage. It starts its own test servers and needs
no cloud credentials. Results are saved in `playwright-report/` and `test-results/`.
To open its HTML report:

```sh
npm run test:playwright:report
```

### Tests that use the shared database

Coordinate with the team before running these: they create or modify real test
data in the shared Supabase project and require the supplied root `.env`.

Backend tests, from the repository root:

```sh
npm --prefix backend test
```

For the separate live browser/API suite, first complete the test dependency
setup above, then run from the repository root:

```sh
npm --prefix tests/e2e ci
npm --prefix tests/e2e test
```

These tests should report passed results. Investigate failures with the team,
including any missing demo data or schema configuration, before rerunning them.

### SQL tests and CI

The SQL tests in `tests/sql` check notification triggers and database behavior
in a disposable PostgreSQL container. They need Docker and no cloud credentials.
See [the SQL test guide](tests/sql/README.md) for image preparation, commands and
expected results.

CI runs on pull requests to `main` and `staging`, and pushes to `staging`. Its
five jobs cover frontend checks, backend checks including SQL tests, Docker
image builds, isolated browser/API acceptance tests and live-database E2E tests.
See [the workflow](.github/workflows/ci.yml) for the exact commands.

More setup and reporting details: [Playwright guide](docs/testing/playwright-acceptance.md),
[test reporting](docs/test-reporting.md), and
[sign-in and access test catalogue](docs/testing/frontend-acceptance.md).

## Sign-in and security

- Sign-in is Supabase email/password. The browser keeps the session in local
  storage; the server checks the access token with Supabase on every protected API request
  and refuses when it is missing, invalid, expired or Supabase is unreachable.
- Roles come only from `app_metadata.roles`, which users cannot edit. Form fields
  and request parameters can never grant a role.
- The public auth configuration endpoint (`GET /api/auth/config`) returns only
  the project URL and publishable key. `SUPABASE_SECRET_KEY` stays on the server.
- Sign-out ends the current session, but an already-issued access token can
  remain valid until it expires. When deployed, use HTTPS, protect against XSS
  and keep Supabase's sign-in rate limits enabled.

## Configuration

Locally, Vite forwards `/api` to `http://localhost:3000`; in Docker,
`API_PROXY_TARGET` points it at `http://backend:3000`. `FRONTEND_ORIGIN` sets the
origin the backend accepts requests from (default `http://localhost:5173`).

Keep the default ports for the setup above. A custom backend port also needs a
matching frontend proxy target and, for Docker, a matching port mapping. A custom
frontend port needs a matching `FRONTEND_ORIGIN`. Restart the affected servers
after changing configuration. The local frontend reads `API_PROXY_TARGET` from
its process environment; the root `.env` is loaded by the backend.

For deployment, serve the frontend and `/api` from the same HTTPS address. The
Vite proxy is for development only. The current CI workflow builds and tests the
application; it does not deploy it.

## Branching strategy

`main` is the team's release branch. For development, branch from `staging`
using `feature/`, `fix/` or `chore/` plus a three-word summary, then open a pull
request back to `staging`. Every PR needs a teammate's review and green CI; the
author merges. The full workflow is in [AGENTS.md](AGENTS.md).

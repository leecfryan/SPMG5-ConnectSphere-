# ConnectSphere

Event Planning and Venue Booking System for IS212.

## Run locally

Use Node.js 22. Copy .env.example to .env in the repository root and fill in
SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY from the team's Supabase Cloud project.
SUPABASE_SECRET_KEY is needed for server-side event submission, venue storage and administrative scripts such as seeding.
Keep .env private.

From the repository root:

```sh
npm --prefix backend ci
npm --prefix frontend ci
npm --prefix backend run dev
```

In a second terminal:

```sh
npm --prefix frontend run dev
```

Open http://localhost:5173. Alternatively, run `docker compose up --build --renew-anon-volumes`
from the repository root with Docker available and .env configured.
Supabase stays in the cloud. The renew-anon-volumes flag refreshes the containers'
node_modules volumes so newly added dependencies are available.

See [dummy accounts](docs/seed-users.md) for sign-in emails and the seed command.
The seed password is SEED_USER_PASSWORD in your private root .env.

## Sign in securely

The shared sign-in page uses Supabase Auth email/password authentication.
It accepts any valid email domain; Supabase determines whether the entered
credentials belong to a registered account. Demo seed addresses are test data,
not an allowlist. The form delegates authentication and safe error messages to
`frontend/src/features/auth/signInService.js`; it never displays raw provider errors.
The Supabase browser SDK stores the session in browser local storage, restores it
on reload, refreshes access tokens and publishes sign-in/sign-out events.
Passwords are cleared from form state after each attempt. No password or token
is logged by the application.

The browser sends a bearer access token to GET /api/auth/me. Express verifies it
with Supabase Auth getUser(token) before returning account information. Missing,
invalid, or expired tokens cannot access this endpoint; provider outages fail
closed. A browser session alone does not grant access to protected API data.

Only the project URL and publishable key are returned by GET /api/auth/config.
The secret key stays with backend administrative scripts and is not bundled into
the frontend. The seed admin client is separate from normal user verification.

Internal staff and external users share one sign-in flow. Verified
app_metadata.roles supplies application roles. The backend derives accountTypes
from these roles and attaches the identity to req.user for later authorisation.
A person can have roles from both groups. User-editable metadata, form fields,
and request parameters cannot grant roles.

This story provides sign-in, a protected account screen, session restoration, and
sign-out. The account screen is not an event dashboard. Registration and password
reset are outside this story. See the staff-access implementation below for
authorisation.

Sign-out uses Supabase's local scope (the current session). As with Supabase JWT
sessions generally, a previously issued access token may remain valid until its
expiry; sign-out clears the browser session and revokes its refresh capability.
Use HTTPS when deployed, protect against XSS because the SDK persists sessions in
local storage, and keep Supabase's authentication rate limits enabled.

## Restrict internal staff access by responsibility

The backend verifies staff roles before serving /api/internal routes. A central
permission matrix grants Venue Staff venue/booking reads, Technical Support Staff
equipment/technical reads, and Event Coordinators coordination reads. External
roles grant no internal access. The staff responsibilities page displays responsibilities
returned by GET /api/internal/access.

Feature owners must attach requirePermission to their data endpoints. Sensitive
record permissions also require a server-side relationship resolver. The Venue feature now applies these guards to its real endpoints; other feature
PRs must do the same. See [staff access](docs/staff-access.md) for
the agreed matrix, integration examples, tests and remaining work.

## Event request submission

Event Organisers can open `/events/new` through the workspace navigation. The
frontend and backend both enforce `events.submit`; the API obtains ownership
from the verified user. See [event-request integration](docs/event-request-integration.md)
for setup, preserved functionality and combined test commands.

## Venue catalogue and booking requests

Venue Staff and Event Coordinators can open `/venues` from the workspace.
The catalogue, operating-information editor, availability calendar and booking
request review are integrated with shared sign-in and RBAC. Coordinators request
bookings for their assigned events. See [Venue integration](docs/venue-integration.md)
for routes, role permissions and the required database migrations, including 006.
Merging or restarting Docker does not apply Supabase migrations automatically.

## Frontend navigation

The application uses React Router: `/sign-in`, `/account`,
`/staff/responsibilities`, `/events/new`, `/venues/*`, and `/forbidden`. The root redirects after session
checking. Protected routes wait for backend verification; navigation and feature
guards use permission identifiers returned by `/api/auth/me`. Express remains
responsible for enforcing every API permission and record-access check.

See [frontend routing](docs/frontend-routing.md) for the teammate integration
contract, behavior, Docker dependency refresh and production SPA fallback.

## Test dashboard and saved reports

The existing frontend tests have a live browser dashboard and automatically save
a self-contained HTML report after each completed run. See
[test reporting](docs/test-reporting.md) for local and Docker commands.

Playwright also runs browser-to-backend sign-in/RBAC scenarios and direct HTTP
API tests. From the repository root, run `npm run test:playwright` after the
one-time setup in the [Playwright acceptance guide](docs/testing/playwright-acceptance.md).
Use `npm run test:playwright:report` to inspect the saved results.

## Checks and story traceability

```sh
npm --prefix backend test
npm --prefix backend run check
npm --prefix frontend run lint
npm --prefix frontend test -- --run
npm --prefix frontend run build
```

Backend tests use Node's built-in test runner and a fake Auth provider; no cloud
credentials or dummy accounts are needed in CI.
Frontend tests use Vitest and fake Auth/API responses. CI runs both suites.
Fixed UI copy, HTTP status codes and named input limits are application constants;
credentials, account identity and tokens are supplied at runtime. Role permission
rules remain server-controlled and must not come from the sign-in form.

| Acceptance criterion | Verification |
| --- | --- |
| Valid credentials grant access | Sign in with a seeded account; verify the protected account screen and reload restoration. |
| Invalid credentials leave protected functionality inaccessible | Wrong-password UI check; API tests reject missing, malformed, forged and expired tokens and fail closed during provider errors. |
| Sign-in establishes identity for subsequent authorisation | API tests verify user ID, trusted roles, internal/external classification and resistance to client-supplied role claims. |
| Team may choose a secure method | Supabase email/password authentication; server verifies each protected request independently. |

Additional manual checks: sign out and reload; repeat with an internal staff
account and an external account; try a narrow mobile viewport; stop the backend
and confirm protected account information is not shown for a new session.

Frontend regression coverage uses unique IDs and descriptive titles. See the
[frontend acceptance test guide](docs/testing/frontend-acceptance.md) for the
criterion mapping, full test catalog, commands and remaining acceptance evidence.

| Test group | Evidence |
| --- | --- |
| AUTH-FORM / AUTH-SERVICE / AUTH-CONFIG | Form validation, credential forwarding, safe failures, retries and client configuration. |
| AUTH-FLOW / ROUTE | Verified identity, session changes, sign-out, direct links, return URLs and browser history. |
| RBAC-ROLE / RBAC-GUARD / RBAC-SCOPE | Current role policy, 48 role/permission guard combinations and responsibility-based guard eligibility. |
| RBAC-ACCESS / RBAC-DENY / RBAC-DATA | Forbidden navigation, permission revocation, malformed claims and denied staff API responses. |

These automated tests simulate Supabase and do not establish that the deployed
service is configured correctly. Record live internal/external sign-in, wrong
password, reload and sign-out results against the story before marking it Done.

## Configuration and deployment

Vite proxies /api to http://localhost:3000 locally. Docker sets API_PROXY_TARGET
to http://backend:3000. FRONTEND_ORIGIN optionally configures Express CORS
(default http://localhost:5173). For deployment, serve frontend and /api behind
the same HTTPS origin; Vite's development/preview proxy is not a production server.

References:
- https://supabase.com/docs/reference/javascript/auth-signinwithpassword
- https://supabase.com/docs/reference/javascript/auth-getuser
- https://supabase.com/docs/guides/auth/signout

## Equipment requests and technical support

Coordinators use `/equipment/requests`; technical support uses `/technical-support`. Both pages share sign-in, role permissions and the existing frontend port. See [Equipment integration](docs/equipment-integration.md) for preserved workflows, database prerequisites and test commands.

## Attendee registration

Signed-in users can browse approved events at `/events` and manage their own registrations at `/registrations/me`. Staff permissions and existing feature routes are unchanged. See [Registration integration](docs/registration-integration.md) for integration details, tests and database requirements.

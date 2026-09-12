# ConnectSphere

Event Planning and Venue Booking System for IS212.

## Run locally

Use Node.js 22. Copy .env.example to .env in the repository root and fill in
SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY from the team's Supabase Cloud project.
SUPABASE_SECRET_KEY is needed only for administrative scripts such as seeding.
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
roles grant no internal access. The account screen displays responsibilities
returned by GET /api/internal/access.

Feature owners must attach requirePermission to their data endpoints. Sensitive
record permissions also require a server-side relationship resolver. Production
business endpoints and their database policies do not exist yet; full story
acceptance requires this integration. See [staff access](docs/staff-access.md) for
the agreed matrix, integration examples, tests and remaining work.

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

Frontend regression coverage:

| Test | Evidence |
| --- | --- |
| AUTH-01–03 | Required fields and invalid email syntax block submission. |
| AUTH-04 | Multiple email domains submit the entered credentials; password is cleared. |
| AUTH-05/07 | Credential failures show generic messages; rate limits/outages allow retry without leaking provider details. |
| AUTH-06 | Concurrent submissions make one request; controls stay disabled while pending. |
| App AC1/AC3 | Sign-in and restored sessions display only the backend-verified identity. |
| App AC2 | Rejected credentials, rejected sessions, token refresh and late responses after sign-out cannot reveal protected account information. |

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

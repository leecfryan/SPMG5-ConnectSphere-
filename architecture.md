# Current architecture

ConnectSphere uses React/Vite (JavaScript), Express/Node.js, and Supabase Cloud.
Docker Compose runs the frontend and backend development servers; Supabase is
hosted externally.

## Authentication flow

1. React requests public Supabase configuration from Express at /api/auth/config.
2. The browser Supabase SDK signs in directly with Supabase Auth using email and
   password, and manages session persistence and refresh.
3. React sends the access token as a bearer token to Express at /api/auth/me.
4. Express verifies the token with Supabase Auth before returning a limited user
   profile. Other protected APIs should reuse the authentication middleware.
5. Admin-controlled roles determine the returned internal/external account types.
6. /api/internal routes require a verified internal role. Each data endpoint must
   also use requirePermission with its specific permission. Sensitive record
   permissions require a feature-owned relationship resolver.
7. AuthProvider obtains identity and permission identifiers from /api/auth/me.
   React Router guards use these verified permissions for pages and navigation.
8. The /staff/responsibilities page loads allowed responsibilities from
   /api/internal/access; server middleware still authorises each API request.

The permission layer and integrated feature APIs enforce role capabilities and
event relationships. The event workspace filters organiser/coordinator records
by verified user ID and exposes separate manager actions. See docs/staff-access.md for the integration contract.

The browser never receives the Supabase secret key. Normal identity verification
uses the publishable key. Administrative scripts such as seeding use the separate
backend Supabase admin client.

The authenticated identity is attached to req.user. Roles remain an array so
future work can handle a staff member who also has an external role. No role
selector or browser-supplied claim grants access.

## Files

- frontend/src/features/auth/SignIn.jsx: sign-in form.
- frontend/src/lib/supabase.js: browser Auth client, public configuration and sessions.
- frontend/src/App.jsx: shared shell and route definitions.
- frontend/src/features/auth/AuthProvider.jsx: shared session, verified identity,
  permissions, retries and sign-out; useAuth.js exposes its context.
- frontend/src/routes/: authentication/permission guards, workspace layout and pages.
- backend/src/server.js: environment loading, stateless verification client and startup.
- backend/src/app.js: Express app and public/protected endpoints.
- backend/src/middleware/requireAuth.js: verified identity and trusted role metadata.
- backend/src/auth/permissions.js: central staff responsibility matrix.
- backend/src/middleware/requirePermission.js: permission and record-access checks.
- frontend/src/features/auth/StaffResponsibilities.jsx: verified responsibility display.
- backend/src/supabase.js: administrative Supabase client used by scripts.
- backend/scripts/seedUsers.js: repeatable creation of dummy Auth accounts.
- backend/tests/integration/auth.test.js: authentication boundary tests.
- backend/tests/integration/permissions.test.js: staff matrix and record-access tests.
- supabase/migrations/: venue schema, booking RPCs and event workflow migration 007.

Vite proxies /api to the backend: localhost:3000 for local npm development and
backend:3000 inside Docker. Production hosting must route /api to Express behind
the same HTTPS origin. See README.md for commands, configuration, acceptance
criteria and session security considerations. See docs/frontend-routing.md for
route integration and the production index.html fallback required for page URLs.

## Equipment integration

Equipment pages run under the shared AuthProvider and permission routes. The backend constructs data dependencies separately from token verification and enforces action permissions plus event/author relationships. See [Equipment integration](docs/equipment-integration.md).

## Registration integration

Approved event reads and attendee-owned registrations are composed alongside organiser submission and staff routes. Registration pages use the shared AuthProvider and API helper; test control endpoints remain outside production. See [Registration integration](docs/registration-integration.md).

## Role-specific event workspaces

See [event access](docs/event-access.md). Multiple coordinators are distinct
accounts sharing `event_coordinator`; assignment uses `events.coordinator_id`.
The event lifecycle is SUBMITTED → ACCEPTED → APPROVED (registration open), or
SUBMITTED → REJECTED. Managers assign coordinators after acceptance. Attendees
use registration routes; venue and technical staff use their booking workspaces.
The reusable `frontend/src/hooks/useApiResource.js` hides stale data when the
session, route or refresh revision changes.

# Frontend routes and teammate integration

React Router runs in declarative mode in the existing Vite SPA. BrowserRouter is
mounted once in `frontend/src/main.jsx`; `App.jsx` registers routes. URLs use the
same frontend port (Docker: 5173); routing does not start another Vite process.

| URL | Behavior |
| --- | --- |
| `/` | Wait for session verification, then redirect to sign-in or account. |
| `/sign-in` | Shared email/password form; verified users return to the requested local URL or `/account`. |
| `/events` and `/events/:eventId` | Attendee-only browsing of events open for registration (`events.browse`). |
| `/registrations/me` and `/registrations/me/:registrationId` | Requires `registrations.manage`; own registration status, details and eligible withdrawal. |
| `/my-event-requests` and `/:eventId` | Own and same-client requests; requires `events.own.read`. Own detail editing also requires `events.own.update`; colleagues are view only. |
| `/assigned-events` and `/:eventId` | Coordinator-assigned planning records; requires `events.assigned.read`. |
| `/event-management` and `/:eventId` | Manager review, assignment and opening registration; requires `events.review`. |
| `/events/new` | Requires `events.submit`; organiser event form. `?draft=<id>` continues one of the organiser's own drafts (SCRUM-147); anyone else's id shows "Draft not found." |
| `/venues/*` | Internal venue pages; see [Venue integration](venue-integration.md) for child routes. |
| `/venues/booking-requests/:requestId/replacement` | Event Coordinator replacement search for an affected booking; requires `bookings.request`. |
| `/equipment/requests?event=<uuid>` | Assigned coordinator Equipment request page; requires `equipment.request`. |
| `/technical-support` | Technical dashboard; requires `equipment.review`. |
| `/events/assignments` | Requires `events.assign_coordinator`; the Event Coordinator Lead's queue for routing submitted requests to coordinators. See [Coordinator assignment](event-assignment.md). |
| `/account` | Backend-verified identity for every signed-in role. |
| `/notifications` | Own Novu inbox and unread count for every signed-in account, including accounts without roles; no role capability required. |
| `/safety-reviews` | Requires `internal.access` + `events.safety.read` (Safety Officer); events awaiting safety review (SCRUM-140). |
| `/safety-reviews/:eventId` | Same permission; read-only safety facts for one event, one section per confirmed venue (SCRUM-140). With `events.safety.decide`, the *Safety decision* section: *Approve*, or *Reject* with a reason (SCRUM-141). |
| `/staff/responsibilities` | Requires `internal.access`; lists responsibilities from the protected staff API, or an empty-state message when none are assigned. Safety Officer's one responsibility is *Operational safety review* (SCRUM-140). |
| `/forbidden` | Signed-in access-denied page. |
| Other URLs | Not-found page with a home link. |

## Authentication and permission contract

`features/auth/AuthProvider.jsx` owns the SDK subscription, session verification,
retry and sign-out. `useAuth()` exposes `user`, `token`, `permissions`,
`hasPermission(name)` and session actions. Identity and capabilities come from
`GET /api/auth/me`, which returns `{ user, permissions }`. Express computes the
permission identifiers using the existing server policy, after verifying the
token with Supabase. No role-to-permission matrix is duplicated in the browser.

`RequireAuth` prevents page rendering until verification succeeds. Anonymous
users are redirected to sign-in with a local return destination; outages and
invalid sessions show recovery controls without protected content. Return paths
reject external URLs, sign-in loops and `/forbidden` as a post-sign-in destination.
A remembered denial URL falls back to `/account`. `RequirePermission` uses the verified
capability list. Missing permissions grant no feature access.

Navigation shares one provider, so switching pages does not create SDK clients
or subscriptions. Auth events and explicit verification retries recheck identity.
Token/session changes immediately hide old identity and permissions, and pending
verification requests are cancelled or ignored. Sign-out removes protected
content even when using browser Back. Frontend capabilities are a snapshot;
Express must reverify every protected API request and can deny access after a
role is removed even before the UI receives another auth event.

## Adding a feature in a PR

1. Keep feature components in `frontend/src/features/<feature>/`. A page component
   may live with its feature; `routes/` contains the shared routing infrastructure.
2. Register the page under `RequireAuth` and `WorkspaceLayout` in `App.jsx`.
   Internal feature pages must require both `internal.access` and their feature
   permission. For example, add this under the existing `internal.access` guard:

   ```jsx
   <Route element={<RequirePermission permission="venues.read" />}>
     <Route path="/venues" element={<VenuesPage />} />
   </Route>
   ```

3. Add a `NavLink` in `WorkspaceLayout.jsx`, using the same permission checks:

   ```jsx
   {hasPermission("internal.access") && hasPermission("venues.read") && (
     <NavLink to="/venues">Venues</NavLink>
   )}
   ```

4. Use the verified token from `useAuth()` for API requests. Handle 401/403 and
   provider failures without retaining or exposing old protected data.
5. Protect the real Express endpoint with authentication and its permission
   guard; add the required server-side relationship checks for record access.
   See `staff-access.md`. Frontend guards are not a security boundary, and
   capabilities do not grant access to every event or record.
6. Add direct-link, allowed-role, denied-role and backend-denial tests. Keep changes
   to shared route/navigation files small to simplify merges.

Venue and Equipment implement this integration pattern; other features should follow it.
See [Equipment integration](equipment-integration.md) for action permissions and event scope.
Multi-role users share feature URLs; they are not redirected to a single role's
dashboard. Existing read permissions are retained; Venue adds explicit write capabilities. `event_coordinator_lead` holds `event_organisers.read` and `internal.access`, and
reaches the assignment queue at `/events/assignments` through its own
`events.assign_coordinator` capability. Every other internal page keeps the
permission it requires, so this role is denied them individually rather than at
the shared gate. Permission grants belong in the permission policy, not in the
router. See [staff access](staff-access.md).

## Hosting and Docker

After installing the new dependency, refresh Docker's frontend node_modules
volume using the README's `docker compose up --build --renew-anon-volumes` command.
The frontend and backend must both run the updated code so the identity response
includes permissions. No Compose port change is needed.

Vite supports SPA page refreshes in development. For production, configure the
frontend host to return `index.html` for application URLs such as `/account` and
`/staff/responsibilities`; keep `/api/*` routed to Express and static assets
served normally. React's not-found route handles unknown application URLs; a
production host returning the SPA document may use HTTP 200 for that document.

## Verification

`npm --prefix frontend test -- --run` covers sign-in, direct-link return paths,
permission-based navigation, forbidden/not-found pages, Back/Forward, restored
sessions, token changes, late responses, outages, retries and sign-out.
`npm --prefix backend test` covers trusted role-derived capabilities, combined
roles, revocation, server permission checks and required record relationships.

Before recording live UAT as passed, run through sign-in, page refresh, staff
navigation and sign-out with real internal and external Supabase accounts.
Automated tests use fake providers and do not certify cloud configuration.

Registration uses the same session and routing contract. See [Registration integration](registration-integration.md) for ownership checks and the separate attendee-facing event projection.


## Local visual refresh (30 October 2026)

The route table, return destinations and permission gates above are unchanged.
Signed-in pages now use a shared sidebar with icons and names. On desktop its
Collapse/Expand control switches to icons only; links keep accessible names and
hover/focus labels. Phone navigation always displays the names. The toggle does
not remount page content. See [.agent UI reference](../.agent/docs/ui.md) for tokens,
responsive layout and attendee presentation. No dependencies or APIs were added.


### Windows Docker source updates

The Vite development server uses 500ms source polling so changes on the Windows
bind mount invalidate cached transforms reliably. If a server started before this
setting was applied still serves old source, restart only the frontend container
(`docker restart ConnectSphere-frontend`), then refresh the browser. No image
rebuild, package installation or backend restart is required for source-only UI
changes. Routes, guards and API proxy destinations are unchanged.


### Explicit sign-out and the next sign-in

AuthProvider records `signedOut` alongside the session on SIGNED_OUT and after a
successful explicit sign-out. RequireAuth is the single owner of the anonymous
redirect: it clears return state after sign-out, but preserves an initial
anonymous protected-page destination. SignOutButton only invokes the original
sign-out action, avoiding a second, competing navigate after its await.
Failed sign-out retains the current page/error, and the existing return boolean
is retained. A new auth event/session resets the sign-out navigation marker.

SignInPage still sanitises return paths and excludes `/forbidden` and sign-in
loops. Its post-authentication redirect marks the destination `afterSignIn`.
RequirePermission always checks the verified capability first. If that check
fails for a post-sign-in destination, it redirects to universal `/account` and
clears the marker rather than making Access denied the landing screen. Permitted
deep links keep their URL, query and hash. Ordinary signed-in navigation to an
unauthorised page still redirects to `/forbidden` as before. The marker changes
only the denial destination and never grants permission or mounts protected
content. Backend role/record guards are unchanged.

The existing RBAC-ACCESS-005 expectation now reflects the requested safe landing,
while retaining assertions that protected data was not loaded. Tests have not
been run, following Ryan's instruction; this is not a new recorded pass.

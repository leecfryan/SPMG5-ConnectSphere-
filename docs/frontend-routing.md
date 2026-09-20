# Frontend routes and teammate integration

React Router runs in declarative mode in the existing Vite SPA. BrowserRouter is
mounted once in `frontend/src/main.jsx`; `App.jsx` registers routes. URLs use the
same frontend port (Docker: 5173); routing does not start another Vite process.

| URL | Behavior |
| --- | --- |
| `/` | Wait for session verification, then redirect to sign-in or account. |
| `/sign-in` | Shared email/password form; verified users return to the requested local URL or `/account`. |
| `/events/new` | Requires `events.submit`; organiser event form. |
| `/venues/*` | Internal venue pages; see [Venue integration](venue-integration.md) for child routes. |
| `/equipment/requests?event=<uuid>` | Assigned coordinator Equipment request page; requires `equipment.request`. |
| `/technical-support` | Technical dashboard; requires `equipment.review`. |
| `/account` | Backend-verified identity for every signed-in role. |
| `/staff/responsibilities` | Requires `internal.access`; lists responsibilities from the protected staff API. |
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
reject external URLs and sign-in loops. `RequirePermission` uses the verified
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
dashboard. Existing read permissions are retained; Venue adds explicit write capabilities. In particular,
`event_ops_manager` has `event_organisers.read` but lacks `internal.access` in the
current policy, so manager-only accounts cannot enter internal pages/APIs. This
requires a separate team policy decision rather than an implicit router grant.

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

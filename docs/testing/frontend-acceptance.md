# Sign-in and RBAC frontend acceptance tests

This suite uses Vitest, React Testing Library, user-event and jsdom. Application
code, backend endpoints, database data and role assignments are unchanged.
Component tests render the actual application, session provider, router and
guards. Small authentication service/configuration tests use Vitest directly.
No real credentials or cloud connections are used.

## Acceptance criteria supplied for this task

| Criterion | Requirement | Evidence in this suite |
| --- | --- | --- |
| SIGNIN-AC1 | Valid authentication grants access. | AUTH-FORM valid submissions; AUTH-FLOW-001/005/012/021; ROUTE-001/002. SDK acceptance and backend verification are simulated independently. |
| SIGNIN-AC2 | Invalid authentication leaves protected functionality inaccessible. | AUTH-FORM required/invalid inputs and failures; AUTH-FLOW-002–004/006–008/013–020/022; anonymous guards and sign-out/history regressions. |
| SIGNIN-AC3 | Successful sign-in establishes identity for later authorisation. | AUTH-FLOW-001/005/006/012/020/021; RBAC-GUARD permitted children receive the verified user ID; RBAC-DENY-005 ignores unverified SDK role claims. |
| SIGNIN-AC4 | The team may select an appropriate secure authentication method. | This is a design allowance, not a standalone executable pass/fail condition. AUTH-CONFIG and AUTH-SERVICE verify the chosen Supabase client setup and credential forwarding; they do not certify Supabase's security. |
| RBAC-AC1 | Venue Staff can access information needed for venue responsibilities. | RBAC-ROLE-001 and the Venue Staff rows of RBAC-GUARD exercise the current policy, guards and venue/booking responsibility display. |
| RBAC-AC2 | Technical Support Staff can access information needed for equipment/technical responsibilities. | RBAC-ROLE-002 and the Technical Support rows of RBAC-GUARD cover equipment and technical-request capabilities and display. |
| RBAC-AC3 | Eligibility is responsibility-based, not restricted merely by venue, equipment type or location. | RBAC-SCOPE-001–004 exercise real route guards with different resource identifiers and unrelated profile metadata. This is guard-level evidence, not proof about future resource queries. |
| RBAC-AC4 | Protected internal planning, venue, equipment, attendee and client information is unavailable to unauthorised users. | RBAC-GUARD, RBAC-DENY, RBAC-ACCESS and RBAC-DATA verify denied children do not mount, links stay hidden, and denied API responses reveal no responsibility data. |

The last RBAC sentence is clipped in the supplied screenshot. These tests cover
denial to unauthorised users, consistent with the existing staff-access story;
they do not invent additional conditions beyond the visible text.

## Test organisation and IDs

Each executed test has a unique `[ID] Descriptive title`. Parameterised cases
have distinct IDs rather than sharing one ID across different outcomes. Existing
`AUTH-01`–`AUTH-07` and unlabelled routing tests were retained and renamed into the
groups below; the detailed test catalog lists the resulting names.

| Group | File | Purpose |
| --- | --- | --- |
| AUTH-FORM | `frontend/src/features/auth/SignIn.test.jsx` | Validation, multiple email domains, error messages, password clearing, duplicate requests, visibility toggle and keyboard submission. |
| AUTH-SERVICE | `frontend/src/features/auth/signInService.test.js` | Email normalization and exact password preservation. |
| AUTH-CONFIG | `frontend/src/lib/supabase.test.js` | Public configuration, SDK session settings, shared initialization, incomplete configuration and retry. |
| AUTH-FLOW | `frontend/src/App.test.jsx` | Verified sign-in, restored/changed sessions, outages, malformed responses, stale responses and sign-out. |
| ROUTE | `frontend/src/App.test.jsx` | Direct links, return destinations, Back/Forward and not-found behavior. |
| RBAC-ACCESS | `frontend/src/App.test.jsx` | Actual application navigation, forbidden URLs, revocation and server denial. |
| RBAC-ROLE | `frontend/src/Rbac.test.jsx` | Role-specific responsibility lists and combined roles. |
| RBAC-GUARD | `frontend/src/Rbac.test.jsx` | All 48 combinations of six roles and eight protected read permissions. |
| RBAC-SCOPE | `frontend/src/Rbac.test.jsx` | Guard eligibility across venue, equipment-type and location examples. |
| RBAC-DENY | `frontend/src/Rbac.test.jsx` | Anonymous/unknown roles, missing or malformed permissions, SDK claim spoofing and unknown feature permissions. |
| RBAC-DATA | `frontend/src/features/auth/StaffResponsibilities.test.jsx` | Pending staff requests, 401/403/outage/network failures, retry, empty results and cancelled requests. |

`Rbac.test.jsx` imports the real pure policy functions from
`backend/src/auth/permissions.js` in the test runner. Expected allowed/denied
results are independently specified. The test does not stub `RequireAuth`,
`RequirePermission` or `useAuth`.

The feature page in the guard matrix is explicitly a test-only fixture. Actual
venue, booking and equipment business pages/API handlers are not implemented by
this task. Auth/network transports remain fakes; Express token verification and
record authorisation are not exercised by this frontend suite.

The existing `event_ops_manager` policy is documented as a regression case:
it has `event_organisers.read` but lacks `internal.access`, so internal route
access remains denied. Passing that test confirms current behavior, not customer
approval of that policy. See `docs/staff-access.md`.

## Running and viewing results

Run from the repository root:

```powershell
npm --prefix frontend test -- --run
npm --prefix frontend test -- --run --reporter=verbose
npm --prefix frontend test -- --run -t 'RBAC-GUARD'
npm --prefix frontend run lint
```

If parallel jsdom workers time out during startup, use
`npm --prefix frontend test -- --run --maxWorkers=1`. This changes concurrency,
not the tests or assertions. The verified run for this change used that command:
all 134 tests in six files passed, and frontend lint passed.

The existing Vitest configuration also generates an HTML report. To view it:

```powershell
npm --prefix frontend run test:report:preview
```

Open the local URL printed by that command. The existing `test:ui` command offers
interactive watch mode. Generated results under `frontend/.vitest/` are ignored
by Git; rerun tests after any changes rather than treating a saved report as
current evidence.

## Limits and remaining acceptance evidence

- jsdom simulates DOM behavior. It does not validate actual browser layout,
  production URL rewrites, real browser storage persistence, or HTTP-only behavior.
- A simulated SDK session proves frontend handling, not that an account can
  actually authenticate with the deployed Supabase project.
- Keep the existing backend authentication/permission integration tests for
  forged/expired tokens, trusted role metadata, direct API denial and scoped
  record checks. Database/RLS and real feature endpoints need their own tests.
- Live UAT should include real internal/external sign-in, wrong passwords, page
  refresh, sign-out, direct URL access and each implemented business feature.
- No claim of 100% statement/branch coverage or complete story acceptance is made.

## Detailed test catalog

Verified on 2026-09-18: **134 passed, 0 failed, 0 skipped**. Titles below are taken from the executed Vitest JSON report; each row passed in that run.

### frontend/src/App.test.jsx

| ID | Test title |
| --- | --- |
| AUTH-FLOW-001 | Valid sign-in displays the backend-verified identity |
| AUTH-FLOW-002 | Rejected credentials leave protected account information inaccessible |
| AUTH-FLOW-003 | Restored session denied with HTTP 401 reveals no account data |
| AUTH-FLOW-004 | Restored session denied with HTTP 503 reveals no account data |
| AUTH-FLOW-005 | Session restoration verifies identity and sign-out survives a simulated reload |
| AUTH-FLOW-006 | Token refresh hides the previous identity until verification succeeds |
| AUTH-FLOW-007 | Late verification cannot restore protected content after sign-out |
| ROUTE-001 | Successful sign-in returns to the requested staff URL |
| RBAC-ACCESS-001 | external user cannot access a staff page by URL |
| RBAC-ACCESS-002 | internal classification alone cannot access a staff page by URL |
| RBAC-ACCESS-003 | unrecognised permission cannot access a staff page by URL |
| RBAC-ACCESS-004 | existing manager policy cannot access a staff page by URL |
| RBAC-ACCESS-005 | Sign-in to a forbidden return URL still enforces permission |
| ROUTE-002 | Page navigation and Back/Forward share one verified identity |
| ROUTE-003 | Browser Back after sign-out cannot reveal protected staff content |
| RBAC-ACCESS-006 | Re-verification removes revoked navigation and page access |
| RBAC-ACCESS-007 | Backend denial hides staff data despite previously allowed navigation |
| AUTH-FLOW-008 | Verification outage hides protected routes and permits retry |
| AUTH-FLOW-009 | Authentication initialization failure supports retry |
| AUTH-FLOW-010 | Failed sign-out displays a safe message and supports retry |
| ROUTE-004 | Unsafe or looping return destination https://outside.example falls back to account |
| ROUTE-005 | Unsafe or looping return destination //outside.example falls back to account |
| ROUTE-006 | Unsafe or looping return destination /\outside.example falls back to account |
| ROUTE-007 | Unsafe or looping return destination /SIGN-IN/ falls back to account |
| ROUTE-008 | Unsafe or looping return destination /a/../sign-in falls back to account |
| ROUTE-009 | Unknown URL displays a usable not-found page |
| AUTH-FLOW-011 | StrictMode initialization and cleanup preserve session handling |
| AUTH-FLOW-012 | Successful SDK sign-in waits for backend verification before granting access |
| AUTH-FLOW-013 | Rejected backend verification blocks access after SDK sign-in succeeds |
| AUTH-FLOW-014 | A successful HTTP response with missing user cannot establish identity |
| AUTH-FLOW-015 | A successful HTTP response with missing user ID cannot establish identity |
| AUTH-FLOW-016 | A successful HTTP response with malformed roles cannot establish identity |
| AUTH-FLOW-017 | A successful HTTP response with malformed account types cannot establish identity |
| AUTH-FLOW-018 | A verification network error hides protected content without leaking details |
| AUTH-FLOW-019 | Invalid verification JSON cannot establish an authenticated identity |
| AUTH-FLOW-020 | A late previous-account response cannot replace the current identity |
| AUTH-FLOW-021 | Successful token refresh uses the new token for subsequent authorised requests |
| AUTH-FLOW-022 | Duplicate sign-out clicks send one request and clear access after success |

### frontend/src/Rbac.test.jsx

| ID | Test title |
| --- | --- |
| RBAC-ROLE-001 | Venue Staff see venue and booking responsibilities only |
| RBAC-ROLE-002 | Technical Support Staff see equipment and technical responsibilities only |
| RBAC-ROLE-003 | Event Coordinator sees the current coordination permission set |
| RBAC-ROLE-004 | Multiple staff roles combine responsibilities without duplicate entries |
| RBAC-GUARD-001 | venue_staff may open a venues.read page |
| RBAC-GUARD-002 | venue_staff may open a bookings.read pa… |
| RBAC-GUARD-003 | venue_staff may not open a equipment.re… |
| RBAC-GUARD-004 | venue_staff may not open a technical_re… |
| RBAC-GUARD-005 | venue_staff may not open a event_planni… |
| RBAC-GUARD-006 | venue_staff may not open a attendees.re… |
| RBAC-GUARD-007 | venue_staff may not open a clients.read… |
| RBAC-GUARD-008 | venue_staff may not open a event_organi… |
| RBAC-GUARD-009 | technical_support_staff may not open a … |
| RBAC-GUARD-010 | technical_support_staff may not open a … |
| RBAC-GUARD-011 | technical_support_staff may open a equi… |
| RBAC-GUARD-012 | technical_support_staff may open a tech… |
| RBAC-GUARD-013 | technical_support_staff may not open a … |
| RBAC-GUARD-014 | technical_support_staff may not open a … |
| RBAC-GUARD-015 | technical_support_staff may not open a … |
| RBAC-GUARD-016 | technical_support_staff may not open a … |
| RBAC-GUARD-017 | event_coordinator may open a venues.rea… |
| RBAC-GUARD-018 | event_coordinator may open a bookings.r… |
| RBAC-GUARD-019 | event_coordinator may open a equipment.… |
| RBAC-GUARD-020 | event_coordinator may open a technical_… |
| RBAC-GUARD-021 | event_coordinator may open a event_plan… |
| RBAC-GUARD-022 | event_coordinator may open a attendees.… |
| RBAC-GUARD-023 | event_coordinator may open a clients.re… |
| RBAC-GUARD-024 | event_coordinator may open a event_orga… |
| RBAC-GUARD-025 | event_organiser may not open a venues.r… |
| RBAC-GUARD-026 | event_organiser may not open a bookings… |
| RBAC-GUARD-027 | event_organiser may not open a equipmen… |
| RBAC-GUARD-028 | event_organiser may not open a technica… |
| RBAC-GUARD-029 | event_organiser may not open a event_pl… |
| RBAC-GUARD-030 | event_organiser may not open a attendee… |
| RBAC-GUARD-031 | event_organiser may not open a clients.… |
| RBAC-GUARD-032 | event_organiser may not open a event_or… |
| RBAC-GUARD-033 | attendee may not open a venues.read page |
| RBAC-GUARD-034 | attendee may not open a bookings.read p… |
| RBAC-GUARD-035 | attendee may not open a equipment.read … |
| RBAC-GUARD-036 | attendee may not open a technical_reque… |
| RBAC-GUARD-037 | attendee may not open a event_planning.… |
| RBAC-GUARD-038 | attendee may not open a attendees.read … |
| RBAC-GUARD-039 | attendee may not open a clients.read pa… |
| RBAC-GUARD-040 | attendee may not open a event_organiser… |
| RBAC-GUARD-041 | event_ops_manager may not open a venues… |
| RBAC-GUARD-042 | event_ops_manager may not open a bookin… |
| RBAC-GUARD-043 | event_ops_manager may not open a equipm… |
| RBAC-GUARD-044 | event_ops_manager may not open a techni… |
| RBAC-GUARD-045 | event_ops_manager may not open a event_… |
| RBAC-GUARD-046 | event_ops_manager may not open a attend… |
| RBAC-GUARD-047 | event_ops_manager may not open a client… |
| RBAC-GUARD-048 | event_ops_manager may not open a event_… |
| RBAC-SCOPE-001 | venue_staff page guard permits venues.read for unassigned-venue despite unrelated profile metadata |
| RBAC-SCOPE-002 | venue_staff page guard permits venues.read for east-location despite unrelated profile metadata |
| RBAC-SCOPE-003 | technical_support_staff page guard permits equipment.read for microphone despite unrelated profile metadata |
| RBAC-SCOPE-004 | technical_support_staff page guard permits equipment.read for north-location despite unrelated profile metadata |
| RBAC-DENY-001 | no roles cannot mount a protected child |
| RBAC-DENY-002 | unknown role cannot mount a protected child |
| RBAC-DENY-003 | prototype-like role cannot mount a protected child |
| RBAC-DENY-004 | Anonymous direct access redirects before loading identity or mounting protected content |
| RBAC-DENY-005 | Unverified SDK role and permission claims cannot elevate the verified external user |
| RBAC-DENY-006 | missing permissions grant no protected page access |
| RBAC-DENY-007 | null permissions grant no protected page access |
| RBAC-DENY-008 | string permissions grant no protected page access |
| RBAC-DENY-009 | object permissions grant no protected page access |
| RBAC-DENY-010 | non-string permission entries grant no protected page access |
| RBAC-DENY-011 | Internal access alone does not grant a feature permission |
| RBAC-DENY-012 | Unknown feature permissions deny access even to coordinators |

### frontend/src/lib/supabase.test.js

| ID | Test title |
| --- | --- |
| AUTH-CONFIG-001 | Create the browser client from public configuration with session persistence and refresh |
| AUTH-CONFIG-002 | Concurrent initialization reuses one client and one configuration request |
| AUTH-CONFIG-003 | Configuration with missing URL does not create a client |
| AUTH-CONFIG-004 | Configuration with missing public key does not create a client |
| AUTH-CONFIG-005 | A failed configuration request can be retried successfully |

### frontend/src/features/auth/SignIn.test.jsx

| ID | Test title |
| --- | --- |
| AUTH-FORM-001 | Empty email prevents authentication |
| AUTH-FORM-002 | Empty password prevents authentication |
| AUTH-FORM-003 | Invalid email syntax prevents authentication |
| AUTH-FORM-004 | Submit entered credentials for ryan@gmail.com without a domain allowlist |
| AUTH-FORM-005 | Submit entered credentials for staff@connectsphere.sg without a domain allowlist |
| AUTH-FORM-006 | Submit entered credentials for attendee.demo@example.com without a domain allowlist |
| AUTH-FORM-007 | Provider status 400 displays a safe message and clears the password |
| AUTH-FORM-008 | Provider status 422 displays a safe message and clears the password |
| AUTH-FORM-009 | Provider status 429 displays a safe message and clears the password |
| AUTH-FORM-010 | Provider status 503 displays a safe message and clears the password |
| AUTH-FORM-011 | Provider status undefined displays a safe message and clears the password |
| AUTH-FORM-012 | Concurrent submissions send one request and disable the form |
| AUTH-FORM-013 | Network failure clears the password and permits a successful retry |
| AUTH-FORM-014 | Password visibility toggles without submitting or changing the password |
| AUTH-FORM-015 | Keyboard Enter submits the filled form exactly once |

### frontend/src/features/auth/signInService.test.js

| ID | Test title |
| --- | --- |
| AUTH-SERVICE-001 | Normalize email whitespace while preserving the exact password |

### frontend/src/features/auth/StaffResponsibilities.test.jsx

| ID | Test title |
| --- | --- |
| RBAC-DATA-001 | Responsibilities stay hidden while the protected API request is pending |
| RBAC-DATA-002 | HTTP 401 exposes no protected responsibilities or raw server details |
| RBAC-DATA-003 | HTTP 403 exposes no protected responsibilities or raw server details |
| RBAC-DATA-004 | Provider outage hides data and a successful retry restores the permitted list |
| RBAC-DATA-005 | Network failure grants no data access and permits retry |
| RBAC-DATA-006 | An empty permitted list does not invent staff responsibilities |
| RBAC-DATA-007 | Leaving the staff component aborts a pending request and ignores its late response |

# Access acceptance tests: sign-in, RBAC and organiser event scope

This suite uses Vitest, React Testing Library, user-event and jsdom. Application
code and endpoints changed for the later stories documented below; the original
sign-in suite does not write cloud data or change live role assignments.
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

The `event_ops_manager` policy is documented as a guard-matrix case: it has
`event_organisers.read` and `internal.access`, so internal pages are denied by
their own permissions rather than at the shared gate. Passing that test confirms
current behavior, not customer approval of that policy. See
`docs/staff-access.md`.

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


## SCRUM-100 organiser event scope (2026-10-05)

This is the Access lane's consolidated test guide for SCRUM-100. The user
approved the fourteen specifications below before implementation, then requested
the unit/integration/API/E2E testing follow-up. Event Organisers are external
clients. Organisers in the same company can read each other's requests; each
organiser can edit only their own requests. See [event access](../event-access.md#scrum-100-external-client-organiser-scope)
and [manual account setup](../seed-users.md#scrum-100-client-organisations).

### Requirements and traceability

| AC | Acceptance criterion supplied by the user | Test specifications |
| --- | --- | --- |
| 1 | Given an event they are responsible for, the Event Organiser can view, edit and update it. | TC-SCRUM-100-01/02/13 |
| 2 | Given an event belonging to another Event Organiser in the same client organisation, the Organiser can view it but cannot edit or update it. | TC-SCRUM-100-03/04 |
| 3 | Given an event belonging to an unrelated client organisation, the Organiser cannot view it in any listing, search result or by direct reference. | TC-SCRUM-100-05/06/07/09/11/14 |
| 4 | Attempting an unauthorised edit is refused and leaves the event unchanged. | TC-SCRUM-100-04/06/08/10/11/12 |

Validation, dependency failure, session changes and mobile/keyboard checks support
these AC and the repository's Definition of Done. They do not introduce new
permissions or client/staff account combinations.

### Layers: what is real and what is simulated

| Layer | Files (relative to repository root) | What it proves | Boundary replaced in tests |
| --- | --- | --- | --- |
| Backend unit | `backend/tests/unit/events/eventWorkspace.service.test.js`, `events.validation.test.js` in the same folder | Direct service/validator rules, normalisation, protected fields, membership, failures and owner race; no HTTP server | Auth admin methods and the existing in-memory storage adapter. Service and validation are real. |
| Frontend helper unit | `frontend/src/features/events/eventsService.test.js` | Correct authenticated PATCH, local-time conversion, validation/error contracts | Auth SDK session and fetch transport |
| Backend integration | `backend/tests/integration/eventWorkspace.test.js` | Real Express app, authentication, permission/record checks, validation, response codes and stored state together over local HTTP | Auth token lookup and storage; organiser service remains real |
| Frontend component/flow integration | `frontend/src/features/events/pages/EventWorkspaceDetailPage.test.jsx`, `EventWorkspacePage.test.jsx` | Real App, AuthProvider, router, guards and form/list behaviour together in jsdom | Auth SDK and fetch; fake server responses here do not prove server security |
| Backend API acceptance | `tests/playwright/event-workspace.api.spec.cjs` | Direct HTTP calls to the running Express app, actual SDK transport to local Auth simulator, role denials and complete stored-row comparisons | External Auth service and database storage. Production guards, routes and service rules remain real. |
| Browser E2E | `tests/playwright/event-workspace.browser.spec.cjs` | Real Chromium login, UI, proxy, backend, save/reload, colleague view-only, search/direct-link denial and revoked access during editing | Same local Auth/storage boundaries; no intercepted or mocked PATCH response |

Unit tests make failures easy to locate. Integration tests prove the pieces work
together. API tests bypass buttons to prove security. Browser tests prove the
journey a user actually follows. The suites reuse installed Vitest/Playwright;
there are no new packages, configuration files or test harnesses.

### Fixture data

| Symbol | Account and event | Trusted membership / starting data |
| --- | --- | --- |
| A / E-A | Responsible organiser and their request | `app_metadata.roles: ['event_organiser']`, company Alpha |
| B / E-B | Another organiser and their request | Same role and Alpha membership; A has read-only access |
| C / E-C | Unrelated client organiser and their request | Beta membership; forged `user_metadata.organisation_id: Alpha` cannot grant access |

Service unit fixtures use account IDs `alice`, `bob`, `cara`, event IDs
`event-alice`, `event-bob`, `event-cara`, and company keys `alpha`/`beta`.
HTTP tests use generated valid UUIDs and compare the IDs returned by setup;
never substitute these short unit IDs into an HTTP URL. Playwright creates A/B/C
with unique Alpha/Beta UUIDs per test and submits their requests through POST
`/api/events`. Every test gets isolated accounts/storage and cleans them up.

The unit and Playwright fixtures use attendance `20`, start
`2099-01-01T01:00:12.345Z`, end `2099-01-01T03:00:12.345Z`. The unit starting
status is `APPROVED`; Playwright submissions start `SUBMITTED`. Neither state
grants a colleague editing rights. Partial saves must preserve status, owner,
coordinator, submission time and unedited timestamp milliseconds. Frontend tests
pin `TZ=Asia/Singapore`. Integration fixtures also include older staff events;
the expected list there includes all Alpha-owned fixture events, not exactly two.

### Agreed test case specifications

In the automation column, UNIT/VAL/SERVICE/UI abbreviate the corresponding
`SCRUM-100-...` IDs in the catalog below. INT means the descriptive
`[SCRUM-100 ACn]` cases in `eventWorkspace.test.js`; use the objective in the row
to locate the matching full test title. API/E2E IDs keep their full prefixes.
All execution entries refer to local isolated tests on 2026-10-05, not live
Supabase or CI. Each row specifies setup, action, input and observable outcome.

| ID | AC / type | Preconditions, steps and test data | Expected result | Automated by | Latest execution |
| --- | --- | --- | --- | --- | --- |
| TC-SCRUM-100-01 | 1 / Happy | A authenticated; GET organiser list, then GET E-A or open `/my-event-requests/<E-A UUID>` | Own request visible, detail readable, Edit event available | UNIT-001; INT AC1; UI-001; EVENT-API-100; E2E-EVENT-100 | Local pass, 2026-10-05 |
| TC-SCRUM-100-02 | 1 / Happy | Open E-A, change name to `Client request updated in the browser` and equipment needs to `Two microphones`, save and reload. Unit input also checks `  Revised workshop  `, attendance `"1"`, blank optional comment | Persisted changed fields; trimmed name/integer attendance/null optional comment where supplied; all protected and untouched fields retained | UNIT-002; SERVICE-001; UI-001; INT AC1; EVENT-API-100; E2E-EVENT-100 | Local pass, 2026-10-05 |
| TC-SCRUM-100-03 | 2 / Happy | A and B belong to Alpha; list and directly open E-B | E-B visible under Other organisers' event requests; same-company/view-only explanation; no Edit event button | UNIT-001; INT AC2 including directory pagination; UI-002/007; EVENT-API-100; E2E-EVENT-100 | Local pass, 2026-10-05 |
| TC-SCRUM-100-04 | 2,4 / Negative | A sends PATCH E-B with `{name: 'Unauthorised peer change'}` despite having no UI edit control | 403; every stored E-B field equals its before snapshot | UNIT-003; INT AC2; EVENT-API-100; E2E-EVENT-100 | Local pass, 2026-10-05 |
| TC-SCRUM-100-05 | 3 / Negative | A lists requests and searches E-C's exact name; sends search/organisation/organiser query claims targeting Beta | E-C and private fields absent from server list and browser search; own/peer positive controls remain visible before filtering | UNIT-001; INT AC3; UI-007; EVENT-API-100; E2E-EVENT-100 | Local pass, 2026-10-05 |
| TC-SCRUM-100-06 | 3,4 / Negative | A GETs/PATCHes known E-C UUID, then opens its browser URL; compare missing-record GET | Same safe 404 `Event not found.` for hidden/missing reference, no E-C detail or controls, complete E-C row unchanged | UNIT-003; INT AC3/AC4; EVENT-API-100; E2E-EVENT-100 | Local pass, 2026-10-05 |
| TC-SCRUM-100-07 | 3 / Boundary | Remove A's trusted organisation; integration also tries blank and non-string values, with forged profile membership | Own read/edit retained; E-B hidden; missing memberships never join accounts into one group | UNIT-005; INT AC3; EVENT-API-101 | Local pass, 2026-10-05 |
| TC-SCRUM-100-08 | 1,4 / Negative | PATCH E-A with a valid name plus `organiser_id`, or `status`, `coordinator_id`, organisation or unknown fields | Whole request rejected with 400; no partial name save or protected-field change | UNIT-004; INT AC4; EVENT-API-100 | Local pass, 2026-10-05 |
| TC-SCRUM-100-09 | 3 / Negative | Forge company in profile/query/body; then change trusted Alpha membership to Beta or remove it using test admin setup | Untrusted claims ignored; current trusted affiliation governs next request, old colleague visibility revoked, own access retained | UNIT-005/008; INT AC3; EVENT-API-100/101 | Local pass, 2026-10-05 |
| TC-SCRUM-100-10 | 4 / Conflict | Change E-A owner from A to B between access lookup and UPDATE; A attempts `{name: 'Stale change'}` | 409; row reflects only the independently injected owner change, none of A's requested edits | UNIT-007; INT AC4 responsibility-race case | Local pass, 2026-10-05 |
| TC-SCRUM-100-11 | 3,4 / Failure | Inject membership/directory/record-read/save failure; UI initially receives safe lookup failure then Retry succeeds | 503 HTTP with no private provider diagnostics or unscoped fallback; no event write. UI shows safe error/retry | UNIT-006; INT AC3/AC4 failure cases; UI-010; SERVICE-005 | Local pass, 2026-10-05 |
| TC-SCRUM-100-12 | 4 / Cross-cutting | PATCH without token/with forged token; try every non-organiser role; remove A's role after a valid GET or after opening Edit with `Do not save this revoked edit` | 401 without valid session, 403 for denied/revoked role; complete stored rows unchanged. Open form retains entered text and safe error; reload denies access | INT AC4; SERVICE-002/004; UI-005; EVENT-API-102–109; E2E-EVENT-101 | Local pass, 2026-10-05 |
| TC-SCRUM-100-13 | 1 / Boundary | PATCH malformed UUID, `{}`, whitespace name, 201-char name/2001-char text, attendance 0/1/1.5, invalid/past changed start, end equal to/after start; also edit an unchanged 2020 schedule | Invalid request 400/no write. Name 200/text 2000/attendance 1 accepted; changed future schedule strictly ordered; unchanged past times retained | UNIT-002/004; VAL-001–003 plus existing boundary tests; INT AC1/AC4; UI-004; EVENT-API-110 | Local pass, 2026-10-05 |
| TC-SCRUM-100-14 | 3 / Cross-cutting | Start detail fetch for A, switch session/account, then resolve A's delayed response | A's records and edit controls disappear; delayed response cannot restore old-account data | UI-006; UI-008 for pending list state | Local pass, 2026-10-05 |

### Automated case catalog

| IDs | Behaviour |
| --- | --- |
| SCRUM-100-UNIT-001 | Own/peer read positive controls; outsider absent |
| SCRUM-100-UNIT-002 | Normalised partial owner save and preservation of untouched fields/other rows |
| SCRUM-100-UNIT-003 | Peer/outside/missing refusal before any storage update call |
| SCRUM-100-UNIT-004 | Invalid/protected inputs cannot partially mutate a row |
| SCRUM-100-UNIT-005 | Missing trusted company ignores profile claims; own access retained |
| SCRUM-100-UNIT-006 | Membership/directory/record-read failure stops all writes |
| SCRUM-100-UNIT-007 | Atomic owner predicate rejects stale responsibility |
| SCRUM-100-UNIT-008 | Changed trusted company replaces old colleague access on next lookup |
| SCRUM-100-VAL-001–003 | Field limits/attendance one, strict changed schedule, unchanged past schedule |
| SCRUM-100-SERVICE-001–006 | PATCH/time conversion, no session, field errors, denial, network failure, malformed success |
| SCRUM-100-UI-001–006 | Changed-fields save, peer view-only, cancel, validation correction, denied-save input retention, account switch |
| SCRUM-100-UI-007–010 | Own/peer grouping and scoped search, loading, empty state, failure/retry |
| Backend `[SCRUM-100 AC1]` (2), AC2 (2), AC3 (5), AC4 (6) | Fifteen descriptive integration tests cover successful/read-only/hidden scope, pagination, metadata forgery/change, validation, all denied roles, race and dependency failures |
| EVENT-API-100/101 | Scope, owner save/read-back, peer/outside denial/full rows, protected fields, query/profile spoofing and membership removal |
| EVENT-API-102–107 | Separate denied PATCH case for attendee, ops manager, coordinator, venue staff, technical staff, and venue+technical account respectively. The dual staff account is an existing supported policy, not a new client/staff combination. |
| EVENT-API-108 | Missing and forged bearer token: 401 and unchanged storage |
| EVENT-API-109 | Previously valid organiser token after role removal: 403 and unchanged storage |
| EVENT-API-110 | Empty/blank/partly invalid bodies and malformed reference: safe 400, no partial save |
| E2E-EVENT-100 | Login, own/peer list, exact-name search, keyboard edit, save/reload, timestamps, 375px overflow, peer API denial and outside direct link |
| E2E-EVENT-101 | Real PATCH 403 after role removal during editing; input retained, full rows unchanged, reload Access denied |

There are 55 SCRUM-100-named automated tests across these layers: 11 backend
unit, 15 backend integration, 16 frontend helper/flow, 11 API and 2 browser.
File totals below are larger because the existing files also retain older stories.
No test has been deleted or marked skipped.

### HTTP contract checked independently of buttons

All paths below are under `/api/event-workspace/organiser`.

| Status | Trigger / outcome | Evidence |
| --- | --- | --- |
| 200 | Scoped list/detail; valid own PATCH persists and can be read back | Integration, EVENT-API-100, E2E-EVENT-100 |
| 400 | Malformed UUID or invalid/protected body; safe validation message, no partial write | Integration, EVENT-API-100/110 |
| 401 | Missing/forged session; no write or private details | Integration, EVENT-API-108 |
| 403 | Visible peer edit or wrong/revoked role; full row unchanged | Integration, EVENT-API-100/102–109, E2E-EVENT-100/101 |
| 404 | Outside/missing UUID; identical `Event not found.` body avoids existence disclosure | Integration, EVENT-API-100, E2E-EVENT-100 |
| 409 | Owner changes between lookup and conditional UPDATE; stale edits absent | Integration and UNIT-007; this race is injected at the storage boundary, not through Playwright |
| 503 | Trusted membership/directory/storage unavailable; no fallback/unscoped response or write | Integration plus UNIT-006; dependency failure is injected, not a live outage |

### Run just this story

Open PowerShell in `C:\Users\ryanl\OneDrive\Documents\GitHub\ConnectSphere`.
Use the installed dependencies; the agent did not install anything. You can
prefix a command with `! ` in Codex to send its output into the conversation.

| Layer | Command from repository root | Expected file totals |
| --- | --- | --- |
| Backend service + validation unit | `npm --prefix backend run test:events -- tests/unit/events/eventWorkspace.service.test.js tests/unit/events/events.validation.test.js` | 41 passed, 2 files |
| Backend integration | `npm --prefix backend run test:events -- tests/integration/eventWorkspace.test.js` | 27 passed, 1 file |
| Frontend helper + real App flows | `npm --prefix frontend test -- --run --maxWorkers=1 src/features/events/eventsService.test.js src/features/events/pages/EventWorkspaceDetailPage.test.jsx src/features/events/pages/EventWorkspacePage.test.jsx` | 36 passed, 3 files |
| Direct backend API | `npm run test:api -- tests/playwright/event-workspace.api.spec.cjs` | 13 passed; 11 SCRUM-100 + 2 older workflows |
| Browser E2E | `npm run test:e2e -- tests/playwright/event-workspace.browser.spec.cjs` | 4 passed; 2 SCRUM-100 + 2 older workflows |
| Both Playwright layers | `npm run test:playwright -- tests/playwright/event-workspace.api.spec.cjs tests/playwright/event-workspace.browser.spec.cjs` | 17 passed |

To run only story-named cases, append `--testNamePattern SCRUM-100` to a Vitest
command or `--grep SCRUM-100` to a Playwright command. This intentionally filters
older tests; use the unfiltered commands above and full regression below for
handoff. Playwright starts its own local servers; Docker and live credentials
are not required. Do not separately start servers on its test ports.

A failure prints the test name and expected/actual result. Check its case ID
above and retain the output; do not loosen assertions. For occupied ports use
the existing [Playwright port guidance](playwright-acceptance.md#ports-and-ci).
For frontend resource timeouts run that suite alone with `--maxWorkers=1` as
shown. Missing dependencies/browser binaries require the user's installation
step under AGENTS.md; the agent must not install them automatically.

### Latest execution and regression (local, 2026-10-05)

| Check | Result |
| --- | --- |
| Backend unit focused command above | 41 passed, including all 8 new direct service tests |
| Backend integration focused command above | 27 passed, including all 15 SCRUM-100 cases |
| Focused workspace Playwright command above | 17 passed, 0 failed/flaky/skipped |
| Isolated backend Vitest coverage command below | 332 passed, 17 files |
| Existing backend auth/permissions `node:test` suites | 29 passed |
| Existing backend equipment `node:test` unit suites | 67 passed |
| Full frontend coverage command below, run alone with one worker | 223 passed, 14 files; 0 failed |
| `npm run test:playwright` | 148 passed: 105 API + 43 Chromium; 0 failed/flaky/skipped |
| `npm --prefix backend run check -- --ignore-pattern '.vitest/**'` | Passed source lint; existing generated report excluded explicitly |
| `npm --prefix frontend run lint` | Passed, with one unused-disable warning in generated `coverage/block-navigation.js` |
| `git diff --check` / HEAD and index inspection | Passed; HEAD unchanged, nothing staged or committed |

The first full frontend coverage run overlapped other suites and timed out in
three tests (220 passed, 3 failed). The controlled single-worker run completed
223/223 without source changes, relaxed assertions or raised timeouts. A local
pass is evidence for that run; CI still provides independent execution.

Run these coverage commands separately, from the same repository root:

```powershell
npm --prefix backend run test:cov -- --exclude tests/integration/equipment.availability.test.js --exclude 'tests/unit/equipment/**' --exclude tests/integration/auth.test.js --exclude tests/integration/permissions.test.js
npm --prefix frontend run test:cov -- --run --maxWorkers=1 --reporter=default --reporter=json --outputFile=.vitest/SCRUM-100-results.json
```

The backend exclusions keep the cloud-writing equipment integration out of
agent execution and run the older Node suites with their own runner. The older
isolated commands are `npm --prefix backend run test:auth` and
`npm --prefix backend run test:equipment`; both were verified using the Node
spec reporter. Do not run unrestricted backend `npm test` or the older
`tests/e2e/` live package as an isolated test: they need separate shared-data
agreement and actual Supabase access.

Reports are ignored generated artifacts, not files to commit:

- Full Playwright report: `playwright-report/index.html`; JSON `test-results/results.json`. Run `npm run test:playwright:report` from the root to inspect failures/traces. Subsequent runs replace these reports.
- Latest successful frontend machine report: `frontend/.vitest/SCRUM-100-results.json`; coverage `frontend/coverage/index.html` and `coverage-final.json`. That run overrides the HTML test reporter; `frontend/.vitest/index.html` may still contain the earlier concurrent run. Use the JSON for these recorded results, or rerun with the default reporters and one worker to refresh test HTML.
- Backend coverage: `backend/coverage/index.html` and `coverage-final.json`. Vitest does not instrument Playwright or `node:test`.

The standard backend lint command includes a pre-existing generated `.vitest`
report and previously failed with 960 diagnostics there. The explicit source
check above passes; no unrelated config/report deletion was made. No build or
Docker files changed in this testing follow-up. The earlier frontend build
passed with its existing bundle-size advisory; Docker daemon was unavailable
on the earlier attempt. Full cloud backend integration, live RLS, Docker build,
GitHub CI and teammate review remain unverified. Existing CI discovers the new
unit/adjacent frontend tests and runs both Playwright projects, so no new npm
script or CI edit is needed. These results do not complete the whole repository's
Definition of Done or authorise marking Jira Done.

### Coverage and documented gaps

| File | Statements | Branches | Story gap review |
| --- | --- | --- | --- |
| backend auth/permissions.js | 100% | 85.71% | Uncovered fallback at line 81 belongs to pre-existing policy resolution; new update permission is exercised through real role guards. |
| backend events/eventWorkspace.service.js | 92.86% | 84.13% | Every added organiser branch is hit. Existing unknown-scope paths at 46–47 are unreachable through fixed routes; directory coordinator choice/error/name-fallback branches at 79–91 predate SCRUM-100. |
| backend events/events.service.js | 100% | 100% | Re-exported normalise helper measured by existing submission and edit tests. |
| backend events/events.validation.js | 100% | 100% | New partial-edit validator measured completely, including invalid and boundary inputs. |
| backend routes/eventWorkspace.routes.js | 100% | 97.06% | New PATCH and scoped-read/error branches all hit; uncovered existing available/no-service branch at line 10 is outside configured fixtures. |
| frontend events/eventsService.js | 100% | 100% | New save helper covers session, success, validation, denial, network and malformed success. |
| frontend EventRequestForm.jsx | 88.42% | 72.07% | Editing measured in real App tests. Missing statements at 56/152 and branches at 110/149/153/278/282 belong to existing submit/default-form wiring, covered by EVENT-E2E-001/002/006/007 in Playwright (not Vitest instrumentation). Date-missing initialisation at 113 is legacy/partial-record fallback; normal submitted events have both times. Existing field-shell hint/required/error alternatives at 30/37/46/73/75/102–104, duplicate-submit early return at 142 and plural fallback at 271 are inherited presentation/guard paths; edits use required name error and safe server messages. Busy editing label is not held pending by the fast unit transport; saving persistence is independently checked by browser/API tests. |
| frontend EventWorkspaceDetailPage.jsx | 95.92% | 86.89% | 100% lines; organiser read/edit/view-only/save/cancel/failure paths hit. Gaps at 39–40/50 are coordinator/manager JSX and existing route wrapper, exercised by prior workspace browser tests. Null-display alternative at 44 is inherited display behaviour. |
| frontend EventWorkspacePage.jsx | 95.95% | 89.58% | 100% lines; organiser grouping/search/loading/empty/error/retry hit. Uncovered arms at 8/14/49–50 are other-scope list presentation and JSX source-map paths; coordinator/manager journeys pass in Playwright. |
| frontend lib/api.js | 23.08% | 33.33% | Existing Venue API wrappers and unrelated transport fallback paths are outside this story's unit scope. New error.errors array/non-array arms are both hit through save tests. Full browser regression verifies Venue integration. |

Percentages come from the ignored coverage-final.json artifacts, not inferred from
test counts. Vitest does not instrument Playwright or node:test; no whole-repo
100% claim is made. Source positions above are the V8 branch-map positions;
JSX can map multiple branch arms to one source expression. Demo seed changes are
outside the Vitest include path; syntax and source lint were checked, but the
live seed was deliberately not executed. No tests were deleted or marked skipped.

Measured line coverage: backend organiser service 96.77%, validator/routes/normalise 100%; frontend helper/detail/list 100%, shared form 96.83%. The form busy-editing-label branch is an explicitly unmeasured story branch; no blanket 100% organiser UI branch claim is made. These gaps are reported rather than hidden by coverage exclusions.

### Five-question review of the tests

1. **Which AC?** The specification and catalog tables map every added case to AC1–4 or the required validation/session/usability checks.
2. **Which plausible bug would fail?** Removing the organisation filter fails own-positive/outside-negative reads; allowing peer updates fails 403/full-row comparisons; removing the UPDATE owner predicate fails UNIT-007 and integration 409. Accepting protected fields or partially applying invalid data fails complete-row comparisons. Returning success without persistence fails API read-back and browser reload. Caching a revoked role fails API-109 and E2E-101. Old-account responses fail UI-006. Strict time/length boundaries catch permissive validation. These are reasoned counterexamples, not a mutation-tool run.
3. **Can the user explain arrange/action/result?** Three accounts, two companies, three event requests: A can save E-A, read E-B, and cannot find E-C. Each case changes just the relevant role, membership, input or dependency; the tables give exact values and expected outcomes.
4. **Are expectations justified independently?** Owner editing, same-company read-only, outside invisibility and unchanged denied writes come from the user's AC. Trusted Auth metadata is the agreed identity model. Safe HTTP codes follow the existing API contract; field limits reuse the existing submission requirements.
5. **Deterministic and non-vacuous?** Isolated accounts/storage, far-future dates, fixed timezone and positive owner/peer reads prevent false passes from empty fixtures. Denials compare full stored rows, not just status or a hidden button. The controlled frontend rerun is recorded above; CI and live policies are separate evidence.

### Manual demo and new files

For the live demo, use the three organiser accounts configured as described in
[seed users](../seed-users.md#scrum-100-client-organisations). As A, open own
request, edit/reload it, open B's request and confirm view-only, search C's exact
name and open its known direct URL. Compare denied-edit storage before/after
using an approved test account, not another client's production event.
The user reports the Auth setup and app working; the agent has not independently
verified live Supabase/RLS or executed the seed. Keep client and internal staff
accounts separate as agreed. Original brief/course-section private clarifications
remain unavailable for the original implementation source review.

| New test file in this uncommitted story | Why it exists |
| --- | --- |
| `backend/tests/unit/events/eventWorkspace.service.test.js` | Added in the testing follow-up: direct service unit coverage previously exercised only through HTTP |
| `frontend/src/features/events/pages/EventWorkspaceDetailPage.test.jsx` | Added during implementation: real App organiser read/edit/denial/session flows |
| `frontend/src/features/events/pages/EventWorkspacePage.test.jsx` | Added during implementation: real App scoped grouping/search/loading/empty/retry flows |

All other test changes extend existing files. This guide extends the existing
Access test guide; there is no new committed Markdown guide. Working notes and
gate evidence stay ignored under `.agent/docs/other/`. No commits, staging,
live database writes or dependency installs were performed.

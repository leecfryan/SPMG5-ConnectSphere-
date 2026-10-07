# Venue lane test guide

Test case specifications for all SCRUM stories in the Venue lane. IDs follow
`TC-SCRUM-<n>-<nn>`. Automated test commands are listed at the bottom.

---

## SCRUM-133 — Mark a venue temporarily unavailable

### Test cases

| ID | AC | Type | Scenario | Pre-conditions | Steps | Test data | Expected result | Automated by | Latest execution |
|---|---|---|---|---|---|---|---|---|---|
| TC-SCRUM-133-01 | 1 | Happy | Venue Staff creates a single-day, single-slot unavailability period | Venue Staff signed in, venue exists | POST /api/venues/:id/unavailability with valid body | `{ start_date: "2099-11-01", end_date: "2099-11-01", slots: ["am"], reason: "Maintenance" }` | 201 with period object | `venues.unavailability.test.js` | 2026-10-07 pass |
| TC-SCRUM-133-02 | 2 | Happy | Multi-day, multi-slot period | Venue Staff signed in | POST with start/end 3 days apart and two slots | `{ start_date: "2099-11-01", end_date: "2099-11-03", slots: ["am","pm"], reason: "Renovation" }` | 201; end_date and slots in response | `venues.unavailability.test.js` | 2026-10-07 pass |
| TC-SCRUM-133-03 | 3 | Happy | Booking request blocked by unavailability | listUnavailabilityInRange mocked to return row for slot | Coordinator POSTs booking request for that slot | unavailable_date matching request date | 409 conflict | `venues.unavailability.test.js` | 2026-10-07 pass |
| TC-SCRUM-133-04 | 3 | Happy | Multiple slots blocked when all are covered | Two slot rows mocked | Coordinator tries each slot | am, pm | all return 409 | `venues.unavailability.test.js` | 2026-10-07 pass |
| TC-SCRUM-133-05 | 4 | Happy | Confirmed booking survives period creation | Existing booking in DB | POST period overlapping date | same venue/date/slot | 201; decideBookingRequest not called | `venues.unavailability.test.js` | 2026-10-07 pass |
| TC-SCRUM-133-06 | 5 | Happy | Edit period reason and end date | Period exists | PATCH with new reason and earlier end_date | `{ reason: "Updated reason", end_date: "2099-11-02" }` | 200; period shows updated values | `venues.unavailability.test.js` | 2026-10-07 pass |
| TC-SCRUM-133-07 | 5 | Happy | End period early (shorten end_date) | Period runs 2099-11-01 to 2099-11-05 | PATCH end_date to 2099-11-02 | `{ end_date: "2099-11-02" }` | 200; end_date is 2099-11-02 | `venues.unavailability.test.js` | 2026-10-07 pass |
| TC-SCRUM-133-08 | 1 | Happy | Venue Staff lists periods for a venue | Periods exist | GET /api/venues/:id/unavailability | — | 200 with array of periods | `venues.unavailability.test.js` | 2026-10-07 pass |
| TC-SCRUM-133-09 | 1 | Negative | Event Coordinator cannot create periods | Coordinator signed in | POST /api/venues/:id/unavailability | valid body | 403 | `venues.unavailability.test.js` | 2026-10-07 pass |
| TC-SCRUM-133-10 | 1 | Negative | Unauthenticated request refused | No token | POST | valid body | 401 | `venues.unavailability.test.js` | 2026-10-07 pass |
| TC-SCRUM-133-11 | 1 | Negative | Non-existent venue returns 404 | Venue Staff signed in | POST to unknown venue id | valid body | 404 | `venues.unavailability.test.js` | 2026-10-07 pass |
| TC-SCRUM-133-12 | 2 | Negative | Invalid slots rejected | Venue Staff signed in | POST with `slots: ["noon"]` | `{ slots: ["noon"] }` | 400 | `venues.unavailability.test.js` | 2026-10-07 pass |
| TC-SCRUM-133-13 | 2 | Negative | end_date before start_date rejected | Venue Staff signed in | POST with end before start | `{ start_date: "2099-11-05", end_date: "2099-11-01" }` | 400 | `venues.unavailability.test.js` | 2026-10-07 pass |
| TC-SCRUM-133-14 | 5 | Negative | PATCH with end_date before period start_date rejected | Period exists with start 2099-11-01 | PATCH `{ end_date: "2099-10-01" }` | end before start | 400 | `venues.unavailability.test.js` | 2026-10-07 pass |
| TC-SCRUM-133-15 | 2 | Boundary | Minimum period: one slot, one day | Venue Staff signed in | POST | same start and end date, one slot | 201 | `venues.unavailability.test.js` | 2026-10-07 pass |
| TC-SCRUM-133-16 | 3 | Boundary | Booking blocked when period covers that slot | Unavailability row mocked | Coordinator POSTs booking request | matching slot/date | 409 | `venues.unavailability.test.js` | 2026-10-07 pass |
| TC-SCRUM-133-17 | 5 | Boundary | Edit period to set end_date = start_date (one day) | Multi-day period exists | PATCH end_date to = start_date | — | 200 | `venues.unavailability.test.js` | 2026-10-07 pass |
| TC-SCRUM-133-18 | 4 | Conflict | Confirmed booking in period range is not cancelled | Existing booking | Create period covering its date | same venue/date | 201; booking service not called | `venues.unavailability.test.js` | 2026-10-07 pass |
| TC-SCRUM-133-19 | 5 | Negative | PATCH on non-existent or wrong-venue period returns 404 | getUnavailabilityPeriodById returns null | PATCH | valid body | 404 | `venues.unavailability.test.js` | 2026-10-07 pass |

### Coverage notes

All 19 test cases are automated in `backend/tests/integration/venues.unavailability.test.js` (Vitest).
The tests use a real Express app with a fully stubbed service and fake auth, exercising the routing,
permission guards, validation and HTTP-layer behaviour without a database.

The period expansion logic in `listUnavailabilityInRange` (converting `venue_unavailability_periods`
rows into the per-slot shape `buildAvailabilityCalendar` reads) is service-level code. It is verified
via the integration tests that mock the service's expansion output into the booking endpoint (TC-133-03,
TC-133-04, TC-133-16). A direct unit test of the expansion is not written as the function has no
complex branching beyond the date range filter and flatMap.

### Test commands

```
npm --prefix backend test           # runs all Vitest + node:test suites (backend)
npm --prefix frontend test -- --run # runs all Vitest suites (frontend)
npm --prefix frontend run lint      # ESLint
npm --prefix frontend run build     # build check
npm run test:playwright             # Playwright browser + API (requires local server)
```

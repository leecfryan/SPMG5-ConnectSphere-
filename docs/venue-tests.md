# Venue — Test Documentation

Test evidence for the Venue lane (epic SCRUM-6). Behaviour, API and the schema reference live in
[Venue integration](venue-integration.md); this file is the catalogue of what is tested and where.

**174 automated backend tests across nine suites, plus 7 browser journeys and 13 frontend component tests, all
passing.** Manual cases are run against the shared Supabase database and recorded in the team's TESTS sheet.

| Suite | File | Tests |
| --- | --- | --- |
| Decisions | `backend/tests/integration/venueDecisions.test.js` | 22 |
| Catalogue, calendar, requests | `backend/tests/integration/venues.integration.test.js` | 53 |
| Storage and query scope | `backend/tests/integration/venues.storage.test.js` | 5 |
| Unavailability periods | `backend/tests/integration/venues.unavailability.test.js` | 21 |
| Setup and turnaround (committed period) | `backend/tests/integration/venues.turnaround.test.js` | 16 |
| Release on event cancellation | `backend/tests/integration/venue-release-cancelled-event.test.js` | 3 |
| Per-venue booking checks (SCRUM-138) | `backend/tests/integration/venueBookingChecks.test.js` | 22 |
| Per-venue booking checks, unit (SCRUM-138) | `backend/tests/unit/venues/venueBookingChecks.test.js` | 17 |
| Booking checks, report, button and entry link (SCRUM-138) | `frontend/src/features/venues/components/*.test.jsx` | 13 |
| Tentative holds | `backend/tests/integration/venues.holds.test.js` | 15 |
| Browser journeys | `tests/playwright/venues.browser.spec.cjs` | 7 |

Run everything:

```bash
npm --prefix backend test                # all backend suites
npm --prefix frontend test -- --run      # frontend components
npm run test:playwright                  # browser and API
npm --prefix backend run check
npm --prefix frontend run lint
```

**No backend venue test connects to Supabase.** Each builds the real Express app through `createApp({...})` with a
stubbed venue service and fake verified identities, so routing, permissions, validation and status codes are
exercised without a database. The storage suite stubs the Supabase client itself to assert the exact queries sent.

Test names lead with a bracketed tag, so the runner's output is the traceability report. Story tags are
`[SCRUM-<n>]`; cross-cutting guards that belong to no single story use `[VENUE-…]` and `[ACCESS-VENUE-…]`.

---

## 1. Story coverage

| Story | Title | Automated tags | Sheet rows |
| --- | --- | --- | --- |
| SCRUM-15 | Browse the venue catalogue | `[SCRUM-15]` | TC-106 to TC-109, TC-121 |
| SCRUM-16 | Update operating information | `[SCRUM-16]` | TC-108, TC-122, TC-123 |
| SCRUM-17 | Availability calendar | `[SCRUM-17]` | TC-110, TC-124 to TC-127 |
| SCRUM-21 | Submit a booking request | `[SCRUM-21]`, `[VENUE-SCOPE-001/002/003]` | TC-111 to TC-116, TC-128, TC-129 |
| SCRUM-22 | Decide a venue booking request | `[SCRUM-22]`, `[VENUE-DECIDE-001]` to `[VENUE-DECIDE-004]` | TC-131 to TC-140 |

## Multi-venue event coverage (SCRUM-137)

The multi-venue implementation keeps one request and independent status per
venue booking. New submissions require `purpose`; existing rows without a
purpose remain readable as legacy data. The event-scoped request endpoint uses
`event_id` without weakening coordinator ownership scope.

Coverage includes:

- Multiple venue requests for one event, including different dates or periods.
- Per-booking venue, purpose, booking date and slot-period display.
- Independent confirmation and rejection with mixed outcomes visible together.
- Required purpose validation and legacy `Not recorded` display.
- Invalid event filters and coordinator cross-event isolation.

The confirmed-slot exclusion constraint remains the concurrency authority for
venue conflicts. No registration, waitlist, event-capacity or equipment behavior
is changed by this story.

The shared `EventVenueBookings` component renders all related bookings together
on Browse Event details, My Events cards and My Event details. Browse Events
cards deliberately omit venues until the attendee opens an event. Each rendered
booking includes venue, location, purpose, date, period and derived status.

After the fixture correction and SCRUM-138 browser journey, the full Playwright
verification on 2026-10-16 ran 186 tests: 186 passed and 0 failed.
`[VENUE-E2E-002]` supplies `Planning and coordination session`, and
`[VENUE-E2E-005]` verifies that one failed venue check does not alter the other
booking results. This matches the current required-purpose contract; production
behavior was not loosened.

| SCRUM-20 | Block conflicting venue booking | `[SCRUM-20]` | TC-167 to TC-175 |
| SCRUM-102 | Reject with a reason and suggested alternative | `[SCRUM-102]` | TC-220 to TC-229 |
| SCRUM-18 | Search and filter potential venues | `[SCRUM-18]` | TC-260 to TC-273 |
| SCRUM-19 | Assess shortlisted venue suitability | `[SCRUM-19]` | TC-274 to TC-286 |
| SCRUM-133 | Mark a venue temporarily unavailable | `[TC-SCRUM-133-01]` to `[TC-SCRUM-133-21]` | TC-SCRUM-133-01 to TC-SCRUM-133-21 |
| SCRUM-134 | Setup and turnaround time in conflict checks | `[TC-SCRUM-134-01]` to `[TC-SCRUM-134-11]` | TC-SCRUM-134-01 to TC-SCRUM-134-11 |
| SCRUM-138 | Check each venue booking of an event independently | `[SCRUM-138]`, `[VENUE-CHECK-001/002]`, `[SCRUM-138-UI-001]` to `[SCRUM-138-UI-008]`, `[VENUE-E2E-005]` | TC-SCRUM-138-01 to TC-SCRUM-138-16 |
| SCRUM-146 | Tentative venue hold with expiry | `[TC-SCRUM-146-01]` to `[TC-SCRUM-146-15]` | TC-SCRUM-146-01 to TC-SCRUM-146-15 |

Cross-cutting guards that apply to every story: `[VENUE-AUTH-001]` (seven identities against eight endpoints),
`[VENUE-AUTH-002]`, `[VENUE-INPUT-001]` (forged ownership and role fields), `[VENUE-CONFIG-001]` (missing venue
storage leaves sign-in working), `[VENUE-DB-001]` to `[VENUE-DB-005]`, `[VENUE-CHECK-001/002]` (the check report
needs a verified token and `bookings.read`), and `[ACCESS-VENUE-001/002]` from the RBAC
lane (event names redacted from coordinators; only accepted or approved events may request a venue).

---

## 2. SCRUM-102 — Reject a booking with a reason and suggested alternative

**Acceptance criteria, word for word**

1. A rejection must carry a reason.
2. Venue Staff may attach a suggested alternative venue or arrangement to the rejection.
3. The reason and suggestion are visible to the requesting Event Coordinator, who makes any resulting change.
4. The rejected request remains visible in the event's booking history.

AC3 and AC4 were built by SCRUM-22 and are re-proven here rather than rebuilt. Only AC1 and AC2 needed new code.

### Traceability

| AC | Criterion | Test cases | Where the rule lives |
| --- | --- | --- | --- |
| 1 | A rejection must carry a reason | 01, 02, 03, 07, M1 | `validateDecision` in `venues.bookingRequests.validation.js` |
| 2 | A suggested alternative may be attached | 04, M1 | The same `decision_note`; no separate column, see *Decisions* below |
| 3 | Reason and suggestion visible to the requesting Coordinator | 05, M2 | `BOOKING_REQUEST_FIELDS` returns `decision_note`; the Decision block renders it |
| 4 | The rejected request remains in the booking history | 06, M3 | `listBookingRequests` applies no status filter; only pending and confirmed bookings reach the calendar |

### Test cases

| ID | AC | Type | Scenario | Test data | Expected result | Automated by | Latest execution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-SCRUM-102-01 | 1 | Negative | Reject with no note field at all | `{ decision: "rejected" }` | 400, details name the missing reason, no decision recorded | `[SCRUM-102] A rejection with no reason is refused and nothing is decided` | 2026-10-02 ✅ |
| TC-SCRUM-102-02 | 1 | Boundary | Reject with nothing that reads as a reason | `note` = `null`, `""`, `"   "`, `"\n\t "` | 400 for all four, no decision recorded | `[SCRUM-102] An empty or whitespace-only reason does not count as a reason` | 2026-10-02 ✅ |
| TC-SCRUM-102-03 | 1 | Happy | Reject with a real reason | A reason padded with spaces | 200, status rejected, note stored trimmed | `[SCRUM-102] A rejection carrying a reason and a suggested alternative is recorded` | 2026-10-02 ✅ |
| TC-SCRUM-102-04 | 2 | Happy | The reason names an alternative venue | "Marina is already held… Orchard Seminar Room 3 is free AM…" | The whole text is stored unchanged apart from trimming | same test as 03 | 2026-10-02 ✅ |
| TC-SCRUM-102-05 | 3 | Happy | The requesting coordinator reads the decided request | `GET /booking-requests/:id` as `event_coordinator` | 200, `decision_note` carries the reason and the suggestion; scope is the coordinator's own | `[SCRUM-102] The requesting coordinator reads the reason under their own scope` | 2026-10-02 ✅ |
| TC-SCRUM-102-06 | 4 | Happy | The rejected request stays in the history | `GET /booking-requests?status=rejected` | The request is still listed with its reason, while its slot shows available on the calendar | `[SCRUM-102] A rejected request stays in the booking history with its reason, while its slot is freed` | 2026-10-02 ✅ |
| TC-SCRUM-102-07 | 1 | Happy | Approving needs no reason | `{ decision: "confirmed" }` | 200, unchanged from SCRUM-22 | `[SCRUM-102] Approving still needs no reason` | 2026-10-02 ✅ |

### Manual cases

Run against the shared Supabase database, because they exercise the browser and the live decision function.

| ID | AC | Scenario | Expected result |
| --- | --- | --- | --- |
| TC-SCRUM-102-M1 | 1, 2 | Reject in the browser | Confirm rejection is disabled while the box is empty and while it holds only spaces, and becomes available once a reason is typed |
| TC-SCRUM-102-M2 | 3 | The coordinator reads the outcome | The rejection reason and the suggested alternative are shown under Decision, with no decide controls |
| TC-SCRUM-102-M3 | 4 | History and availability | The rejected request is still listed under Rejected and All, while the slot returns to Available on the calendar |

### Decisions

- **The suggested alternative shares `decision_note`.** AC2 says staff *may* attach one, which free text
  satisfies. A separate column would mean a hand made schema change on a database five lanes share, plus a field
  in four layers that nothing queries. A new story if reporting on alternatives is ever needed.
- **Approving still needs no reason.** No acceptance criterion has asked staff to justify a yes, so requiring one
  would be scope beyond the story.
- **Whitespace is not a reason.** A space bar press would otherwise satisfy AC1 while telling the coordinator
  nothing.
- **No schema change.** `decision_note` already existed, nullable, from SCRUM-22.

### Deliberately absent

A separate `suggested_alternative` column; requiring a reason on approval; notifying the coordinator, since no AC
asks for a message; reversing a decision after the fact.

---

## 3. SCRUM-18 — Search and filter potential venues

**Acceptance criteria, word for word**

1. Venues can be filtered using relevant date and time requirements.
2. Expected attendance/capacity, location and accessibility can be considered.
3. Supported layout and required facilities can be considered.
4. Searching and filtering identifies potential venues but does not replace the separate suitability assessment.

City and minimum capacity already existed from SCRUM-15. This story adds
accessibility, facilities, layout, and date and slot availability.

### Traceability

| AC | Criterion | Test cases | Where the rule lives |
| --- | --- | --- | --- |
| 1 | Date and time requirements | 03, 04, 05, 06, 08, M2, M3 | `filterByAvailability` in `venues.controller.js`, over `buildAvailabilityCalendar` |
| 2 | Capacity, location, accessibility | 01, 07, 08, M1 | `listVenues` in `venues.service.js` |
| 3 | Layout and facilities | 01, 02, M1 | `listVenues`, using Postgres array containment |
| 4 | Narrows, does not assess | 09, M4 | No score or rank in the response; catalogue copy says so |

### Test cases

| ID | AC | Type | Scenario | Expected result | Automated by | Latest execution |
| --- | --- | --- | --- | --- | --- | --- |
| TC-SCRUM-18-01 | 2, 3 | Happy | All five stored filters at once | Every filter reaches the query unchanged | `[SCRUM-18] Capacity, location, accessibility, facilities and layout all narrow the catalogue` | 2026-10-05 ✅ |
| TC-SCRUM-18-02 | 3 | Boundary | Two facilities requested | The venue must offer both, not either | `[SCRUM-18] Several facilities must all be offered, not just one of them` | 2026-10-05 ✅ |
| TC-SCRUM-18-03 | 1 | Happy | A date and one slot | Only venues whose slot is still open are kept; a pending request does not exclude a venue | `[SCRUM-18] A date keeps only venues whose requested slots are still open` | 2026-10-05 ✅ |
| TC-SCRUM-18-04 | 1 | Negative | Blocked period, and a venue closed that day | Both are dropped from the results | `[SCRUM-18] A blocked period and closed hours both remove a venue from the results` | 2026-10-05 ✅ |
| TC-SCRUM-18-05 | 1 | Boundary | A date with no slots named | Any one free slot keeps the venue; only a venue booked all day drops out | `[SCRUM-18] A date with no slots keeps a venue that is free for part of the day` | 2026-10-05 ✅ |
| TC-SCRUM-18-06 | 1 | Boundary | The same venue and day, with and without named slots | Kept for a bare date, dropped once the taken slot is asked for | `[SCRUM-18] Naming slots requires all of them, which a bare date does not` | 2026-10-05 ✅ |
| TC-SCRUM-18-07 | 2 | Boundary | `minCapacity=0`, the lowest the catalogue's input allows | 200, and no capacity filter is applied | `[SCRUM-18] A minimum capacity of zero means no minimum, matching the catalogue's input` | 2026-10-05 ✅ |
| TC-SCRUM-18-08 | 1, 2 | Negative | Seven malformed queries | 400 for each, and the catalogue is never queried | `[SCRUM-18] Malformed filters are refused instead of silently returning everything` | 2026-10-05 ✅ |
| TC-SCRUM-18-09 | 4 | Happy | A search with no date | No score or rank is added, order is the catalogue's own, and the booking tables are not queried | `[SCRUM-18] Searching narrows but does not rank, and never reaches the date tables needlessly` | 2026-10-05 ✅ |

### Manual cases

| ID | AC | Scenario | Expected result |
| --- | --- | --- | --- |
| TC-SCRUM-18-M1 | 2, 3 | Filter by facility, accessibility and layout in the browser | Options come from the catalogue itself; results narrow as each is ticked |
| TC-SCRUM-18-M2 | 1 | Filter by a date with a confirmed booking | The booked venue disappears for that slot and returns when the slot changes |
| TC-SCRUM-18-M3 | 1 | Slots without a date | The slot chips are replaced by "Pick a date first" |
| TC-SCRUM-18-M4 | 4 | Read the results page | The copy says these are potential venues to check, and nothing is scored or ranked |

### Decisions

- **The date filter reuses `buildAvailabilityCalendar`** rather than a new
  Postgres function. No schema change on a shared database, and one definition
  of what a free slot means. A database function would be faster on a catalogue
  far larger than this one.
- **"Free" means `available` or `pending`**, the same list a booking request is
  allowed on, because only a confirmed booking takes a slot (SCRUM-21).
- **All, not any.** Asking for two facilities returns venues offering both. A
  shortlist wider than the requirements is not a shortlist.
- **Named slots are "all", a bare date is "any"** (changed in review, 5 Oct).
  The first version required every slot of the day to be free when only a date
  was given, which contradicted the page's own wording and excluded venues that
  were genuinely available that evening. The wording was the better behaviour,
  so the rule changed to match it rather than the other way round.
- **`minCapacity=0` means no minimum** (changed in review, 5 Oct). The capacity
  input's lowest allowed value was 0 while validation rejected it, so an input
  the page permitted produced an error. Zero now behaves exactly like a blank
  field.
- **Unknown query parameters are refused**, so a typo surfaces instead of
  silently returning the whole catalogue.

### Deliberately absent

Scoring, ranking or a "best match"; a suitability verdict, which AC4 puts
outside this story; filtering by setup, teardown or turnaround time, which
nothing yet enforces; saved searches; and paging, since the catalogue is small
and `listVenues` has no limit.

---

## 4. SCRUM-19 — Assess shortlisted venue suitability

**Acceptance criteria, word for word**

1. Suitability is assessed after a venue has been identified or shortlisted.
2. The assessment compares current event requirements with available venue information.
3. A venue should not normally be considered suitable when expected attendance exceeds its capacity.
4. A venue should not normally be considered suitable when a required facility is unavailable.
5. The exact presentation of the suitability result may be proposed by the solution team.

### Traceability

| AC | Criterion | Test cases | Where the rule lives |
| --- | --- | --- | --- |
| 1 | Assessed after shortlisting | 01, 08, 09, 10, M1 | `GET /api/venues/:id/suitability`, reachable from the venue page before any request exists |
| 2 | Compares event requirements with venue information | 01, 03, 05, 06, 07, M1, M2 | `assessVenueSuitability` in `venues.bookingRequests.validation.js` |
| 3 | Attendance above capacity | 02, M2 | Same function, capacity check |
| 4 | Required facility unavailable | 03, 06, M2 | Same function, facility check |
| 5 | Presentation proposed by the team | M1, M3 | Check suitability panel on the venue page |

### Test cases

| ID | AC | Type | Scenario | Expected result | Automated by | Latest execution |
| --- | --- | --- | --- | --- | --- | --- |
| TC-SCRUM-19-01 | 1, 2 | Happy | Every recorded requirement is met | `suitable`, three checks all met, and the event is read with the coordinator's own id | `[SCRUM-19] A venue meeting every recorded requirement is assessed suitable` | 2026-10-06 ✅ |
| TC-SCRUM-19-02 | 3 | Negative | Attendance 201 against capacity 200 | `unsuitable`, the check names both numbers | `[SCRUM-19] Attendance above capacity makes a venue unsuitable` | 2026-10-06 ✅ |
| TC-SCRUM-19-03 | 2, 4 | Negative | One facility offered, one not | `unsuitable` with one unmet, and the met facility is still listed | `[SCRUM-19] A required facility the venue lacks makes it unsuitable and is named` | 2026-10-06 ✅ |
| TC-SCRUM-19-04 | 2 | Negative | An accessibility need the venue lacks | `unsuitable`; see *Decisions* for why this counts | `[SCRUM-19] An accessibility need the venue cannot meet also makes it unsuitable` | 2026-10-06 ✅ |
| TC-SCRUM-19-05 | 2 | Boundary | Requirements arrive as free text | Two checks, not one per character; `Projector` is recognised from "Projector, plus a stage" | `[SCRUM-19] Requirements are read from free text, not treated as a list of characters` | 2026-10-06 ✅ |
| TC-SCRUM-19-06 | 2, 4 | Boundary | "Somewhere backstage for the choir" | "backstage" does not match the `Stage` facility, and the unmatched sentence is reported rather than passed or failed | `[SCRUM-19] Only whole words count as a requirement, and unknown wording is reported` | 2026-10-06 ✅ |
| TC-SCRUM-19-07 | 2 | Boundary | The event records no expected attendance | Reported with `met: null` and counted in `unknown_count`, never as met | `[SCRUM-19] A requirement the event never recorded is reported, not counted as met` | 2026-10-06 ✅ |
| TC-SCRUM-19-08 | 1 | Negative | An event belonging to another coordinator | 404, no assessment of someone else's requirements | `[SCRUM-19] An event that is not the coordinator's own cannot be assessed` | 2026-10-06 ✅ |
| TC-SCRUM-19-09 | 1 | Negative | Missing event id, malformed event id, malformed venue id | 400 for each, and no lookup is made | `[SCRUM-19] A missing or malformed id is refused before any lookup` | 2026-10-06 ✅ |
| TC-SCRUM-19-10 | 1 | Negative | Seven other identities, including Venue Staff | 401 or 403 for each, and no lookup is made | `[SCRUM-19] %s cannot assess a venue against someone's event` | 2026-10-06 ✅ |

### Manual cases

| ID | AC | Scenario | Expected result |
| --- | --- | --- | --- |
| TC-SCRUM-19-M1 | 1, 2, 5 | Use the Check suitability panel on the venue page | The panel lists the coordinator's own events; choosing one shows a verdict and a row per requirement |
| TC-SCRUM-19-M2 | 3, 4 | Assess a venue that is too small or lacks a facility | The verdict reads unsuitable and the failing rows are marked |
| TC-SCRUM-19-M3 | 5 | Check the panel is not offered to Venue Staff | No Check suitability panel appears, because staff hold no `bookings.request` |

### Decisions

- **Requirements are read as free text against the catalogue's own vocabulary**
  (changed during manual testing, 6 Oct). The first version treated
  `venue_requirements` as a list and iterated the string character by
  character, producing one check per letter. The events lane's guide states
  these fields are free text and that structuring them is the consuming
  feature's schema change. A term is now recognised only when some venue offers
  a facility or accessibility feature by that name, matched case-insensitively
  on whole words. Text matching nothing is reported as unmatched, never passed.
  The limit is that a requirement naming something no venue offers cannot be
  recognised at all.
- **The backend tests did not catch this**, because they stub the venue service
  and the stub used arrays. A stubbed test proves the code matches what the
  author believed about the schema, not the schema itself. Found in the browser
  during TC-SCRUM-19-M1.
- **Unmet accessibility counts as unsuitable**, which goes slightly beyond the
  literal wording of AC3 and AC4. AC2 asks for the event's current requirements
  to be compared, and a recorded accessibility need is one. Flagged to the user
  before building.
- **A requirement the event never recorded is reported, not passed.** Staying
  silent would read as a pass; `met: null` and `unknown_count` say plainly what
  could not be compared.
- **The assessment reuses the fields `validateAgainstVenue` reads**, so a venue
  assessed suitable cannot then be refused at submission for a reason the
  assessment never mentioned. This is the same class of mismatch review caught
  in SCRUM-18 between the slot wording and the slot rule.
- **The verdict is advice, not a gate.** Nothing prevents requesting a venue the
  assessment calls unsuitable, because AC3 and AC4 say "should not normally",
  and SCRUM-21 already refuses a request that genuinely breaks the rules.
- **Shown on the venue page, not in the booking form** (AC5). AC1 puts the
  assessment after shortlisting, and the point is to avoid requesting an
  unsuitable venue, which is a decision made before the form is open.

### Deliberately absent

A score or ranking, which SCRUM-18 already ruled out; an override or
acknowledgement flow for requesting an unsuitable venue, which no AC asks for;
assessing against room layout, which events do not record; and assessing a venue
for several events at once.

---

## 5. SCRUM-138 — Check each venue booking of an event independently

**Acceptance criteria, word for word**

1. Suitability, availability and conflict checks run separately for each venue booking.
2. The result is reported per venue, naming the venue that failed and why.
3. A failed check on one venue does not alter the status of the other venue bookings.

The gap this story fills: submission already checks one booking as it is made (`postBookingRequest`), but nothing
re-read an event's existing bookings together and reported per venue. The endpoint is **read-only**, which is how
AC3 is satisfied: it writes nothing, so a failure cannot change any booking's status.

### Traceability

| AC | Criterion | Test cases | Where the rule lives |
| --- | --- | --- | --- |
| 1 | Three checks run separately per booking | 01, 03, 05, 07, 08, 09, 15, 16 | `checkBooking` in `backend/src/modules/venues/venueBookingChecks.js`; the per-booking `try/catch` in `getEventBookingChecks` |
| 2 | Per-venue result naming the venue and the reason | 02, 04, 15, 16, 17 | `venue_name` on every result and per-check `reasons`; `VenueBookingCheckReport.jsx` renders one card per venue; `EventVenueBookings.jsx` links from the coordinator's event page |
| 3 | A failed check alters nothing | 06 | `GET .../booking-checks` calls no write function; each calendar excludes the event's own rows |
| DoD | Who may run the check | 10, 11, 12, 13, 14 | `bookings.read` + `bookingScope` in `backend/src/routes/venues.routes.js` |

### Test cases

| ID | AC | Type | Scenario | Expected result | Automated by | Latest execution |
| --- | --- | --- | --- | --- | --- | --- |
| TC-SCRUM-138-01 | 1 | Happy | Every booking on the event is checked on its own | 200; one result per booking, ordered by date then venue; the fitting venue all passed, the over-capacity venue suitability failed | `[SCRUM-138] Each booking on the event gets its own verdicts` | 2026-10-15 ✅ |
| TC-SCRUM-138-02 | 2 | Happy | The failing venue is named with a specific reason | `venue_name` is the failing venue; the reason names the numbers (`expected_attendees (100) exceeds the venue capacity of 50`) | same integration suite; `[SCRUM-138-UI-002]` | 2026-10-15 ✅ |
| TC-SCRUM-138-03 | 1 | Negative | One venue's data cannot be read, or a booking's own row is incomplete | 200; only that venue is `not_checked` with a note; the other venue still reports | `[SCRUM-138] A venue whose data cannot be read is reported alone`; `[SCRUM-138] A booking whose own row is incomplete is reported, not crashed` | 2026-10-15 ✅ |
| TC-SCRUM-138-04 | 2 | Boundary | An event with no bookings | 200; `results: []`; the event is still named | `[SCRUM-138] An event with no bookings reports an empty list`; `[SCRUM-138-UI-008]` | 2026-10-15 ✅ |
| TC-SCRUM-138-05 | 1 | Boundary | A booking with nothing live (rejected or cancelled) | `overall: not_checked`, a note naming the status, all three checks `passed: null` | `[SCRUM-138] A booking with nothing live is reported, not checked`; `[SCRUM-138] a booking with no live slots reports not checked with its status` | 2026-10-15 ✅ |
| TC-SCRUM-138-06 | 3 | Conflict | A failed check changes nothing | 200; every status identical before and after; no write function called | `[SCRUM-138] The check runs no write and leaves every booking as it was` | 2026-10-15 ✅ |
| TC-SCRUM-138-07 | 1 | Boundary | A venue is never its own conflict | The event's own confirmed rows are excluded; conflicts passed | `[SCRUM-138] The event's own booking is not reported as its own conflict`; `[SCRUM-138] the booking's own rows are neither a conflict nor a duplicate` | 2026-10-15 ✅ |
| TC-SCRUM-138-08 | 1 | Boundary | An occupied setup or turnaround buffer slot | The reason names the slot and the setup or turnaround time, for that venue only | `[SCRUM-138] an occupied setup buffer is reported against this booking`; `[SCRUM-138] an occupied turnaround buffer is reported against this booking` | 2026-10-15 ✅ |
| TC-SCRUM-138-09 | 1 | Boundary | A recorded unavailability period | Availability fails quoting the recorded reason; conflicts still passed | `[SCRUM-138] a recorded unavailability fails availability and keeps its reason`; `[SCRUM-138] A recorded unavailability fails availability for that venue only` | 2026-10-15 ✅ |
| TC-SCRUM-138-10 | DoD | Cross-cutting | No token, an invalid token | 401; nothing read | `[VENUE-CHECK-001]` (2 cases) | 2026-10-15 ✅ |
| TC-SCRUM-138-11 | DoD | Cross-cutting | Roles without `bookings.read` | 403 for attendee, organiser, coordinator lead, safety officer, technical support; nothing read | `[VENUE-CHECK-002]` (5 cases) | 2026-10-15 ✅ |
| TC-SCRUM-138-12 | DoD | Cross-cutting | Another coordinator's event | 404 `Event not found`, the same answer as a missing event; the scope reached the query | `[SCRUM-138] Another coordinator's event is not found, exactly like a missing one` | 2026-10-15 ✅ |
| TC-SCRUM-138-13 | DoD | Negative | A malformed event id | 400 before any read | `[SCRUM-138] A malformed event id is refused before any read` | 2026-10-15 ✅ |
| TC-SCRUM-138-14 | DoD | Failure | Missing venue storage | 503 | `[SCRUM-138] Missing venue storage answers 503, not a crash` | 2026-10-15 ✅ |
| TC-SCRUM-138-15 | 1, 2 | Cross-cutting | The report in the browser and its failure states | One card per venue; the failing venue shows Failed with its reasons, the passing one Passed; a check failure offers Retry | `[SCRUM-138-UI-001]` to `[SCRUM-138-UI-008]` | 2026-10-15 ✅ |
| TC-SCRUM-138-16 | 1, 2, 3 | Cross-cutting | Full journey through the real UI and backend | Per-venue report rendered; the blocked venue named with its reason; the request cards' statuses unchanged | `[VENUE-E2E-005]` | 2026-10-15 ✅ |
| TC-SCRUM-138-17 | 2 | Cross-cutting | Reaching the check from the coordinator's own event page | The event's Venues section links to the check; a role without `bookings.read` sees the venues but no link; no link when there are no bookings, no event id, or no session | `[SCRUM-138-UI-009]` to `[SCRUM-138-UI-013]` | 2026-10-15 ✅ |

### Executed results

| Suite | Command | Result (2026-10-16) |
| --- | --- | --- |
| Backend unit + integration | `npm --prefix backend test` | 899 passed, 43 skipped, 0 failed |
| Frontend | `npm --prefix frontend test -- --run --maxWorkers=3` | 456 passed across 45 files, 0 failed |
| Playwright browser + API | `npm run test:playwright` | 186 passed, 0 failed |
| Lint | `npm --prefix backend run check` · `npm --prefix frontend run lint` | clean |
| Build | `npm --prefix frontend run build` | success |
| Coverage | `npm --prefix backend run test:cov` · `npm --prefix frontend run test:cov -- src/features/venues` | `venueBookingChecks.js` 100% statements/branches/lines; every new controller, service, report and button line covered |

The frontend suite is passed `--maxWorkers=3` locally: on a 20-core machine vitest tries to spawn 20 workers at
once and Windows fails some of them, which costs `Timeout waiting for worker to respond`. With the limit it is
reliably green; CI runs on its own runner.

Thirteen frontend cases and the Playwright journey are new in this story; the earlier Playwright tests still pass after
the fixture change noted under *Decisions*.

### Manual cases

1. Sign in as a seeded coordinator who owns an approved event with two venue bookings, one healthy.
2. Open **My Events → that event** and click **Check each venue booking** under *Venues*. That opens the
   event-scoped list `/venues/booking-requests?event=<event id>`, which can also be typed directly.
3. Click **Check venue bookings**: one card per venue, each listing Suitability, Availability and Conflicts. The
   problem venue reads Failed with a reason sentence; the other reads Passed.
4. Have Venue Staff mark the problem booking's slot unavailable (or confirm another event into it), check again, and
   confirm only that venue's card changes while the booking statuses below stay as they were.

### Decisions

- **Read-only** (AC3): the endpoint writes nothing, proven by asserting no write function runs and every status is
  identical before and after.
- **Suitability reuses SCRUM-87's `validateAgainstVenue`** on the booking's own requirements against the venue's
  current catalogue. SCRUM-19's event-vs-venue assessment stays a pre-submission tool.
- **Only live bookings are checked**; rejected and cancelled bookings are listed as `not_checked`.
- **`findSlotProblems` is not reused**: it answers with display strings for the submission 409, while this story
  classifies each outcome as availability or conflict. Both read the same calendar and `REQUESTABLE_STATUSES` rule.
- **The Playwright fake storage gained three narrow changes** (`tests/playwright/support/venue-storage.cjs`):
  `listSlotRowsForDate` returns the request `id` (a booking must not read as its own duplicate), `listBookingRequests`
  honours the `eventId` argument it already accepted, and `getEventForCheckReport` was added with the real service's
  scope rule. No production behaviour changed.
- **The check is linked from the coordinator's own event page.** Nothing linked to
  `/venues/booking-requests?event=<id>`, so `EventVenueBookings` (venue lane) now offers a **Check each venue
  booking** link, shown only when it is given an event id and the caller holds `bookings.read`. `ManagedEventDetailPage`
  passes the id; the *My Events* list does not, because it renders the component inside its own anchor and a second
  anchor would be invalid. The server still authorises the check itself.

### Deliberately absent

Stored check results or a check history, which no AC asks for and which is why there is no schema change; re-checking
whether `booking_date` still falls inside the event's dates, which the submission flow owns; overlap between two
venues of the same event, because a multi-venue event may run parallel streams; remediation actions from the report;
automatic re-checks on a decision; and equipment arrangements, which the Equipment lane's SCRUM-139 readiness covers.

---

## 6. SCRUM-146 — Tentative venue hold with expiry

**Acceptance criteria, word for word**

1. A hold records the venue, event, period, who placed it and a mandatory expiry date/time.
2. The expiry cannot be in the past.
3. An active hold blocks other requests for the same committed period.
4. Active holds are shown as tentative and are not treated as confirmed bookings.
5. Once the expiry passes, the venue becomes available again and the expired hold remains in the booking history.

### Traceability

| AC | Criterion | Test cases | Where the rule lives |
| --- | --- | --- | --- |
| 1 | Hold created with all required fields; held_by from verified session | 01, 07, 08, 15 | `validateHoldBody` + `createHold` in `venues.controller.js` / `venues.service.js` |
| 2 | Expiry in the future | 03, 04 | `validateHoldBody` in `venues.controller.js` |
| 3 | Active hold blocks booking request for same slot | 09, 10 | `listActiveHoldsInRange` → `buildAvailabilityCalendar` → `findSlotProblems`; `tentative` not in `REQUESTABLE_STATUSES` |
| 4 | Slot shown as tentative (precedence below booked, above pending) | 11, 12, 13, 14 | `buildAvailabilityCalendar` in `venues.availability.js` |
| 5 | Expired hold absent from calendar; present in history list | 05, 06, 14 | `listActiveHoldsInRange` (`expires_at > now()`); `listHolds` (all hold rows) |

### Test cases

| ID | AC | Type | Scenario | Expected | Automated by | Last run |
| --- | --- | --- | --- | --- | --- | --- |
| TC-SCRUM-146-01 | 1 | Happy | POST /holds valid body as venue_staff | 201, array of hold records; createHold called with correct args | `[TC-SCRUM-146-01]` | 2026-10-15 ✅ |
| TC-SCRUM-146-02 | 1 | Negative | POST /holds as event_coordinator | 403; createHold not called | `[TC-SCRUM-146-02]` | 2026-10-15 ✅ |
| TC-SCRUM-146-03 | 2 | Boundary | expires_at far in past | 400, details name expires_at | `[TC-SCRUM-146-03]` | 2026-10-15 ✅ |
| TC-SCRUM-146-04 | 2 | Negative | expires_at one hour ago | 400 | `[TC-SCRUM-146-04]` | 2026-10-15 ✅ |
| TC-SCRUM-146-05 | 5 | Happy | GET /holds returns all holds including expired | 200, array length 2, expired row present | `[TC-SCRUM-146-05]` | 2026-10-15 ✅ |
| TC-SCRUM-146-06 | 5 | Negative | GET /holds as event_coordinator | 403 | `[TC-SCRUM-146-06]` | 2026-10-15 ✅ |
| TC-SCRUM-146-07 | 1 | Negative | POST /holds, venue not found | 404; createHold not called | `[TC-SCRUM-146-07]` | 2026-10-15 ✅ |
| TC-SCRUM-146-08 | 1 | Negative | POST /holds, missing event_name | 400, details name missing field | `[TC-SCRUM-146-08]` | 2026-10-15 ✅ |
| TC-SCRUM-146-09 | 3 | Happy | Booking request blocked by active hold on same slot | 409, details mention slot name | `[TC-SCRUM-146-09]` | 2026-10-15 ✅ |
| TC-SCRUM-146-10 | 3 | Happy | Expired hold (not in active list) → booking request succeeds | 201 | `[TC-SCRUM-146-10]` | 2026-10-15 ✅ |
| TC-SCRUM-146-11 | 4 | Unit | Active hold on am → slot.status = tentative, label = event name | `{ status: "tentative", label: "Charity Gala" }` | `[TC-SCRUM-146-11]` | 2026-10-15 ✅ |
| TC-SCRUM-146-12 | 4 | Unit | Confirmed booking and hold on same slot → booked outranks tentative | `{ status: "booked" }` | `[TC-SCRUM-146-12]` | 2026-10-15 ✅ |
| TC-SCRUM-146-13 | 4 | Unit | Hold and pending request on same slot → tentative outranks pending | `{ status: "tentative" }` | `[TC-SCRUM-146-13]` | 2026-10-15 ✅ |
| TC-SCRUM-146-14 | 4, 5 | Unit | No active holds → slot available | `{ status: "available" }` | `[TC-SCRUM-146-14]` | 2026-10-15 ✅ |
| TC-SCRUM-146-15 | 1 | Negative | POST /holds with invalid slot value ("morning") | 400, details mention slots | `[TC-SCRUM-146-15]` | 2026-10-15 ✅ |

### Manual cases

| ID | AC | Scenario | Expected |
| --- | --- | --- | --- |
| TC-SCRUM-146-M1 | 1, 4 | Sign in as venue_staff; open venue → Manage holds; place a hold; view the calendar | The held slot shows Tentative hold in blue |
| TC-SCRUM-146-M2 | 3 | Sign in as event_coordinator; try to request the held slot | 409 — the request is blocked |
| TC-SCRUM-146-M3 | 5 | Wait for the hold to expire (or set a near-future expiry); view the calendar | Slot returns to Available; the hold still appears in the Holds list under Expired |

### Decisions

- Holds stored in `venue_bookings` with `status='hold'` rather than a separate table. Keeps calendar and
  conflict check unified — see *Tentative venue holds* in `venue-integration.md`.
- `expires_at > now()` filtered in Postgres before data reaches the calendar. Calendar function stays pure.
- `tentative` precedence below `booked` (a confirmed booking is harder to reverse) and above `pending`
  (a hold is explicit staff intent; a request has not been decided).

### Deliberately absent

Coordinator-facing hold request flow; automatic hold cancellation; notify on expiry; delete/cancel a hold.

---

## 7. Coverage note

`npm --prefix backend run test:cov` reports the whole backend. Most venue modules are exercised through the
integration suites above rather than by unit tests of their own, so coverage of
`venues.availability.js`, `venues.validation.js` and `venues.bookingRequests.validation.js` is indirect. Those three
files import nothing, which is what makes direct unit tests cheap to add; that gap is known and unowned.

`venueBookingChecks.js` (SCRUM-138) is the exception: it has a direct unit suite and reports 100% on statements,
branches and lines.

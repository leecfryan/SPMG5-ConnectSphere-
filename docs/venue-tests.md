# Venue — Test Documentation

Test evidence for the Venue lane (epic SCRUM-6). Behaviour, API and the schema reference live in
[Venue integration](venue-integration.md); this file is the catalogue of what is tested and where.

**52 automated backend tests across three suites, all passing**, plus manual cases run against the shared Supabase
database and recorded in the team's TESTS sheet.

| Suite | File | Tests |
| --- | --- | --- |
| Decisions | `backend/tests/integration/venueDecisions.test.js` | 22 |
| Catalogue, calendar, requests | `backend/tests/integration/venues.integration.test.js` | 26 |
| Storage and query scope | `backend/tests/integration/venues.storage.test.js` | 4 |
| Browser journeys | `tests/playwright/venues.browser.spec.cjs` | 6 |

Run everything:

```bash
npm --prefix backend test                # all three backend suites
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
| SCRUM-20 | Block conflicting venue booking | `[SCRUM-20]` | TC-167 to TC-175 |
| SCRUM-102 | Reject with a reason and suggested alternative | `[SCRUM-102]` | TC-220 to TC-229 |

Cross-cutting guards that apply to every story: `[VENUE-AUTH-001]` (seven identities against eight endpoints),
`[VENUE-AUTH-002]`, `[VENUE-INPUT-001]` (forged ownership and role fields), `[VENUE-CONFIG-001]` (missing venue
storage leaves sign-in working), `[VENUE-DB-001]` to `[VENUE-DB-004]`, and `[ACCESS-VENUE-001/002]` from the RBAC
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

## 3. Coverage note

`npm --prefix backend run test:cov` reports the whole backend. The venue modules are exercised through the three
integration suites above rather than by unit tests of their own, so coverage of
`venues.availability.js`, `venues.validation.js` and `venues.bookingRequests.validation.js` is indirect. Those three
files import nothing, which is what makes direct unit tests cheap to add; that gap is known and unowned.

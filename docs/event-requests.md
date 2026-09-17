# Event Requests

**The events module: what it builds, what it does not, and what the other lanes
need from it.**
Epic SCRUM-7 · Branch `feature/eventRequest` · Written 17 Sep

This document is written for two readers: the merger dev, who integrates this
branch and did not write it, and the Venue, Equipment and Registration lanes,
who read the `events` table and need its contract in writing rather than by
asking. Everything below reflects the code on this branch, not a plan for it.

> **Sections 2 and 3 are proposals.** Where a rule below is ours rather than the
> customer's, it is labelled. Clarification #82 left the mandatory-field set to
> us, so most of the validation contract is **an implementation decision for
> team review, not a complete customer specification.**

---

## 1. Current scope

### Built and green

| | |
| --- | --- |
| `POST /api/events` | Creates an event request and stores it as `SUBMITTED` in one call |
| Server-side validation | Every field problem returned at once, each named by field |
| `events.validation.js` | `validateForSubmission` — the submission gate |
| `events.service.js` | Normalisation: trim, blank → `null`, date parse to ISO, integer attendance |
| `events.repository.js` | `createSubmitted` — writes through an explicit column list |
| Frontend | `EventRequestForm` + `eventsService.js`, mounted directly in `App.jsx` |
| Tests | 64 automated cases at unit, service and HTTP layers — see §5 |

This covers **SCRUM-23** (Create event request, criteria SCRUM-44/45/46/47) and
**SCRUM-25** (Submit event request, criteria SCRUM-49/50/51).

### Not built

| | Why |
| --- | --- |
| Drafts — *save and continue later* | US-13, out of phase one. **Not in Jira at all yet.** See §2 D1 |
| `validateDraft` | Implemented and unit-tested, **called by nothing.** It waits for US-13 — its existence is not evidence that drafts work |
| `events.status.js` | A `DRAFT → SUBMITTED` lifecycle module nothing imports. Deliberately kept out of the tree so nobody builds on a lifecycle that does not exist |
| Coordinator assignment | SCRUM-26, next sprint. `assignCoordinator` and `findSubmittedUnassigned` exist in the repository but have **no callers and no tests** — treat them as a sketch |
| `GET /api/events` | Absorbed from the Registration lane's stub, not yet written here. See §3 |
| `GET /api/events/:id` | Dropped for good — Registration built it |
| Frontend component tests | Vitest + RTL not installed on this branch |
| End-to-end tests | Playwright needs the merged app |

### What this implementation does **not** make safe

Read this before mounting the module anywhere real.

1. **The routes are unguarded.** `POST /api/events` has no `requireAuth` and no
   `requirePermission`. Anyone who can reach the server can create a request. The
   guards belong to the Access lane and were deliberately not reimplemented here.
2. **`organiser_id` is a hardcoded constant.** `events.controller.js` sets
   `DEV_ORGANISER_ID = "00000000-0000-0000-0000-000000000001"` behind a `TODO`.
   The column is `NOT NULL`, which is the only reason a placeholder exists. Once
   `requireAuth` is mounted, delete it and read `req.user.id` — **never from the
   request body.**
3. **The frontend sends no token.** The moment the route is authenticated, every
   submission 401s until the session token is attached.
4. **Nothing enforces ownership.** There is no read endpoint here yet, so there
   is nothing to leak — but the first `GET` added without a role scope exposes
   every organiser's unapproved requests. See the `visibleStatuses` note in §3.
5. **The `CHECK` constraint on `events.status` is unverified.** It was widened or
   dropped by another lane without a migration; `APPROVED` is in use. If it was
   dropped, nothing stops a typo becoming a status. See §4.
6. **The character caps are input safeguards, not security.** `express.json()`
   here has no explicit limit; the merged `createApp` sets `16kb`. Six textareas
   at 2000 characters is roughly 12KB — under, but not comfortably.

---

## 2. The agreed decisions

**These are implementation decisions for team review, not customer
specifications.** Each names what the customer actually said and where our
proposal begins. Record outcomes on the Jira cards.

### D1. One action: the form submits straight to `SUBMITTED`

**Customer:** Week 4 Project Instructions, *Event Request Creation* — organisers
"can **create and submit** event requests". SCRUM-49/50/51 require that a request
is not treated as a draft, is available for assignment, and that status reflects
submission. None of them asks for a separate submit step.

**Ours:** one **Submit request** button, `validateForSubmission`, inserted as
`status = SUBMITTED` with `submitted_at` set server-side. A row inserted as
`SUBMITTED` satisfies all three criteria.

**Contested.** The Sprint 1 mockup's primary action is *Save draft →*. That is
US-13, which is out of phase one and worth 3 SP. Building both buttons is the
worst option — half of US-13 with none of its acceptance criteria, and `DRAFT`
rows that no endpoint can move out of. **Do not silently rebuild the form to
*Save draft*:** it deletes SCRUM-25's acceptance.

### D2. Assignment does not change status

**Customer:** #42 — assignment follows submission, performed by the Event
Operations Manager. #1 — no acceptance step. #3 — the choice of coordinator
follows the Manager's own SOP, outside the system. #15 — **coordinators** review
and approve.

**Ours:** the ops manager routes, they do not review, so there is no
`UNDER_REVIEW` while a request waits for assignment, and setting `coordinator_id`
leaves `status` alone.

**The facts have since moved.** `APPROVED` is already in the live table and
already drives Registration's feature. The reasoning holds; re-state it at
standup rather than letting this document assert something the database
contradicts.

### D3. The required-field set is entirely our proposal

**Customer:** #82 — "we have not firmed out the fields as yet, do propose what is
appropriate", and explicitly no requirement on field lengths.

**Ours:** the table in §4. Both caps (200 for `name`, 2000 for text) are ours.
They exist to stop a scripted megabyte description, not to limit what an
organiser would plausibly write.

**Ours, and worth defending:** `errors` lists **every** problem, not just the
first. An organiser fixing one field at a time across six round trips is the
failure this avoids.

### D4. Optional fields are optional because the customer said "where relevant"

**Customer:** SCRUM-47 — equipment and registration needs "where relevant".

**Ours:** `venue_requirements`, `accessibility_needs`, `equipment_needs` and
`other_comments` are never required, at draft or at submission, and are stored
as free text. The Venue, Equipment and Registration features parse them later.

### D5. Free text now, structured fields later

**Ours, entirely.** `venue_requirements` is free text rather than a room-layout
dropdown, and `equipment_needs` is free text rather than a catalogue link. The
mockup draws both as dropdowns. Converting them is a schema change that belongs
with the Venue and Equipment lanes, not with this sprint.

### D6. The coordinator list comes from the Access lane

**Ours.** Users holding the coordinator role live in the Access lane's tables.
Ask them for an endpoint (`GET /api/users?role=event_coordinator`); do not query
their tables from the events module.

### D7. Who assigns — **open, blocks SCRUM-26**

#42 says the **Event Operations Manager** assigns. The Sprint 1 mockup puts
*Assignments* under the **Event Coordinator**. These cannot both be right, and
the answer decides the permission, the route guard and the sidebar entry.
**Recommendation: follow #42** — a customer clarification outranks a team
artefact — but raise it, because the mockup's author may know something the
clarification does not say.

---

## 3. Teammate integration

### The endpoint

```
POST /api/events
Content-Type: application/json
```

Mounted at `app.use("/api/events", eventsRoutes)` in `backend/src/server.js`. On
merge this mount moves inside the merged `createApp()`.

**Request body.** Every key is optional in the JSON sense — omitting a required
one produces a validation error, not a crash. Unknown keys are ignored, so adding
a column to the table does not break this endpoint.

```json
{
  "name": "Annual Alumni Homecoming",
  "purpose": "Reconnect alumni with the school and current students",
  "description": "An evening reception with a short programme and dinner.",
  "start_time": "2026-11-14T10:00:00.000Z",
  "end_time": "2026-11-14T18:00:00.000Z",
  "expected_attendance": 250,
  "venue_requirements": "Theatre-style seating, stage, AV booth",
  "accessibility_needs": "Step-free access, hearing loop",
  "equipment_needs": "2 wireless mics, projector, lectern",
  "other_comments": "Catering handled externally."
}
```

**Send timestamps as ISO 8601 with a zone.** A browser `datetime-local` input
gives `"2026-11-14T10:00"` with no zone; the server reads a zoneless string in
*its own* zone (UTC in Docker) and the event shifts by the organiser's offset.
`withZonedTimes` in `frontend/src/features/events/eventsService.js` converts in
the browser, where the organiser's zone is known. Any other client must do the
same.

**`201 Created`** — the full inserted row, the shape you will also read from the
table:

```json
{
  "event": {
    "id": "3f1c8a2e-5d47-4b9a-9c31-7e0a6d2b84f5",
    "name": "Annual Alumni Homecoming",
    "purpose": "Reconnect alumni with the school and current students",
    "description": "An evening reception with a short programme and dinner.",
    "start_time": "2026-11-14T10:00:00+00:00",
    "end_time": "2026-11-14T18:00:00+00:00",
    "expected_attendance": 250,
    "venue_requirements": "Theatre-style seating, stage, AV booth",
    "accessibility_needs": "Step-free access, hearing loop",
    "equipment_needs": "2 wireless mics, projector, lectern",
    "other_comments": "Catering handled externally.",
    "registration_fields": null,
    "status": "SUBMITTED",
    "organiser_id": "00000000-0000-0000-0000-000000000001",
    "coordinator_id": null,
    "submitted_at": "2026-09-17T04:12:55.318+00:00",
    "created_at": "2026-09-17T04:12:55.318+00:00"
  }
}
```

**`400 Bad Request`** — every problem at once, each against its own field. Field
names match the column names exactly, so a form can index its inputs by them:

```json
{
  "errors": [
    { "field": "purpose", "message": "required" },
    { "field": "start_time", "message": "must be in the future" },
    { "field": "end_time", "message": "must be after start_time" },
    { "field": "expected_attendance", "message": "must be a whole number greater than zero" }
  ]
}
```

**`500 Internal Server Error`** — one generic message. The Supabase error text is
logged, never returned:

```json
{ "error": "Could not submit the event request. Please try again." }
```

There is no `422` and no partial success. A request either inserts one complete
row or inserts nothing.

### Status values

| Status | Set by | Meaning |
| --- | --- | --- |
| `SUBMITTED` | this module, at insert | Submitted for review; awaiting coordinator assignment |
| `APPROVED` | **not by this module** | In use in the live table and driving the Registration lane |
| `DRAFT` | nothing, yet | The column default. Never written by this module — `createSubmitted` always sets `status` explicitly. It is there for US-13 |

`UNDER_REVIEW`, `REJECTED`, `CONFIRMED`, `CANCELLED` and the rest of the Week 4
status list **do not exist yet**. Do not branch on them; do not assume the set is
closed. The `CHECK` constraint's current definition is unverified (§4).

**Display labels are yours.** The mockup shows *Planning / Confirmed / Under
review*. Map stored values to labels in your own UI; do not write a label back
into the column.

### `id` format

`uuid`, generated by `gen_random_uuid()` on insert. It is the only identifier on
an event. The mockup's `EV-####` reference does not exist and should not be added
as a second column — derive a display reference from the uuid if you need one.

### Joining on `event_id`

Your table owns the foreign key; `events` holds no reference back to you. A
worked example — venue bookings for an event, and the reverse:

```sql
-- Your side owns the reference.
create table venue_bookings (
  id       uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  venue_id uuid not null,
  ...
);
```

```js
// Venue / Equipment / Registration: read the event alongside your own row.
const { data, error } = await supabase
  .from("venue_bookings")
  .select("id, venue_id, events!inner ( id, name, start_time, end_time, expected_attendance, status )")
  .eq("event_id", eventId)
  .maybeSingle();
```

```js
// The reverse: events with your rows attached. Left join — an event with no
// booking still comes back, with an empty array.
const { data, error } = await supabase
  .from("events")
  .select("id, name, start_time, end_time, status, venue_bookings ( id, venue_id )")
  .eq("status", "SUBMITTED")
  .order("submitted_at", { ascending: true });
```

**Watch the ordering.** Registration's seed rows carry `status = 'SUBMITTED'`
with `submitted_at = null`, so any query ordering by `submitted_at` puts them in
an arbitrary position. Order by `created_at` if you need a stable sequence today.

### Notes per lane

**Venue** — read `venue_requirements` and `accessibility_needs`. Both are free
text by decision (D5), both optional, both capped at 2000 characters, and both
may be `null`. There is no room-layout field and no venue foreign key on
`events`; the reference lives on your side.

**Equipment** — read `equipment_needs`. Free text, optional, may be `null`
(SCRUM-47: "where relevant"). It is deliberately not a catalogue link; parsing it
into structured requests is your lane's work, and the column is yours to propose
a replacement for.

**Registration** — read `id` and `status`. `registration_fields` is your column,
added to this table by your lane; this module neither reads nor writes it, and
writes here go through an explicit column list so it cannot be clobbered.

**Whoever adds `GET /api/events`** — this was handed over from Registration's
stub (their comment invites it). One condition, and it is the whole security
boundary for the events collection:

```js
app.get("/api/events", authenticate, async (req, res) => {
  const scope = visibleStatuses(req.user.roles);
  // attendee / organiser → ["APPROVED"];  ops manager → ["SUBMITTED"]
  // a ?status= outside `scope` is filtered out, not honoured — and not a 403
});
```

The caller's role decides what is visible; a query parameter may only narrow
within that. A route that is safe today because its filter is hard-coded to
`APPROVED` stops being safe the moment a parameter can change it — an attendee
requesting `?status=SUBMITTED` would read every organiser's unapproved requests.
`roles` is an array; handle a user holding several. This is the Access lane's own
rule: *do not trust body or query fields claiming ownership, assignment,
membership, or role.*

---

## 4. Data and ownership boundaries

### The `events` table

**Verified against live Supabase, 17 Sep.** The table exists **only in the
Supabase dashboard** — there is no migration file and no runner.

```sql
create table events (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  purpose             text,
  description         text,
  start_time          timestamptz,
  end_time            timestamptz,
  expected_attendance integer,
  venue_requirements  text,        -- free text; the venue feature reads this
  accessibility_needs text,
  equipment_needs     text,        -- free text; the equipment feature reads this
  other_comments      text,
  registration_fields jsonb,       -- ADDED BY THE REGISTRATION LANE, not by us.
                                   -- Drives their dynamic registration form.
  status              text not null default 'DRAFT',
                                   -- CHECK widened beyond ('DRAFT','SUBMITTED');
                                   -- 'APPROVED' is in use. Exact constraint unverified.
  organiser_id        uuid not null,
  coordinator_id      uuid,
  submitted_at        timestamptz,
  created_at          timestamptz not null default now()
);
```

Two things in that block are **not ours** and are recorded because four branches
read this table and would otherwise hold four different assumptions about it:

- **`registration_fields`** was added by the Registration lane with no notice and
  no migration.
- **The `status` CHECK** no longer matches `('DRAFT','SUBMITTED')`; `APPROVED` is
  in use. Whether the constraint was widened or dropped entirely is **unverified**
  — worth confirming in the dashboard, because "dropped" means nothing stops a
  typo becoming a status.

Neither change could break this module's inserts, because writes go through an
explicit column list. That is the point of the list.

### What the server controls and the client cannot

`events.repository.js` writes only the columns in `WRITABLE_COLS`:

```
name · purpose · description · start_time · end_time · expected_attendance
venue_requirements · accessibility_needs · equipment_needs · other_comments
```

Everything else is set by the server or by the database, outside that list, and
**cannot be influenced by the request body**:

| Column | Set by | Why it is not the client's |
| --- | --- | --- |
| `id` | database default | Identity is never the caller's to choose |
| `status` | `createSubmitted`, always `"SUBMITTED"` | A client that can choose its own status can bypass review |
| `submitted_at` | `createSubmitted`, server clock | A client clock is not evidence of when something happened |
| `organiser_id` | the controller, from the session | The owner of a record is never the client's to choose. Currently a placeholder constant — see §1 |
| `coordinator_id` | SCRUM-26, by the ops manager | Assignment is an authorised action, not a field |
| `created_at` | database default | |
| `registration_fields` | the Registration lane | Not read or written here |

A body key outside `WRITABLE_COLS` is silently dropped rather than rejected —
adding a column elsewhere cannot break submissions, and a client cannot smuggle
one in.

**Keep `WRITABLE_COLS` and the schema block above in step.** Change one, change
the other in the same sitting.

### The validation contract

Both validators return `{ ok, errors: [{ field, message }] }`, and `errors` lists
**every** problem. The required set is our proposal (#82 left it to us).

| Field | draft | submission | Rule |
| --- | --- | --- | --- |
| `name` | required | required | non-empty after trim, ≤ 200 |
| `purpose` | — | required | non-empty after trim, ≤ 2000 |
| `description` | — | required | non-empty after trim, ≤ 2000 |
| `start_time` | — | required | parseable, in the future |
| `end_time` | — | required | parseable, strictly after `start_time` |
| `expected_attendance` | — | required | integer > 0 |
| `venue_requirements`, `accessibility_needs`, `equipment_needs`, `other_comments` | never | never | optional free text, ≤ 2000 |

**Order of checks:** browser (`required`, `maxLength`, `min="1"` — convenience
only) → service `normalise` (trim, blank → `null`, date parse to ISO,
whole-number attendance) → `validateForSubmission`.

**One mistake yields one message.** A value `normalise` cannot read is reported
once with its parse error, and the validator's "required" for that same field is
dropped. Without that, a mistyped date would come back as both "must be a valid
date/time" and "required".

**`end_time` is only checked against `start_time`.** An end after a future start
is necessarily in the future itself; checking it twice would report one mistake
under two field names.

**Validation reads, never mutates.** Trimming and coercion for storage are the
service's job. `events.validation.js` deliberately does not import
`WRITABLE_COLS`, because the repository pulls in the Supabase client, which
throws at import time when `SUPABASE_URL` / `SUPABASE_SECRET_KEY` are unset —
and the unit tests run without them.

---

## 5. Acceptance evidence

```bash
npm --prefix backend test         # 64 tests, 0 failures
npm --prefix backend run test:cov # the same, with coverage
npm --prefix backend run check    # ESLint across src/ and tests/
npm --prefix frontend run lint
npm --prefix frontend run build
```

`docs/event-request-tests.md` is the full case-by-case record — one row per case
with pre-conditions, steps, test data, expected result, the Jira criterion it
proves, and the automated test that executes it. What follows is the summary.

### What the tests cover

| Layer | File | Covers |
| --- | --- | --- |
| Unit | `tests/unit/events/events.validation.test.js` | Both gates in isolation: required fields, caps, date ordering, attendance, optional-field handling |
| Unit | `tests/unit/events/events.service.test.js` | Normalisation: trim, blank → `null`, ISO conversion, integer coercion, and the dropped-duplicate rule |
| Unit | `tests/unit/events/events.repository.test.js` | Column mapping — that `status`, `submitted_at` and `organiser_id` are set outside `WRITABLE_COLS` and cannot be supplied by a caller |
| Integration | `tests/integration/events.submit.test.js` | The HTTP contract: 201 / 400 / 500, the error shape, and that the boundary does not move between layers |

Test names lead with their Jira key (`SCRUM-49:`, `SCRUM-45 boundary:`), so the
terminal output **is** the traceability report.

Cases are tagged by the Week 4 five-step method — happy path, negative,
boundary, cross-cutting. Two gaps are decisions rather than omissions, and are
stated as such in the test document:

- **The repository layer has no boundary cases**, because it holds no thresholds.
- **Cross-cutting auth cases land with the merge**, because there is no auth on
  this branch to test.

`US-13` is the one label in the test names that is not a Jira key — the draft
story has not been raised on the board. Relabel those tests when the issue
exists.

### Manual checks

Run these against the real Supabase before merging. The database is shared across
all four lanes: prefix your rows and delete them afterwards.

1. **Start both apps** (`docker compose up`, or `npm run dev` in each) and open
   the event request form.
2. **Submit a complete, valid request.** Expect the success view and the returned
   uuid as the reference.
3. **Confirm the row in Supabase.** `status = 'SUBMITTED'`, `submitted_at` set,
   `coordinator_id` null, `organiser_id` the `DEV_ORGANISER_ID` placeholder.
4. **Confirm the new column does not break inserts.** Registration added
   `registration_fields` without notice. Writes go through `WRITABLE_COLS`, so an
   unknown column cannot break them — verify rather than assume.
5. **Submit an empty form.** Expect every required field flagged at once, each
   message against its own input, and **no row created**.
6. **Submit with an end time before the start time.** Expect one error, on
   `end_time` only.
7. **Check the timezone conversion.** Enter a local time, submit, and confirm the
   stored `timestamptz` is the intended instant rather than being shifted by the
   organiser's UTC offset.
8. **Delete the test rows**, including any dev-era
   `organiser_id = 00000000-…0001` rows.

---

## 6. Requirements sources

Customer clarifications are numbered as in the exported discussion list; the
links are the underlying GitHub discussions.

| Ref | Link | What it says | Used for |
| --- | --- | --- | --- |
| #82 | [discussions/72](https://github.com/SinYang13/IS212-2026/discussions/72) | Mandatory fields "have not been firmed out… do propose what is appropriate", and no requirement on field lengths | **The entire required-field set and both caps are ours** — D3 |
| #42 | [discussions/73](https://github.com/SinYang13/IS212-2026/discussions/73) | "After an event request is submitted, an Event Operations Manager assigns an Event Coordinator" | D2, D7, SCRUM-26 |
| #1 | [discussions/95](https://github.com/SinYang13/IS212-2026/discussions/95) | "No acceptance step, if any issue it will be handled outside the system" | D2 — assignment does not move status |
| #2 | [discussions/94](https://github.com/SinYang13/IS212-2026/discussions/94) | Reassignment is by the ops manager and may be assumed already approved | SCRUM-26 — re-assignment overwrites |
| #3 | [discussions/93](https://github.com/SinYang13/IS212-2026/discussions/93) | Coordinator choice is "up to Event Operations Manager, they have their own SOP… outside of the system" | SCRUM-55 — no selection rule in the system |
| #15 | [discussions/80](https://github.com/SinYang13/IS212-2026/discussions/80) | Approval means the request holds enough information for planning to proceed | D2 — coordinators review, the ops manager routes |

**Week 4 Project Instructions**, *Event Request Creation*:

> Event Organisers can create and submit event requests containing the
> information needed by ConnectSphere, including the event name, purpose,
> description, proposed date and time, expected attendance, venue requirements,
> accessibility needs, equipment requirements, and registration needs where
> relevant.

That single sentence is the basis for D1 (one action, no separate submit step)
and for the field list. The following paragraph, *Draft Event Requests*, is
US-13 — real, required for the Week 12 release, and **not in phase one**.

**Jira** — epic SCRUM-7, holding SCRUM-23 (2 SP), SCRUM-25 (1 SP) and SCRUM-26
(2 SP). Acceptance criteria SCRUM-44/45/46/47 under SCRUM-23; SCRUM-49/50/51
under SCRUM-25; SCRUM-52/53/54/55 under SCRUM-26.

### What is unconfirmed

Stated plainly, because acting on any of these as if settled is how the schema
drifted in the first place.

- **The `CHECK` constraint on `events.status`.** Widened or dropped — unknown.
  `APPROVED` is in use. If dropped, nothing stops a typo becoming a status.
- **There is no migration for `events`.** The table lives only in the Supabase
  dashboard. Either add a runner and back-fill the create script, or make one
  `docs/` file authoritative and changing it a reviewed step. Four branches read
  this table.
- **D7 — who assigns.** #42 and the mockup disagree. Blocks SCRUM-26.
- **US-13 has no Jira issue.** Until it is raised, `US-13` stays as the label in
  code and tests, and it is the only identifier on this branch that does not
  point at the board.
- **SCRUM-49/50/51 are still `To Do`** while the code that satisfies them is
  written and green. Move them when this branch merges, or the board understates
  the lane by a whole story.
- **The full status lifecycle** — `UNDER_REVIEW`, `REJECTED`, `CONFIRMED`,
  `CANCELLED` — is named in the Week 4 instructions and designed nowhere. It
  needs the CHECK widened deliberately and a transition table that something
  actually calls.

# Event Requests — Sprint 1 scope

> See [the integration guide](event-request-integration.md) for shared
> authentication, `/events/new`, runtime configuration and test commands.

## Scrum tickets

| ID | User story |
| --- | --- |
| Scrum-23 | As an Event Organiser, I want to create an event request containing the information ConnectSphere needs so that my event can be planned. |
| Scrum-25 | As an Event Organiser, I want to submit my event request so that it can be assigned to an Event Coordinator. |

Acceptance criteria Scrum-44 to Scrum-47 sit under Scrum-23; Scrum-49 to
Scrum-51 sit under Scrum-25. Epic Scrum-7.

### Scrum-23 — Create an event request

- An Event Organiser can provide the event name, purpose and description.
- The Organiser can provide the proposed date and time and the expected attendance.
- The Organiser can provide venue requirements and accessibility needs.
- The Organiser can provide equipment and registration needs where relevant.

### Scrum-25 — Submit the event request

- A submitted request is stored and is not treated as a draft.
- The submitted request becomes available for coordinator assignment and subsequent review.
- The event status reflects that the request has been submitted.

The form submits directly to `SUBMITTED` in one action. Saving a draft and
returning to it later is US-13 and is not part of this sprint, so no `DRAFT`
row is ever written here.

---

## Database

The `events` table. There is no migration file for this table; it is maintained
in the Supabase dashboard and shared by the Venue, Equipment, Registration and
Assignment features.

```sql
create table events (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  purpose             text,
  description         text,
  start_time          timestamptz,
  end_time            timestamptz,
  expected_attendance integer,
  venue_requirements  text,        -- free text; read by the venue feature
  accessibility_needs text,
  equipment_needs     text,        -- free text; read by the equipment feature
  other_comments      text,
  registration_fields jsonb,       -- owned by the registration feature
  status              text not null default 'DRAFT',
  organiser_id        uuid not null,
  coordinator_id      uuid,        -- set by coordinator assignment
  submitted_at        timestamptz,
  created_at          timestamptz not null default now()
);
```

### Status values

| Status | Set by | Meaning |
| --- | --- | --- |
| `SUBMITTED` | this module, at insert | Submitted; awaiting coordinator assignment |
| `APPROVED` | not by this module | In use in the table and read by the registration feature |
| `DRAFT` | nothing | The column default. Never written here; reserved for US-13. |

`UNDER_REVIEW`, `REJECTED`, `CONFIRMED` and `CANCELLED` are named in the Week 4
instructions but are not implemented. Do not branch on them, and do not assume
the set is closed. Display labels belong in each feature's own UI; stored values
are not labels.

### Fields the client cannot set

`events.repository.js` writes only the columns in `WRITABLE_COLS`:

```
name · purpose · description · start_time · end_time · expected_attendance
venue_requirements · accessibility_needs · equipment_needs · other_comments
```

Everything else is set by the server or the database and cannot be influenced by
the request body. A key outside the list is dropped rather than rejected, so
adding a column elsewhere cannot break submissions and a client cannot smuggle
one in.

| Column | Set by |
| --- | --- |
| `id` | database default |
| `status` | `createSubmitted`, always `SUBMITTED` |
| `submitted_at` | `createSubmitted`, server clock |
| `organiser_id` | the controller, from the verified session |
| `coordinator_id` | coordinator assignment — see [Coordinator assignment](event-assignment.md) |
| `created_at` | database default |
| `registration_fields` | the registration feature |

Keep `WRITABLE_COLS` and the schema above in step: change one, change the other.

---

## Backend

Module at `backend/src/modules/events/`.

| File | Description |
| --- | --- |
| `events.validation.js` | `validateForSubmission` — the submission gate |
| `events.service.js` | Normalisation: trim, blank to `null`, date parse to ISO, integer attendance |
| `events.repository.js` | `createSubmitted` — writes through an explicit column list |

### Routes

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | /api/events | requireAuth + events.submit | Create and submit an event request |

### Rules enforced server-side

- Every field problem is returned at once, each named by its column, so a form
  can index its inputs by field name.
- `status` is always set to `SUBMITTED` by the server, and `submitted_at` to the
  server clock. Neither can be supplied by the caller.
- `organiser_id` comes from the verified session, never from the body.
- One mistake yields one message. A value that cannot be parsed is reported once
  with its parse error, and the "required" message for that field is dropped.
- `end_time` is checked only against `start_time`. An end after a future start is
  necessarily in the future itself.
- A request either inserts one complete row or inserts nothing. There is no
  partial success.

### Request

Unknown keys are ignored. Send timestamps as ISO 8601 with a zone — a browser
`datetime-local` input gives a zoneless string, which the server would read in
its own zone and shift the event by the organiser's offset.
`withZonedTimes` in `frontend/src/features/events/eventsService.js` converts in
the browser, where the organiser's zone is known.

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

### Responses

`201 Created` returns the full inserted row, which is the same shape read from
the table:

```json
{
  "event": {
    "id": "3f1c8a2e-5d47-4b9a-9c31-7e0a6d2b84f5",
    "name": "Annual Alumni Homecoming",
    "start_time": "2026-11-14T10:00:00+00:00",
    "end_time": "2026-11-14T18:00:00+00:00",
    "expected_attendance": 250,
    "registration_fields": null,
    "status": "SUBMITTED",
    "organiser_id": "<verified-auth-user-uuid>",
    "coordinator_id": null,
    "submitted_at": "2026-09-17T04:12:55.318+00:00",
    "created_at": "2026-09-17T04:12:55.318+00:00"
  }
}
```

`400 Bad Request` returns every problem at once:

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

`500 Internal Server Error` returns one generic message; the underlying error is
logged, never returned:

```json
{ "error": "Could not submit the event request. Please try again." }
```

### Validation

Both validators return `{ ok, errors: [{ field, message }] }`. The required-field
set and both length caps are the team's proposal — clarification #82 left them
to us.

| Field | Draft | Submission | Rule |
| --- | --- | --- | --- |
| `name` | required | required | non-empty after trim, ≤ 200 |
| `purpose` | — | required | non-empty after trim, ≤ 2000 |
| `description` | — | required | non-empty after trim, ≤ 2000 |
| `start_time` | — | required | parseable, in the future |
| `end_time` | — | required | parseable, strictly after `start_time` |
| `expected_attendance` | — | required | integer > 0 |
| `venue_requirements`, `accessibility_needs`, `equipment_needs`, `other_comments` | never | never | optional free text, ≤ 2000 |

Order of checks: browser attributes (`required`, `maxLength`, `min="1"`, for
convenience only) → `normalise` in the service → `validateForSubmission`.
Validation reads and never mutates; trimming and coercion for storage are the
service's job.

`validateDraft` is implemented and unit-tested but is not called by anything. It
is there for US-13.

---

## Frontend

Feature folder at `frontend/src/features/events/`.

### Pages

| File | Route | Scrum | Description |
| --- | --- | --- | --- |
| `pages/EventRequestPage.jsx` | /events/new | 23, 25 | Protected event request form |

### Components

| File | Used by | Description |
| --- | --- | --- |
| `components/EventRequestForm.jsx` | EventRequestPage | The request form. Displays every server-side error against its own input. |
| `components/StatusBadge.jsx` | Event request and assignment screens | Displays the stored status value |

### Services

| File | Description |
| --- | --- |
| `eventsService.js` | Submits the request and converts both timestamps to ISO with a zone |
| `eventFormat.js` | Date and reference formatting shared with the assignment screens |

---

## Integration notes for other features

The `events` table holds no reference back to other features; each owning table
holds its own foreign key.

```sql
create table venue_bookings (
  id       uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  venue_id uuid not null
);
```

```js
// Read the event alongside your own row.
const { data, error } = await supabase
  .from("venue_bookings")
  .select("id, venue_id, events!inner ( id, name, start_time, end_time, expected_attendance, status )")
  .eq("event_id", eventId)
  .maybeSingle();
```

```js
// The reverse. Left join, so an event with no booking still returns.
const { data, error } = await supabase
  .from("events")
  .select("id, name, start_time, end_time, status, venue_bookings ( id, venue_id )")
  .eq("status", "SUBMITTED")
  .order("submitted_at", { ascending: true });
```

Seeded registration rows carry `status = 'SUBMITTED'` with a null `submitted_at`,
so a query ordering only by `submitted_at` places them arbitrarily. Order by
`created_at` as a tiebreak for a stable sequence.

| Feature | Reads | Notes |
| --- | --- | --- |
| Venue | `venue_requirements`, `accessibility_needs` | Free text, optional, may be null, capped at 2000 characters. The venue reference lives on the venue side. |
| Equipment | `equipment_needs` | Free text, optional, may be null. Parsing it into structured requests is the equipment feature's work. |
| Registration | `id`, `status`, `registration_fields` | `registration_fields` is the registration feature's column; this module neither reads nor writes it. |
| Assignment | `status`, `coordinator_id`, `submitted_at` | See [Coordinator assignment](event-assignment.md). |

`venue_requirements` and `equipment_needs` are free text rather than structured
fields in this sprint. Converting them to a room-layout selection or a catalogue
link is a schema change belonging to those features.

A future `GET /api/events` must decide visibility from the caller's role, and a
`?status=` parameter may only narrow within that scope — never widen it.
Otherwise an attendee requesting `?status=SUBMITTED` would read every
organiser's unapproved requests. `roles` is an array; handle a user holding
several.

---

## Acceptance criteria

| Scrum | Done when |
| --- | --- |
| 23 | A signed-in Event Organiser can enter event name, purpose, description, proposed start and end time, expected attendance, venue requirements, accessibility needs, equipment needs and other comments. Required fields are validated in the browser and again on the server. Optional fields may be left blank and are stored as null. |
| 25 | Submitting stores one complete row with `status = 'SUBMITTED'` and `submitted_at` set by the server, owned by the signed-in Organiser. The request is then visible to coordinator assignment. An invalid submission returns every problem at once, each against its own field, and creates no row. |

---

## Testing

```sh
npm --prefix backend test
npm --prefix backend run check
npm --prefix frontend run lint
npm --prefix frontend run build
```

[Event request tests](event-request-tests.md) is the full case-by-case record.

| Layer | File | Covers |
| --- | --- | --- |
| Unit | `tests/unit/events/events.validation.test.js` | Required fields, caps, date ordering, attendance, optional-field handling |
| Unit | `tests/unit/events/events.service.test.js` | Normalisation and the dropped-duplicate-message rule |
| Unit | `tests/unit/events/events.repository.test.js` | That `status`, `submitted_at` and `organiser_id` are set outside `WRITABLE_COLS` |
| Integration | `tests/integration/events.submit.test.js` | The HTTP contract: 201, 400, 500 and the error shape |

Test names lead with their Jira key, so the terminal output is the traceability
record. Cases are grouped by the Week 4 five-step method: happy path,
cross-cutting, negative, boundary.

### Manual checks

The database is shared across features. Prefix test rows and delete them
afterwards.

1. Start both apps and open the event request form.
2. Submit a complete, valid request. Expect the success view and the returned uuid.
3. Confirm the row in Supabase: `status = 'SUBMITTED'`, `submitted_at` set,
   `coordinator_id` null, `organiser_id` matching the signed-in Organiser.
4. Submit an empty form. Expect every required field flagged at once and no row created.
5. Submit with an end time before the start time. Expect one error, on `end_time` only.
6. Enter a local time and confirm the stored `timestamptz` is the intended instant
   rather than shifted by the organiser's UTC offset.
7. Delete the test rows.

---

## Requirements sources

Customer clarifications are numbered as in the exported discussion list.

| Ref | Link | What it says |
| --- | --- | --- |
| #82 | [discussions/72](https://github.com/SinYang13/IS212-2026/discussions/72) | Mandatory fields "have not been firmed out… do propose what is appropriate", and no requirement on field lengths |
| #42 | [discussions/73](https://github.com/SinYang13/IS212-2026/discussions/73) | "After an event request is submitted, an Event Operations Manager assigns an Event Coordinator" |
| #1 | [discussions/95](https://github.com/SinYang13/IS212-2026/discussions/95) | "No acceptance step, if any issue it will be handled outside the system" |
| #2 | [discussions/94](https://github.com/SinYang13/IS212-2026/discussions/94) | Reassignment is by the Operations Manager and may be assumed already approved |
| #3 | [discussions/93](https://github.com/SinYang13/IS212-2026/discussions/93) | Coordinator choice is "up to Event Operations Manager, they have their own SOP… outside of the system" |
| #15 | [discussions/80](https://github.com/SinYang13/IS212-2026/discussions/80) | Approval means the request holds enough information for planning to proceed |

**Week 4 Project Instructions**, *Event Request Creation*:

> Event Organisers can create and submit event requests containing the
> information needed by ConnectSphere, including the event name, purpose,
> description, proposed date and time, expected attendance, venue requirements,
> accessibility needs, equipment requirements, and registration needs where
> relevant.

The following paragraph, *Draft Event Requests*, is US-13. It is required for
the Week 12 release and is not part of this sprint.

---

## Current limitations

- Event list and detail endpoints are not implemented here. New read endpoints
  need permission and event-relationship checks before returning protected data.
- The `CHECK` constraint on `events.status` has not been verified against the
  live database since `APPROVED` came into use.
- There is no migration file for `events`. Schema changes are made in the
  Supabase dashboard and need to be reflected in this document in the same
  sitting.
- The full status lifecycle — `UNDER_REVIEW`, `REJECTED`, `CONFIRMED`,
  `CANCELLED` — is named in the Week 4 instructions and is not yet designed.
- US-13 has no Jira issue, so `US-13` remains the label in code and tests.

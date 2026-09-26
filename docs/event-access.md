# Event ownership and staff responsibilities

Coordinators are separate Supabase accounts with the same `event_coordinator`
role. `events.coordinator_id` determines whose planning workspace contains an
event. A role name, URL parameter, or submitted user ID never proves ownership.

| Account responsibility | Event access |
| --- | --- |
| Attendee | Browse events open for registration; manage only their own registrations |
| Event organiser | Submit requests and see their own requests and requirements |
| Event operations manager | Review requests and select a verified coordinator account |
| Event coordinator | See requirements and arrange bookings only for assigned events |
| Venue staff | Venue catalogue and booking requests across all venues |
| Technical support staff | Equipment catalogue, equipment bookings and their clarification threads across all events |
| Venue + technical staff | Both booking workspaces; no general event planning or attendee browsing |

Permissions combine for accounts with multiple responsibilities. The scope of
each permission still applies: venue responsibility does not grant full event
planning access, and coordinator responsibility does not grant access to another
coordinator's planning records. Managers and organisers use separate workspaces
from attendee browsing. Unknown roles grant nothing.

## Implementation contract

The `/api/event-workspace` endpoints expose organiser-owned requests,
coordinator-assigned events, and manager review/assignment. Database filters use
the authenticated account ID, including direct detail requests. Coordinator
choices come from admin-controlled Auth roles, not browser-supplied role claims.
Manager writes validate the current event state and use a conditional database
update to reject stale decisions.

React Router protects each workspace by a server-derived capability; Express
enforces the same capability independently. `/api/events` browsing and
`/api/registrations` additionally require attendee permissions. Booking APIs keep
their own role and record checks. Venue availability remains visible for planning
but hides unrelated event names from coordinators.

Tests must cover two coordinators, direct URL/API access to another assignment,
multi-role accounts, manager-only assignment, revoked roles, and organisers'
ownership. Test fixtures must not substitute for a production assignment API.

## Review, planning and registration

1. Organiser submits: `SUBMITTED`.
2. Manager accepts (`ACCEPTED`) or rejects (`REJECTED`) the submitted request.
3. Manager selects a confirmed, active account with `event_coordinator` in its
   admin-controlled roles. Assignments can be changed; the former coordinator
   loses API access on the next request. Stale assignment updates return 409.
4. The assigned coordinator reads requirements and arranges venues/equipment.
   Booking requests require `ACCEPTED` or `APPROVED`, not just a non-draft state.
5. Once arrangements are ready, the manager explicitly opens registration:
   `ACCEPTED` → `APPROVED`. A coordinator assignment is required. This is a manual
   readiness decision; the application does not infer readiness from bookings.

Existing `APPROVED` events remain available to attendees. Manager acceptance alone
does not publish a new event. Rejected requests remain visible to their organiser
and manager. Reopening rejected requests and venue booking confirmation remain
outside this change. Technical review is shared across technical staff, not
assignment to an individual technician.

## Routes

| API | Capability and scope |
| --- | --- |
| `GET /api/event-workspace/organiser[/<id>]` | `events.own.read`; organiser_id = authenticated ID |
| `GET /api/event-workspace/coordinator[/<id>]` | `events.assigned.read`; coordinator_id = authenticated ID, accepted/open events |
| `GET /api/event-workspace/manager[/<id>]` | `events.review`; submitted/accepted/rejected/open requests |
| `GET /api/event-workspace/coordinators` | `events.assign`; only IDs, names and emails of active coordinator accounts |
| `PATCH /api/event-workspace/<id>/decision` | Manager; `{decision: "accept"}` or `{decision: "reject"}`; conditional on SUBMITTED |
| `PATCH /api/event-workspace/<id>/coordinator` | Manager; `{coordinatorId, expectedCoordinatorId}`; accepted/open only |
| `PATCH /api/event-workspace/<id>/publication` | Manager; `{openRegistration: true}`; accepted and assigned only |

New review, assignment and publication actions use `eventWorkspace.service.js`
and its guarded router. The existing manager-only `/events/assignments` page and
`/api/internal/events/:eventId/coordinator` API remain available for compatibility:
they can assign submitted requests without accepting or publishing them. Those
requests become available for coordinator planning only after manager acceptance.

## Deployment and verification

Apply `supabase/migrations/007_event_review_and_assignment.sql` **after 006 and
before deploying this code**. It adds ACCEPTED/REJECTED to existing single-column
text status CHECKs without removing their previous allowed values, indexes owner
and coordinator lookups, and rechecks accepted status inside the atomic venue
booking RPC. It does not reset business records. It aborts if the status column
has an unexpected type; review custom multi-column status constraints separately.

The migration has been tested locally on PostgreSQL 17 with migrations 001-006,
including reapplication, preservation of legacy status values and constraints,
and denied booking writes. It has **not** been applied to the live Supabase
database. Supabase SQL-editor/database access is required; the Auth admin key
used for the demo seed is not a general SQL executor. Existing live RLS must keep
business data behind the backend; browser SDK use is for Auth only.

Demo coordinator accounts 2 and 3 were created in the configured Supabase Auth
project; the existing coordinator and venue/technical accounts were preserved.
See [seed accounts](seed-users.md). No live business records were reassigned.

Run `npm test` and `npm run check` in `backend`; run `npm test -- --run`,
`npm run lint` and `npm run build` in `frontend`; run `npm run test:playwright`
from the repository root. Browser/API tests use isolated local Auth and storage;
they do not certify live Supabase policies.

`tests/sql/event-review.setup.sql` and `event-review.assertions.sql` are local
database test fixtures. Never run the setup script against an existing project.
In an empty temporary PostgreSQL database, run setup, migrations 001-007, then
assertions using `psql -v ON_ERROR_STOP=1`. The assertions roll back their changes.

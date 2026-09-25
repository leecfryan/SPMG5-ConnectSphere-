# Venue integration with sign-in and event requests

This integration preserves main's shared authentication, account page, staff
responsibilities, organiser event submission, Docker configuration and tests.
The Venue branch contributes its catalogue, operating information, calendar,
booking form, request review, validation and database migrations.

## Routes and permissions

Every route below requires verified sign-in, `internal.access` and `venues.read`.
The backend independently verifies the bearer token against Supabase on each
request. Roles come only from `app_metadata.roles`; the temporary `x-user-role`
middleware and hardcoded development roles have been removed.

| Frontend URL | Additional capability | Roles |
| --- | --- | --- |
| `/venues` | None | Venue Staff, Event Coordinator |
| `/venues/:id` | None | Venue Staff, Event Coordinator |
| `/venues/:id/availability` | None | Venue Staff, Event Coordinator |
| `/venues/:id/edit` | `venues.update` | Venue Staff, Event Coordinator |
| `/venues/:id/booking-request` | `bookings.request` | Event Coordinator |
| `/venues/booking-requests` | `bookings.read` | Venue Staff, Event Coordinator |
| `/venues/booking-requests` decide controls | `bookings.decide` | Venue Staff |

These are React Router pages with direct links and browser Back/refresh support.
Shared navigation and sign-out stay available. All calls use relative `/api/venues`
URLs through the existing proxy; there is no hardcoded localhost API address.
Frontend visibility is only a convenience; the API enforces each operation.

`GET /api/venues` and `GET /api/venues/:id` retain filters and venue fields.
`PATCH /api/venues/:id` retains the branch's field validation and update behavior.
`GET /api/venues/:id/availability` retains confirmed, requested, unavailable and
closed slots, date windows and AM/PM/Night handling. Catalogue and calendar access
are not restricted to an assigned venue or location.

`GET /api/venues/booking-events` returns upcoming, non-draft events assigned to
the verified coordinator through the existing `events.coordinator_id` column.
`POST /api/venues/:id/booking-requests` checks that same relationship, validates
requirements and slot conflicts, and supplies the verified requester ID to the
database. Submitted requests remain pending and do not consume confirmed slots.

Venue Staff can review venue requests across locations. For coordinators, both
`GET /api/venues/booking-requests` and `GET /api/venues/booking-requests/:id`
filter by their assigned events. The router establishes this scope from the
verified identity; the database service applies it using an inner event join.
Responses select venue requirements and event name/timing/status, not whole
client, attendee or internal planning records. No event-assignment UI is added.
An unassigned event will not appear in a coordinator's picker.

## Deciding a request (SCRUM-22)

`PATCH /api/venues/booking-requests/:requestId/decision` takes
`{ decision: "confirmed" | "rejected", note?: string }` and requires the new
`bookings.decide` permission, held by Venue Staff only. Coordinators keep
`bookings.read`, so they see the outcome on their own requests but cannot
decide them. The reviewer identity comes from the verified session; a
`decided_by` sent in the body is rejected with the other unknown fields.

The decision is applied by `decide_venue_booking_request` (migration 007),
which records `decided_by`, `decided_at` and `decision_note` on the request and
writes the decision to every one of its slot rows in one transaction, so a
request is never half decided. Cancelled slots are left alone: a coordinator
withdrawing a request is not something a later staff decision should undo.

Approving writes `confirmed`, which is where the exclusion constraint from
003 applies. If another request already holds one of those slots, Postgres
rejects the whole statement (SQLSTATE 23P01), nothing changes, and the API
returns 409 rather than 500. Surfacing that clash properly in the UI is
SCRUM-20.

The note is optional here. SCRUM-22 says Venue Staff *may* give a reason,
information or a suggested alternative; SCRUM-102 will make a reason mandatory
for rejections, which is a change to `validateDecision` alone, not a new column.
A rejection records the decision and nothing else: any resulting booking change
is made by the Event Coordinator, so no counter-offer is applied automatically.

## Database deployment

The root `.env` must contain the existing `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY` and server-only `SUPABASE_SECRET_KEY`. Missing venue
storage configuration returns 503 without preventing sign-in or account access.

On the team's Supabase database, apply the schema migrations in dependency order:

1. `001_yc_create_venues.sql`
2. `003_yc_create_venue_bookings.sql`
3. `005_yc_create_venue_booking_requests.sql` (requires the event feature's
   existing `public.events` table)
4. `006_yc_authenticated_venue_booking_requests.sql` (requires the existing
   `events.coordinator_id` column)
5. `007_yc_decide_venue_booking_request.sql` (SCRUM-22 decision columns and
   the service-role-only decision function)

Files 002 and 004 contain optional demonstration data; they are not required
schema migrations. If 001, 003 and 005 are already deployed, only 006 is new.
Do not reset existing tables or re-seed a shared database to deploy this merge.

Migration 006 adds a service-role-only wrapper around the existing atomic booking
RPC. It rechecks the event assignment and records the verified requester on both
the request and its slots in one transaction. Existing rows, the original RPC,
RLS and the confirmed-slot exclusion constraint remain intact. The browser
cannot call the wrapper directly. Deploy 006 before using the new booking API;
GitHub merging and Docker restarts do not apply SQL automatically.

## Integration checks

The added Vitest suites cover 24 API/storage cases: all venue endpoints reject
anonymous, invalid and unrelated identities; forged role and ownership fields
cannot grant access; venue editing and availability retain their behavior;
booking queries apply coordinator scope; request ownership comes from auth;
missing configuration leaves sign-in available.

Six Playwright cases cover protected direct links, catalogue filters, editing,
page refresh and Back, staff/coordinator controls, and an event submitted through
the real event API flowing into a coordinator booking and staff review.
The test assignment endpoint and in-memory storage exist only in test support.
Production controllers, validation, auth and routes are used by the tests.

Frontend lint/build and backend lint are checked. Existing tests are retained;
their exact Venue Staff capability expectations now include `venues.update`.
GitHub CI runs the combined existing and new suites on the merge result.
The tests substitute Supabase storage and do not prove the team's live schema,
migration deployment, grants or database contents. Those require a live check.

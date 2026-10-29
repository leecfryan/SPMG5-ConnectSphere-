# Notification centre — SCRUM-143

## Current scope: iteration 3 — code ready; shared setup pending

The secure inbox identity API and authenticated /notifications page are
implemented. The page shows the unread count and Novu inbox history.
Approval/rejection delivery is implemented below. The story remains open until Ryan applies the schema, configures the workflow and completes live UAT.
Iteration 2 requires @novu/react (installed by the user), with no database change.

Novu Cloud is the selected inbox provider. The first agreed business event is an
event approval or rejection, notifying its organiser. Assignment/reassignment
notifications belong to the future coordinator story.

## API and ownership

GET /api/notifications/inbox-config requires the existing verified bearer token.
It returns exactly applicationIdentifier (public), subscriberId (req.user.id),
and subscriberHash (HMAC-SHA256 hex of that ID using the backend Novu secret).

All verified signed-in users can request their own identity, including users
without role metadata. This is an account feature like /api/auth/me, not an
internal-staff responsibility, so no role capability is added.

The endpoint accepts no target subscriber ID. Query/header claims cannot change
ownership. There is no per-user URL or POST endpoint. Cache-Control: no-store is
set by requireAuth. Missing/malformed/invalid/expired sessions return 401;
verification outages return 503. Missing/blank Novu configuration returns 503
with a safe sentence, while existing sign-in and account APIs continue to work.

The browser receives a caller-bound signature, never NOVU_SECRET_KEY. Treat
that signature as sensitive authentication material: do not log it or reuse it
across accounts. The UI cancels obsolete configuration requests and unmounts the
inbox on account/token changes; cache and socket state are disposed on unmount.

The signature only protects actual Novu feeds after HMAC enforcement is enabled
in the correct Novu environment. That is not verified by these local tests.

## Novu setup

1. Create a Novu Cloud account and select a development environment. Note its
   US or EU region; inbox configuration must match that region.
2. In the Novu environment's Novu In-App integration, enable Security HMAC
   encryption. Keep it enabled; a browser-supplied subscriber ID alone is unsafe.
3. Add NOVU_APPLICATION_IDENTIFIER and NOVU_SECRET_KEY to the existing private
   root .env. Copy the application identifier and API key from the same Novu
   environment. Do not paste keys into chat, commit them or put the secret in
   frontend configuration. .env.example contains empty placeholders only.
4. Restart the backend from the repository root with
   npm --prefix backend run dev. If using Docker, restart the backend container.
   With valid configuration, the signed-in caller's inbox-config request should
   return 200. With missing configuration it should return the safe 503 above.
5. Install the React inbox from the repository root:
   npm --prefix frontend install @novu/react. Start the frontend with
   npm --prefix frontend run dev and open Notifications after signing in.
   This iteration uses the US cloud endpoints. EU environments need matching
   backendUrl/socketUrl settings before use.

Setup references: [Novu production security](https://docs.novu.co/platform/inbox/prepare-for-production)
and [React inbox setup](https://docs.novu.co/platform/inbox/setup-inbox).

## Implementation

- notifications.service.js creates the caller-bound signature using Node's
  built-in crypto module. It reads no environment, makes no network call, and
  returns no configured service if either required setting is blank.
- notifications.controller.js maps a missing service to 503 and reads identity
  only from req.user.id.
- notifications.routes.js attaches requireAuth before the controller.
- app.js mounts /api/notifications; server.js supplies the service from the
  optional environment values. Tests inject a service with dummy settings.

## React inbox — iteration 2

/notifications sits inside RequireAuth and WorkspaceLayout, alongside /account,
with no staff-only permission. WorkspaceLayout adds one Notifications link;
App.jsx adds one page import and one route. Other pages do not fetch inbox data.

NotificationCentrePage reuses useApiResource and apiFetch for the signed config.
Only config matching the verified user mounts Novu; the secret stays on the server.
The Inbox is keyed by account and token. Loading and safe retry states hide stale
content, including late responses from an obsolete request.

NotificationInbox uses Novu's count/history hooks to surface failures safely,
then renders InboxContent with its header hidden. A labelled Mark as read button
replaces the SDK's unnamed icon actions; pending clicks are disabled. A failed
read hides the SDK's optimistic view and asks the user to reload the inbox so the
stored unread state is restored. Read items display Read. The unread count
excludes archived items. Novu manages live updates and paging; ConnectSphere adds
no notification table. Unmount clears the Novu cache and disconnects its socket.
Retry creates fresh signed configuration and a fresh inbox session.

From the repository root, the focused checks are:

- npm --prefix frontend test -- --run src/features/notifications/NotificationCentre.test.jsx --reporter=default --pool=threads --maxWorkers=1
- node node_modules/@playwright/test/cli.js test tests/playwright/notifications.browser.spec.cjs --project=chromium --reporter=list
- npm --prefix frontend run lint
- npm --prefix frontend run build

UI tests cover signed config, loading, counts, safe errors/retry, account/token
changes, mismatched subscribers and read actions. Browser tests use the actual
Novu SDK with local transport fixtures for history, read/count updates,
empty/error recovery, 375px width, keyboard access, sign-out and a second account.
No live Novu or Supabase project is contacted by these fixtures. Manual UAT and
recorded evidence stay outside the application repository under Ryan's reporting
preferences. Live HMAC enforcement still requires manual testing.

Iteration 2 adds a page, inbox component, read-action component, one frontend test
file, one browser test file and the user-installed dependency/lockfile. Routing
and existing setup docs receive matching updates. No commits are made by the agent.

## Acceptance tests — iteration 1

| Test Case ID | Acceptance criterion | Behaviour |
| --- | --- | --- |
| TC-SCRUM-143-01 | AC3 foundation | Correct caller HMAC, only expected public fields, no secret/cache leakage; application-ID whitespace normalised. |
| TC-SCRUM-143-02 | AC3 foundation | Query/header/body and another subscriber URL cannot obtain another user's signature. |
| TC-SCRUM-143-03 | AC3 foundation | Missing, malformed, invalid and expired credentials yield no config. |
| TC-SCRUM-143-04 | AC3 foundation | Consecutive users receive their own distinct identities/signatures. |
| TC-SCRUM-143-05 | AC3 foundation | Every signed-in internal/external role and role-less account can request own config. |
| TC-SCRUM-143-06 | AC3 foundation | Missing, empty or whitespace configuration fails closed; account API remains available. |
| TC-SCRUM-143-07 | AC3 foundation | Provider outage/exception/no-user response yields no config or sensitive provider message. |

These tests use the real Express application over local HTTP, with fake Supabase
verification, dummy Novu keys and independently computed .NET HMAC fixtures. No
Supabase or Novu project is read or changed.

From the repository root, run:

npm --prefix backend run test:events -- tests/integration/notifications.identity.test.js

Expected: all SCRUM-143 identity tests pass. If a test fails, inspect its named
case before configuring a real provider; the suite requires no cloud credentials.

Latest execution: 2026-10-07 — all identity scenarios passed. New service,
controller and router reached 100% statement, branch, function and line coverage.
Targeted lint and isolated auth/permissions, event review/submission and managed
event HTTP regression passed. Full frontend, browser, live Supabase and live Novu
verification were not run for this backend foundation; the story remains open.
Machine-bound check evidence is in the local SCRUM-143 iteration gate ledger.

## Files in iteration 1

| File | Reason |
| --- | --- |
| backend/src/modules/notifications/notifications.service.js | Own-inbox HMAC signing with built-in Node crypto. |
| backend/src/modules/notifications/notifications.controller.js | Map unconfigured provider to 503; use only verified identity. |
| backend/src/routes/notifications.routes.js | Authenticate the single inbox-config endpoint. |
| backend/tests/integration/notifications.identity.test.js | Test caller ownership and failure cases over real local HTTP. |
| backend/src/app.js | Inject and mount the notification router. |
| backend/src/server.js | Build the optional signing service from private server configuration. |
| .env.example | Empty Novu setting placeholders; no credentials. |
| docs/notifications.md | This implementation, setup and acceptance-test guide. |
| README.md | Identify the incomplete notification-centre foundation. |
| .agent/docs/architecture.md | Record the new endpoint and local signing contract. |
| AGENTS.md | Keep the existing external-service architecture summary accurate. |

The local task note under .agent/docs/other/ is ignored by the existing
.gitignore. Iteration 2 gate evidence and manual steps stay outside the application
checkout. Ryan committed iterations 1 and 2; iteration 3 remains unstaged and uncommitted for Ryan to test and commit.


## Approval/rejection delivery — iteration 3

The existing assigned-coordinator review API is unchanged. An AFTER UPDATE
trigger queues a notification only for UNDER_REVIEW -> APPROVED/REJECTED. The
recipient and message snapshot come from the saved event, never request fields.
Failed validation, denied access, conflicts and database rollbacks queue nothing.
If enqueue fails, the decision also rolls back: a saved decision cannot lose its
delivery record. The trigger does not backfill earlier decisions.

The backend starts a worker when the Supabase data client and Novu key are
configured. It claims up to ten due records every 15 seconds, using five-minute
leases and SKIP LOCKED for multiple containers. Each HTTP request times out after
ten seconds; queue RPCs also have a ten-second deadline so an unresponsive
database cannot stall the worker indefinitely. A successful, processed Novu acknowledgement deletes its queue row;
failures reschedule it with exponential delay (15 seconds through one hour).
Lease tokens fence acknowledgements from obsolete workers. Pending rows survive
backend/container restarts. Shutdown clears the timer; an interrupted claim is
available again after its lease expires. Logs contain a fixed operational message,
never provider responses, credentials or subscriber identities.

Every retry uses the same transactionId and Idempotency-Key, plus the immutable
payload. This prevents ordinary repeated business actions from creating another
queue row and supports Novu replay deduplication. It is not an exactly-once
guarantee: Novu's transaction retention depends on the plan, HTTP idempotency is
not enabled for every organisation, and successful/error responses can be cached
for 24 hours. An ambiguous acceptance followed by a long outage can duplicate;
a cached workflow error can delay recovery until that cache expires. Confirm the
provider settings during live UAT. See [trigger contract](https://docs.novu.co/api-reference/events/trigger-event)
and [idempotency rules](https://docs.novu.co/api-reference/idempotency).

The outbox holds only unsent deliveries, not inbox/read history. Successful rows
are removed immediately. An extended outage grows the pending queue; inspect it
in Supabase and fix configuration/provider failures rather than deleting pending
work. Novu acceptance means the workflow accepted the trigger; check its Activity
Feed and the real inbox for actual in-app delivery.

## Create the Novu workflow (US — matching app environment)

1. Open Workflows in the same environment as both existing .env values. Production is supported when its application identifier/API key are configured and HMAC is enabled there; otherwise use Development.
2. Create a dashboard workflow named Event decision with identifier exactly
   **event-decision**. Add one **In-App** step; no bridge endpoint is required.
3. Subject: `Event {{payload.outcome}}`.
4. Body: `Your event “{{payload.eventName | escape}}” was {{payload.outcome}}. {% if payload.remark != '' %}Note: {{payload.remark | escape}}{% endif %}`.
   Use the escape filter for organiser/coordinator text. Keep all recipients
   subscribed to this transactional workflow (set Critical if offered).
5. Save and activate the workflow and its In-App step; confirm the Novu In-App
   integration is active and Security HMAC encryption remains enabled.
6. Preview with eventName = Digital Literacy for Seniors, outcome = approved,
   remark = All details supplied. If a payload schema is requested, these fields
   plus eventId are strings. The server creates the recipient subscriber on trigger.
7. Restart the backend. For Docker, from the repository root use
   `docker compose up --build --renew-anon-volumes` (Ryan runs this).
   No new package or environment variable is needed for iteration 3.

## Schema reference — Ryan runs manually

Tell teammates before adding this table, trigger and two worker functions. In
Supabase SQL Editor, verify this is the shared ConnectSphere project and run the
following once. It is intentionally not an automatic migration or a rerunnable
reset. Existing events and decisions are not modified. Tell teammates when done.
The browser roles receive no table or worker-function access; service_role is
the backend-only role. Do not add public RLS policies or expose queue endpoints.

```sql
begin;

-- SCRUM-143: only pending delivery metadata; Novu retains inbox history.
create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  locked_until timestamptz
);
create index notification_outbox_due on public.notification_outbox(next_attempt_at);
alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from public, anon, authenticated;
grant all on public.notification_outbox to service_role;

create function public.enqueue_event_decision_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notification_outbox(event_id, recipient_id, payload)
  values (new.id, new.organiser_id, jsonb_build_object(
    'eventId', new.id, 'eventName', new.name,
    'outcome', lower(new.status), 'remark', coalesce(new.approval_rejection_remark, '')
  ));
  return new;
end;
$$;
revoke all on function public.enqueue_event_decision_notification() from public, anon, authenticated;
create trigger enqueue_event_decision_notification
after update of status on public.events for each row
when (old.status = 'UNDER_REVIEW' and new.status in ('APPROVED', 'REJECTED'))
execute function public.enqueue_event_decision_notification();

create function public.claim_notification_outbox() returns setof public.notification_outbox
language sql security definer set search_path = '' as $$
  with due as (
    select id from public.notification_outbox
    where next_attempt_at <= now() and (locked_until is null or locked_until <= now())
    order by next_attempt_at, id limit 10 for update skip locked
  )
  update public.notification_outbox q
  set lease_token = gen_random_uuid(), locked_until = now() + interval '5 minutes', attempts = attempts + 1
  from due where q.id = due.id returning q.*;
$$;

create function public.finish_notification_outbox(delivery_id uuid, claim_token uuid, succeeded boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if succeeded then
    delete from public.notification_outbox where id = delivery_id and lease_token = claim_token;
  else
    update public.notification_outbox
    set lease_token = null, locked_until = null,
        next_attempt_at = now() + make_interval(secs => least(3600, 15 * power(2, least(attempts - 1, 8)))::integer)
    where id = delivery_id and lease_token = claim_token;
  end if;
  return found;
end;
$$;
revoke all on function public.claim_notification_outbox() from public, anon, authenticated;
revoke all on function public.finish_notification_outbox(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.claim_notification_outbox() to service_role;
grant execute on function public.finish_notification_outbox(uuid, uuid, boolean) to service_role;
commit;
```

After setup, approve/reject a fresh under-review request as its assigned
coordinator, then sign in as its organiser and open Notifications. Allow the
15-second polling interval. The event name/outcome should appear, unread should
increase, and Mark as read should decrease it. A different account must not see
that item. Repeating approval/rejection should return 409 and create no new item.
Manual UAT remains Not Executed until a human performs these checks.

## Iteration 3 acceptance evidence

All automated delivery tests are isolated from the real Supabase/Novu projects.
The JavaScript unit/HTTP suites run in existing Vitest CI; browser journeys run
in the existing Playwright CI job. SQL fixture files are separate PostgreSQL
evidence and are not currently executed by CI. The local runner extracts the
exact schema above and uses the already-cached postgres:17-alpine image, with no
external network or package installation. Do not run fixture setup in Supabase.

| ID | AC / supporting rule | Observable result |
| --- | --- | --- |
| TC-SCRUM-143-20 | AC1 configuration failure | Missing server data/key disables delivery; no remote call. |
| TC-SCRUM-143-21 | AC1 happy path | Only stored recipient/payload are triggered; acknowledgement removes pending work. |
| TC-SCRUM-143-22 | AC1 failure | HTTP failure, timeout, malformed response or inactive workflow keeps pending work; logs disclose no provider details. |
| TC-SCRUM-143-23 | AC1 recovery | Failed claim/ack/retry storage recovers; replay retains transaction and HTTP idempotency IDs. |
| TC-SCRUM-143-24 | Supporting worker concurrency | Start/stop, empty queue and overlapping polls create no duplicate local worker. |
| TC-SCRUM-143-25 | Supporting storage contract | RPCs use row ID plus lease token; storage error is normalised. |
| TC-SCRUM-143-26 | AC1 HTTP happy/conflict | Real approval/rejection API targets persisted organiser and event, ignores forged recipient/name, repeat returns 409. |
| TC-SCRUM-143-27 | AC1 negative/boundary | Missing session, wrong role/assignment, invalid note and start-review create no notification. |
| TC-SCRUM-143-28 | AC1 provider failure | A saved decision survives outage; its queue item sends on recovery. |
| TC-SCRUM-143-29 | AC1 SQL atomicity | Actual PostgreSQL queues only decisions, snapshots recipient/message, and rolls back both decision and queue on failure. |
| TC-SCRUM-143-30 | Supporting SQL reliability | Active claim cannot repeat; expired claim resumes; stale acknowledgement refused; retry capped; concurrent batches disjoint. |
| TC-SCRUM-143-31 | AC3 supporting queue security | Anonymous/authenticated roles cannot read or claim/finish the queue; backend role can. |
| TC-SCRUM-143-32 | AC1/2 browser journey | Real review HTTP action -> worker -> fixture Novu inbox; organiser sees event/outcome and unread/read updates; repeated action creates no second item; other fixture subscriber receives none. |

Focused backend command (repository root):

```powershell
npm --prefix backend run test:events -- tests/integration/notifications.delivery.test.js tests/integration/notifications.identity.test.js tests/integration/events.review.test.js tests/unit/notifications --pool=threads --maxWorkers=1
```

The actual database snapshot/rollback/privilege guarantees are proven by
tests/sql/notifications.setup.sql plus notifications.assertions.sql against a
disposable PostgreSQL database, not by the in-memory HTTP fixture. Browser
transport fixtures emulate the dashboard workflow's content; they do not verify
its live template, provider retention/idempotency settings or cloud HMAC toggle.
Server startup wiring is exercised in the cached Node 22 backend image with
current source mounted read-only and all provider transports replaced. This is
a runtime check, not a Docker Compose rebuild. Ryan performs the rebuild command
after shared setup. Full live equipment/Supabase tests and PR CI remain pending.

## Coordinator notifications — SCRUM-155 checkpoint 1

The worker selects each queued record's workflow and defaults to event-decision
for older records. Assignment history and preparation are described below.

## Coordinator notifications — SCRUM-155 checkpoint 2 (revised)

Ryan requires notification queueing and delivery to run independently of event
actions. This replaces the earlier uncommitted direct-to-outbox proposal.

Both assignment APIs call assign_event_coordinator through
assignmentHistory.repository.js, passing the verified actor from requireAuth.
The display name is trimmed full name, then email, then account ID. Actor identity
and allowed statuses are never taken from HTTP body fields. Existing permissions,
coordinator validation, allowed statuses and expected-coordinator checks remain.
The legacy PUT still requires an unassigned SUBMITTED event.

The function locks the event, updates coordinator_id and saves a snapshot in
event_assignment_history. It never accesses notification_outbox or Novu. History
contains event name, incoming/outgoing coordinator IDs, assigner ID/name and time.
Event status is unchanged. Same-coordinator saves create no history. A stale
expected coordinator returns no event and the existing API maps that to conflict.
History is saved with the assignment: failure to save that business record still
rolls back assignment. This is the agreed persistence boundary.

The existing worker separately calls enqueue_assignment_notifications each poll.
It locks up to ten pending history records using SKIP LOCKED, queues incoming and
outgoing messages, then marks the history processed in the same transaction.
Queueing failure rolls back only this background transaction; saved assignment
and history remain, ready for retry. Concurrent workers cannot process the same
history record. The committed marker prevents requeueing after successful delivery
has removed outbox rows. Stable delivery IDs and the existing retry worker are
reused; SCRUM-143 provider exactly-once limitations still apply.

If preparation fails, the worker still claims existing notifications, including
approval/rejection. Preparation has a ten-second deadline. Pending history
survives restarts and disabled worker configuration. History is retained after
delivery and intentionally has no cascading foreign keys, preserving snapshots.
Deleted recipient accounts are skipped during preparation, since they no longer
have an inbox. Messages describe each saved change even after later reassignments;
they do not grant outgoing coordinators access to the event.

History has RLS, no browser grants and no browser policies. New RPCs are restricted
to service_role. Existing HTTP permissions remain the authorization boundary.
Direct database edits or old application versions bypass history; no backfill is
attempted. Approval/rejection actions and the existing decision trigger/claim/finish
functions are unchanged. The shared queue gains a workflow field and supports
multiple assignment messages while retaining unique-per-event decision messages.

### Schema reference — SCRUM-155, revised, applied by Ryan

**Applied:** Ryan reported successful execution of this revised block on 2026-10-15. Do not rerun it. This confirms setup, not functional or compatibility verification.

Prepared from Ryan's supplied schema on 2026-10-15. This REPLACES the earlier
SCRUM-155 SQL and expects that earlier block was NOT applied. If it was applied,
stop and report that fact so an adjustment can be prepared; do not rerun it.

Tell teammates before applying and again after success. In the shared project's
Supabase SQL Editor, run the block below ONCE, before starting the changed backend.
Do not rerun the original SCRUM-143 table-creation block. Expected: successful
completion with no result rows. On error, stop and share the error; do not apply
individual statements outside the transaction. Existing queued rows are retained.
The agent has not executed this SQL against the shared database.

The updated assignment APIs require the new function. Apply schema first, then
run this backend. Older backend versions still work after the schema addition but
do not record assignment history. The event-assignment Novu workflow is now active in Development; see checkpoint 3
below for message configuration and preview evidence. No new dependency,
environment variable, event status, endpoint or permission is introduced.

```sql
begin;

create table public.event_assignment_history (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  event_name text not null,
  incoming_coordinator_id uuid not null,
  outgoing_coordinator_id uuid,
  assigned_by_id uuid not null,
  assigned_by_name text not null,
  created_at timestamptz not null default now(),
  notifications_queued_at timestamptz
);
create index event_assignment_history_pending
  on public.event_assignment_history(created_at, id)
  where notifications_queued_at is null;
alter table public.event_assignment_history enable row level security;
revoke all on public.event_assignment_history from public, anon, authenticated;
grant all on public.event_assignment_history to service_role;

alter table public.notification_outbox
  add column workflow text not null default 'event-decision'
  check (workflow in ('event-decision', 'event-assignment'));
alter table public.notification_outbox
  drop constraint notification_outbox_event_id_key;
create unique index notification_outbox_decision_event_key
  on public.notification_outbox(event_id) where workflow = 'event-decision';

create function public.assign_event_coordinator(
  p_event_id uuid,
  p_coordinator_id uuid,
  p_expected_coordinator_id uuid,
  p_allowed_statuses text[],
  p_actor_id uuid,
  p_actor_name text
) returns setof public.events
language plpgsql security invoker set search_path = '' as $$
declare
  saved_event public.events%rowtype;
  outgoing_id uuid;
begin
  if p_coordinator_id is null or p_actor_id is null
     or nullif(btrim(p_actor_name), '') is null then
    raise exception 'Assignment identity is required.';
  end if;

  -- SCRUM-155: lock and compare responsibility before recording the change.
  select e.* into saved_event from public.events e
    where e.id = p_event_id
      and e.status = any(p_allowed_statuses)
      and e.coordinator_id is not distinct from p_expected_coordinator_id
    for update;
  if not found then return; end if;
  if saved_event.coordinator_id is not distinct from p_coordinator_id then
    return next saved_event;
    return;
  end if;

  outgoing_id := saved_event.coordinator_id;
  update public.events set coordinator_id = p_coordinator_id
    where id = p_event_id returning * into saved_event;
  insert into public.event_assignment_history(
    event_id, event_name, incoming_coordinator_id, outgoing_coordinator_id,
    assigned_by_id, assigned_by_name
  ) values (
    saved_event.id, saved_event.name, p_coordinator_id, outgoing_id,
    p_actor_id, btrim(p_actor_name)
  );
  return next saved_event;
end;
$$;
revoke all on function public.assign_event_coordinator(uuid, uuid, uuid, text[], uuid, text)
  from public, anon, authenticated;
grant execute on function public.assign_event_coordinator(uuid, uuid, uuid, text[], uuid, text)
  to service_role;

create function public.enqueue_assignment_notifications() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  change_record public.event_assignment_history%rowtype;
  queued_changes integer := 0;
begin
  for change_record in
    select h.* from public.event_assignment_history h
      where h.notifications_queued_at is null
      order by h.created_at, h.id limit 10 for update skip locked
  loop
    -- SCRUM-155: retain history but skip accounts deleted since assignment.
    insert into public.notification_outbox(event_id, recipient_id, workflow, payload)
      select change_record.event_id, u.id, 'event-assignment', jsonb_build_object(
        'assignmentChangeId', change_record.id,
        'eventId', change_record.event_id,
        'eventName', change_record.event_name,
        'assignedById', change_record.assigned_by_id,
        'assignedByName', change_record.assigned_by_name,
        'assignmentType', case
          when u.id = change_record.outgoing_coordinator_id then 'reassigned-away'
          when change_record.outgoing_coordinator_id is null then 'assigned'
          else 'reassigned' end
      ) from auth.users u
      where u.id in (change_record.incoming_coordinator_id, change_record.outgoing_coordinator_id);
    update public.event_assignment_history set notifications_queued_at = now()
      where id = change_record.id;
    queued_changes := queued_changes + 1;
  end loop;
  return queued_changes;
end;
$$;
revoke all on function public.enqueue_assignment_notifications() from public, anon, authenticated;
grant execute on function public.enqueue_assignment_notifications() to service_role;

commit;
```

## Revised checkpoint verification — 2026-10-15

- Backend lint passed with the pre-existing generated .vitest directory excluded:
  npm --prefix backend run check -- --ignore-pattern '.vitest/**'
- Existing isolated worker regression suite: 22 passed, 0 failed:
  npm --prefix backend run test:events -- tests/unit/notifications/notificationDelivery.test.js --pool=threads --maxWorkers=1
- git diff --check passed. No new tests were authored; no existing tests changed.
- These older worker fixtures do not implement prepareAssignments; its missing-method
  error is caught and delivery continues. Their pass verifies existing delivery/retry
  behaviour, NOT successful history preparation, SQL atomicity or full assignment
  compatibility. New history/RPC tests and live assignment/inbox verification remain pending. Ryan subsequently confirmed successful SQL application.
- No shared database changes, commits or pushes performed by the agent.

## SCRUM-155 checkpoint 3 — Novu assignment workflow

Status: configured and ACTIVE in Development on 2026-10-15. All three message
variants were checked in the Novu editor preview. Live assignment-to-inbox
delivery and full feature/regression tests remain pending.
Use the US Novu environment already configured for the ConnectSphere backend and
inbox. Do not copy API keys into documentation or chat. Reuse the existing In-App
integration and leave the event-decision workflow unchanged.

Create a workflow named **Event assignment**, identifier exactly
**event-assignment**, with one **In-App** step. Use the text/Liquid content editor
for the templates below. Set this transactional workflow to Critical so personal
notification preferences cannot suppress assignment responsibility notices. Save
all content and ensure the workflow and its In-App step are active. No email,
SMS, digest, redirect URL or action button is required by this story.

### Payload contract

All six fields are required strings. assignmentType permits only assigned,
reassigned and reassigned-away. Import the example payload below if using Novu's
Import from JSON option, then constrain assignmentType to those three values and
mark the fields required. Enable payload validation after defining the schema.
These fields match enqueue_assignment_notifications exactly; recipients come
from the worker's subscriberId, not the payload.

```json
{
  "assignmentChangeId": "11111111-1111-4111-8111-111111111111",
  "eventId": "22222222-2222-4222-8222-222222222222",
  "eventName": "Community Open Day",
  "assignedById": "33333333-3333-4333-8333-333333333333",
  "assignedByName": "Alex Tan",
  "assignmentType": "assigned"
}
```

The IDs and names above are fictional editor-preview values, not real recipients.

### In-App subject

```liquid
{% if payload.assignmentType == 'assigned' %}Event assigned to you{% elsif payload.assignmentType == 'reassigned' %}Event reassigned to you{% elsif payload.assignmentType == 'reassigned-away' %}Event reassigned from you{% endif %}
```

### In-App body

```liquid
{% if payload.assignmentType == 'assigned' %}{{payload.assignedByName | escape}} assigned the event "{{payload.eventName | escape}}" to you.{% elsif payload.assignmentType == 'reassigned' %}{{payload.assignedByName | escape}} reassigned the event "{{payload.eventName | escape}}" to you.{% elsif payload.assignmentType == 'reassigned-away' %}{{payload.assignedByName | escape}} reassigned the event "{{payload.eventName | escape}}" from you to another coordinator.{% endif %}
```

Both user-facing fields use the same assignmentType. The name and event text are
escaped to render as content. Outgoing wording does not imply that the coordinator
still has access to the event. Each message describes the historical action; it
does not assert the recipient's current assignment after subsequent changes.

Use the editor preview with each of the three assignmentType values to inspect
the rendered wording before activation. A preview is not a real delivery. Do not
record it as manual UAT or use the dashboard trigger to send to real users during
configuration. Real assignment/inbox verification remains a later step.

### Startup after configuration

If the backend is already running with the updated source, the worker retries
pending deliveries automatically. Otherwise restart it using the project's normal
startup method. For Docker, Ryan runs the following in PowerShell from
C:\Users\ryanl\OneDrive\Documents\GitHub\ConnectSphere:

```powershell
docker compose up --build --renew-anon-volumes
```

Expected: backend and frontend start successfully. If the command fails, share the
error rather than installing dependencies or repeatedly rebuilding. The worker
polls every 15 seconds while configured; retry backoff can delay already-failed
items longer. Existing pending assignment messages may deliver when the workflow
becomes active. Novu trigger acknowledgement alone does not prove inbox delivery;
inspect Activity Feed and the recipient's ConnectSphere Notifications page later.

References checked 2026-10-15:
[Novu workflow configuration](https://docs.novu.co/platform/workflow/configure-workflow)
and [workflow content support](https://docs.novu.co/platform/workflow).
No new package, SQL, application-code change or test file is needed for this
configuration checkpoint. Dashboard activation was observed on 2026-10-15.

### Checkpoint 3 observed configuration — 2026-10-15

Ryan signed in and confirmed Development is the environment used by the local app.
Created [Event assignment](https://dashboard.novu.co/env/dev_env_gyXqS46qohE3Ooak/workflows/event-assignment_wf_gzWdxxR9wzg4tXnZ).
The workflow is Active with one In-App step, Critical workflow enabled, enforced
payload validation, six required fields and the three-value assignmentType enum.
Content sanitization remains enabled. The Novu editor requires single-quoted
strings inside Liquid conditions; the templates above match the saved version.

Editor previews showed:

- assigned: Event assigned to you — Alex Tan assigned the event "Community Open Day" to you.
- reassigned: Event reassigned to you — Alex Tan reassigned the event "Community Open Day" to you.
- reassigned-away: Event reassigned from you — Alex Tan reassigned the event "Community Open Day" from you to another coordinator.

These were editor previews with fictional data, not sent notifications or human
UAT. No dashboard Test Workflow trigger was used. No application code, SQL, test
file, permission or event status changed in this checkpoint. Pending real messages
can now be processed by an already-running worker; actual delivery is unverified.

The existing Event Decision workflow already displayed Action required when the
workflow list was first opened, before creating Event assignment. It was not
modified; its configuration should be checked separately if decision delivery
fails. No cause was established during this checkpoint.

## Equipment issue broadcasts — SCRUM-155 extension (live verification pending)

Ryan authorised notification-only additions to the existing equipment operations.
Notify all accounts with the trusted `technical_support_staff` role when an
existing equipment request enters `REJECTED` (displayed as **Issues**). This is
outside the original assignment AC, explicitly requested as an extension.
The hooks cover the Technical Support dashboard status action and requests flagged
by the existing equipment-retirement operation. The reporting actor is included
among recipients if they hold that role. No venue staff broadcast is included.
Cancellation/postponement notifications remain pending recipient ownership rules.

The original validation, permission checks, status writes, reservation selection,
retirement messages and response bodies remain. An optional notification service
runs after the save (and after the existing retirement message for that path).
A request already observed as REJECTED produces no repeat notification; saving
APPROVED, releasing a reservation, editing catalogue condition, or posting a
clarification message produces no equipment-issue broadcast. There is no separate
issue-report form or structured issue-description field in the current code.
The notification therefore describes the saved arrangement status, without
mistaking `technical_requirement` or an ordinary thread message for issue details.

The backend-only RPC snapshots the event name, equipment type and reporter name,
then inserts one outbox row per technical staff account in a single transaction.
Recipients come from Auth app metadata, never from browser inputs. The existing
15-second worker routes `equipment-issue` rows and retries failed Novu delivery
using the same row ID. No extra worker, endpoint, environment setting or package
is added. The equipment service and frontend are unchanged.

**Independence limit:** enqueue is a separate, best-effort call, bounded by a
10-second database timeout. Errors are logged with a fixed warning and do not
change the equipment operation's success response or undo its save. A failed
enqueue, or a process exit between save and enqueue, can lose that notification;
there is no automatic reconstruction of that missing queue entry. Once queued,
delivery is durable under the existing worker contract. Concurrent original
status writes can still produce duplicate broadcasts because the original
operation has no atomic transition-history check. Preserving that operation
means this addition makes no exactly-once claim. A successful issue response
may take up to ten extra seconds while enqueue is attempted.

### Schema reference — equipment issue broadcast (applied by Ryan)

Tell teammates before applying this notification-only change and after it is done.
It extends the allowed outbox workflows and creates one backend-only function;
it does not alter equipment/event tables, triggers, statuses or permissions.
Ryan confirmed successful manual application after verifying the constraint and columns on 2026-10-15. The inspection used was:

Inspect the current notification
constraint and the existing request columns in Supabase SQL Editor:

```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.notification_outbox'::regclass;

select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('equipment_requests', 'equipment', 'events')
  and column_name in ('id', 'event_id', 'equipment_id', 'name', 'type');
```

The block below assumes the existing SCRUM-155 schema, including the constraint
name `notification_outbox_workflow_check`. If the inspection differs, stop and
adapt this block rather than dropping unrelated constraints. This is not a reset
or backfill: old Issues requests do not automatically send notifications.

```sql
begin;

alter table public.notification_outbox
  drop constraint notification_outbox_workflow_check;
alter table public.notification_outbox
  add constraint notification_outbox_workflow_check
  check (workflow in ('event-decision', 'event-assignment', 'equipment-issue'));

create function public.enqueue_equipment_issue_notifications(
  p_request_id uuid,
  p_actor_id uuid
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  recipient_count integer;
begin
  insert into public.notification_outbox(event_id, recipient_id, workflow, payload)
  select r.event_id, recipient.id, 'equipment-issue', jsonb_build_object(
    'equipmentRequestId', r.id,
    'equipmentType', equipment.type,
    'eventId', event.id,
    'eventName', event.name,
    'reportedById', reporter.id,
    'reportedByName', coalesce(
      nullif(btrim(reporter.raw_user_meta_data ->> 'full_name'), ''),
      nullif(reporter.email, ''), reporter.id::text
    )
  )
  from public.equipment_requests r
  join public.equipment equipment on equipment.id = r.equipment_id
  join public.events event on event.id = r.event_id
  join auth.users reporter on reporter.id = p_actor_id
  cross join auth.users recipient
  where r.id = p_request_id
    and jsonb_typeof(recipient.raw_app_meta_data -> 'roles') = 'array'
    and (recipient.raw_app_meta_data -> 'roles') @> '["technical_support_staff"]'::jsonb;
  get diagnostics recipient_count = row_count;
  return recipient_count;
end;
$$;
revoke all on function public.enqueue_equipment_issue_notifications(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.enqueue_equipment_issue_notifications(uuid, uuid)
  to service_role;

commit;
```

The API hook supplies only a request ID returned by the existing successful save
and the authenticated actor ID. The RPC is not exposed to browser roles and must
not be granted to them. It does not infer an issue from the current row's status:
the API observed that issue save; a later concurrent resolution must not relabel
that earlier action. Names are captured at enqueue time, not at delivery time.

### Novu workflow — equipment-issue (active in Development)

Use the same Development environment as the current app. Create an active Critical
workflow with identifier **equipment-issue** and one In-App step. Require all six
payload fields above as strings. Subject:

```liquid
Equipment issue raised
```

Body:

```liquid
{{payload.reportedByName | escape}} marked the equipment arrangement for "{{payload.equipmentType | escape}}" as Issues for the event "{{payload.eventName | escape}}". Please review the Technical Support dashboard.
```

Escape all displayed names. No actual broadcast has been sent. Ryan confirmed SQL application succeeded on 2026-10-15. The equipment-issue
workflow is active in Development with one In-App step, all six strings required,
schema validation enforced, Critical enabled and content sanitization enabled.
The preview rendered the event/equipment/reporter message using fictional values
(Alex Tan, Wireless microphone, Community Open Day). No real broadcast was sent.
Restart and live inbox verification remain pending. The existing Publish changes
control was not used; no Production configuration was changed.

Workflow: [Equipment issue](https://dashboard.novu.co/env/dev_env_gyXqS46qohE3Ooak/workflows/equipment-issue_wf_gzYltJy8SahC5pwP/).
Screenshots are outside the application checkout in the ConnectSphere 2 workspace,
outputs/SCRUM-155-novu/equipment-issue-preview.jpg, equipment-issue-preferences.jpg
and equipment-issue-active.jpg.

### Verification status

No tests were written or run for this extension, at Ryan's request. Syntax, lint
and whitespace checks are reported separately from live verification. Manual
verification remains **Not Executed**: mark an arrangement Issues, check the
inboxes of two technical staff accounts for the event/equipment/reporter names,
and confirm an account without that role receives nothing. Saving Issues again
should produce no new item in a normal sequential flow. Resolve and raise Issues
again to verify a new report is sent. Also check an equipment retirement that
flags today's reservation, and confirm the original status and thread message
are still saved. These are supporting walkthrough steps, not extra original AC.


## SCRUM-155 notification-only tests — 2026-10-17

Ryan requested notification-focused tests and restoration of the event suites.
The earlier event-test edits and SCRUM-155 addition to event-assignment-tests.md
were undone. No assignment/lifecycle/permission tests are changed by this step.
The previous 119-test combined report is historical, superseded for this scope.

| Supplied acceptance criterion | Notification-specific automated evidence |
| --- | --- |
| The assigned Event Coordinator is notified when an event is assigned to them. | SQL S01 starts from an initial saved assignment snapshot and queues exactly one incoming notice. Integration N01 sends that notice through the real worker/outbox repository and a local HTTP provider substitute, asserting the single subscriber, workflow and message payload. |
| The incoming and outgoing coordinators are notified on reassignment. | SQL S02 compares the exact two-recipient message set. Unit U03 and integration N02 verify both deliveries and their reassigned/reassigned-away variants; a second poll sends no completed deliveries again. |
| The notification names the event and who made the assignment. | SQL S01/S02 assert literal saved event/assigner names and IDs. S02 changes the current event fixture name to prove queueing uses history. N01/N02 compare complete received HTTP payloads with independent expected names. |

### Supporting notification risks

- U04: failed assignment preparation must not stop existing decision delivery.
- U05/N03: a failed recipient remains pending, the other completes, and a new
  worker retries only the failed delivery with the same body/idempotency key.
- S03: already-queued history is not prepared again and retained history is not lost.
- S04: induced queue insertion failure preserves pending notification history;
  later recovery queues exactly the two expected new deliveries.
- S05: authenticated browser roles cannot read history/outbox or call preparation.

These are supporting checks, not extra acceptance criteria. The SQL suite seeds
history snapshots; it never invokes assign_event_coordinator or verifies the
original assignment operation. HTTP integration starts at saved delivery work,
uses the real notification worker/repository, a fake RPC storage boundary and a
real local HTTP provider stub. Real SQL behavior is checked separately. The
assignment-to-history connection, live Supabase and actual Novu inbox rendering
remain outside these unit/integration tests. Browser coverage and the reported
manual UAT result are recorded below.

### Test files and command

- backend/tests/unit/notifications/notificationDelivery.test.js: existing delivery
  tests plus U03–U05 and preparation-aware fixtures.
- backend/tests/integration/notifications.assignment.test.js: three focused cases
  N01 initial notice, N02 incoming/outgoing notices and N03 failed-recipient retry.
- backend/tests/integration/notifications.delivery.test.js: existing approval/
  rejection delivery regression fixture supplies the preparation method.
- tests/sql/assignmentNotifications.assertions.sql: five notification-only SQL
  scenarios S01–S05, executed after the existing local notification SQL fixtures
  and exact schema blocks from this guide. Never run fixture files in Supabase.

Run from the repository root:

```powershell
npm --prefix backend run test:events -- tests/unit/notifications/notificationDelivery.test.js tests/integration/notifications.assignment.test.js tests/integration/notifications.delivery.test.js --pool=threads --maxWorkers=1
```

The existing script name test:events is the general Vitest runner; the explicit
file arguments select only notification files. No event test files run here.
Executed 2026-10-17: **37/37 tests passed** (25 unit, 12 integration including
existing decision regressions). All five local SQL scenarios passed. Targeted
ESLint and whitespace checks passed. NotificationDelivery.service.js and
notificationOutbox.repository.js report 100% statement/branch/function/line
coverage; this is not event-module or SQL coverage.

SQL tests are included in `tests/sql/`. With Node.js 22, Docker running and the
`postgres:17-alpine` image available, run from the repository root:

```sh
node tests/sql/run-assignment-notifications.cjs
```

See [the SQL test instructions](../tests/sql/README.md) for image preparation,
scenario IDs and expected output. The runner uses only files in this repository,
reads the exact schema blocks from this guide and removes its temporary database
container afterwards. It does not need Python, application credentials or the
backend server. A successful run prints five assignment scenario PASS lines.
The existing decision-notification SQL assertions also run as regression checks.

The backend CI job prepares the PostgreSQL image and runs the same SQL command.
This is an isolated database test, not a migration or a shared Supabase check.
Historical mutation, repeatability and coverage results below are supplementary;
the submitted test suites can be run without the earlier local evidence helper.


Notification-only benchmark: all three shuffled 37-test runs (seeds 155, 271,
997) and three fresh local SQL runs passed. Eight of eight sampled faults were
caught by assertions: wrong subscriber, wrong assigner name, skipped preparation,
wrong workflow, omitted outgoing, omitted incoming, wrong event name, and repeated
history processing. Final unmutated JavaScript/SQL controls passed. No production
source file was mutated. This is a sampled benchmark, not a whole-codebase score
or a guarantee of no future flakiness. Three verification gates met, none unmet
or abandoned; all temporary database containers were removed.


## Assignment notification browser tests — SCRUM-155

Run from the repository root, with the existing Playwright dependencies and
Chromium available:

```sh
npm run test:e2e -- tests/playwright/assignment-notifications.browser.spec.cjs
```

| Source test ID | AC | Journey and observable result |
| --- | --- | --- |
| TC-SCRUM-155-E01 | 1, 3 | Lead signs in and assigns an event through Event management. The assigned coordinator sees the event and assigner names in the real Notifications page. Another coordinator's inbox is empty and the organiser receives no assignment notice. Stored event status remains Submitted. |
| TC-SCRUM-155-E02 | 2, 3 | After an initial assignment, a different lead reassigns the event through Event management. Outgoing and incoming coordinators see their respective messages with the new lead's name. Initial history remains visible, an unrelated attendee receives nothing, and processing again creates no duplicate notices. |

The tests run the real React application, Express authentication/permission
checks, assignment service and history repository helper, notification worker,
and Novu React inbox. Test-only adapters replace database RPC storage and remote
Novu responses. Inbox messages must come from the worker's emitted requests;
they are not inserted directly by the browser tests. The signed subscriber ID
and HMAC are checked when each inbox opens.

Queue processing is triggered explicitly through the existing private fixture
endpoint. These browser tests do not measure the background poll interval or
verify deployed Supabase functions and cloud Novu templates. The isolated SQL
suite checks the real PostgreSQL notification preparation separately.

Only test files and test-only support changed: a notification browser spec, an
assignment RPC storage adapter, an extension to notification-storage.cjs and a
one-line dataClient argument in support/server.cjs. Existing event test files and
production event/equipment operations were not edited. The new spec is included
automatically by the existing Chromium CI project.

Executed 17 Oct 2026: both new journeys passed. The combined browser regression
run passed 17/17 tests across assignment notifications, existing notifications
and the event workspace. A three-repeat check passed 6/6 executions with retries
disabled. The first repeat check exposed a test navigation race after sign-in;
the spec now waits for the signed-in page before opening the reassignment URL.
No timing failures were observed in the final limited repeat sample.

Repeat the timing check:

```sh
npm run test:e2e -- tests/playwright/assignment-notifications.browser.spec.cjs --repeat-each=3 --workers=2
```

Run the related regression checks:

```sh
npm run test:e2e -- tests/playwright/assignment-notifications.browser.spec.cjs tests/playwright/notifications.browser.spec.cjs tests/playwright/event-workspace.browser.spec.cjs
```

Playwright writes its HTML report to `playwright-report/index.html` and JSON
results to `test-results/results.json`. On failure it retains screenshots and
traces. To view the latest report, run `npm run test:playwright:report` from the
repository root. An assertion failure produces a nonzero exit status; inspect
the failed scenario and trace before rerunning. Do not install dependencies or
browsers as part of the test command.

Manual UAT: Ryan reported successful completion of the story's manual UAT on
17 Oct 2026. This is a user-reported result, separate from automated execution.
The actual manual execution date and individual observations were not supplied.


## Assignment test compatibility correction — 17 Oct 2026

With approval to update the existing event test fixtures, the eight failures
found during review are resolved. Only tests and their documentation changed.
The original guards and access checks remain; assertions now include the verified
actor and the fixture supports `assign_event_coordinator`.

The same six-file selection now passes **119/119**: 19 assignment unit tests,
22 assignment API tests, 41 workspace integration tests and the existing
37 notification tests. No tests were added, removed or skipped in this correction.
Targeted ESLint and whitespace checks passed. The broader result is separate
from the previously recorded 17/17 browser regression and 6/6 repeated browser
executions. The complete backend/CI pipeline was not run by this correction.

The command and repository-test mapping are in
[the assignment test guide](event-assignment-tests.md#scrum-155-compatibility-verification--17-oct-2026).


## Returned-request notifications — SCRUM-117 Task 3

Ryan reports applying the following SQL and creating the Novu workflow on 22 Oct 2026. Live delivery has not been verified by the agent.

Each new CHANGES_REQUESTED activity record queues an organiser notification in the same return transaction. If queue insertion fails, the return and history roll back together. Provider outages after commit leave durable pending work for the existing worker. The activity UUID is the delivery UUID: retries keep it, later return cycles receive another UUID. No existing activity is backfilled. The current worker already selects row.workflow, so no production worker change is needed.

### Schema reference — return notification (reported applied)

This is a one-time change, not a reset. Preserve any additional workflow values if the shared schema has evolved.

```sql
begin;

alter table public.notification_outbox
  drop constraint notification_outbox_workflow_check;
alter table public.notification_outbox
  add constraint notification_outbox_workflow_check
  check (workflow in (
    'event-decision', 'event-assignment', 'equipment-issue',
    'event-changes-requested'
  ));

create function public.enqueue_event_changes_requested_notification()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notification_outbox
    (id, event_id, recipient_id, workflow, payload)
  values (
    new.id,
    new.event_id,
    (new.details ->> 'organiser_id')::uuid,
    'event-changes-requested',
    jsonb_build_object(
      'eventId', new.event_id,
      'cycleId', new.id,
      'eventName', new.details -> 'before' ->> 'name',
      'message', new.details ->> 'note',
      'requestPath', '/my-event-requests/' || new.event_id::text
    )
  );
  return new;
end;
$$;

revoke all on function public.enqueue_event_changes_requested_notification()
  from public, anon, authenticated;

create trigger enqueue_event_changes_requested_notification
  after insert on public.event_activity_log
  for each row when (new.action = 'CHANGES_REQUESTED')
  execute function public.enqueue_event_changes_requested_notification();

commit;
```

### Novu configuration

Use the same environment as the app. Workflow identifier: `event-changes-requested`; one active In-App step. Payload strings: `eventId`, `cycleId`, `eventName`, `message`, `requestPath`. Subject: `Changes requested: {{payload.eventName | escape}}`. Body: `Your event coordinator has requested changes to your event request. {{payload.message | escape}} Open your request to review the clarification.` Redirect URL: `{{payload.requestPath}}`, same tab. The server constructs the relative path from the saved event UUID; the request page still enforces authentication and visibility.

Novu editor correction: the Event Decision optional-note condition must use single quotes: `{% if payload.remark != '' %}Note: {{payload.remark | escape}}{% endif %}`. Ryan confirmed that this resolves the editor error.

Manual UAT (Not Executed): return a fresh agreed test request as its assigned coordinator, open Notifications as the owner, confirm the exact message and follow the link. Another organiser must receive no notice. Historical returns before the trigger was installed do not enqueue notices. Dashboard preview alone does not prove application delivery.

The inbox supplies React Router navigate as Novu routerPush. Without this integration the SDK can change browser history while React still renders the inbox. E2E-CLARIFICATION-002 verifies that the destination actually renders, not just that the URL changes.

## SCRUM-117 resubmission schema reference

Applied manually by Ryan on 22 October 2026. Install once after the clarification SQL above. The existing worker delivers `event-request-resubmitted` to the retained coordinator; its requestPath opens the assigned request.

```sql
begin;

alter table public.notification_outbox
  drop constraint notification_outbox_workflow_check;
alter table public.notification_outbox
  add constraint notification_outbox_workflow_check
  check (workflow in ('event-decision', 'event-assignment', 'equipment-issue',
    'event-changes-requested', 'event-request-resubmitted'));

create function public.resubmit_event_request(
  p_event_id uuid,
  p_organiser_id uuid,
  p_cycle_id uuid,
  p_expected_fields jsonb
) returns setof public.events
language plpgsql security invoker set search_path = public as $$
declare
  v_event public.events%rowtype;
  v_expected public.events%rowtype;
  v_before public.events%rowtype;
  v_cycle public.event_activity_log%rowtype;
  v_current_fields jsonb;
  v_expected_fields jsonb;
  v_before_fields jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_field text;
  v_old text;
  v_new text;
  v_activity_id uuid := gen_random_uuid();
  v_fields text[] := array['name', 'purpose', 'description', 'start_time', 'end_time',
    'registration_start', 'registration_end', 'expected_attendance', 'venue_requirements',
    'accessibility_needs', 'equipment_needs', 'other_comments'];
begin
  if p_expected_fields is null or jsonb_typeof(p_expected_fields) <> 'object' then
    raise exception 'Expected saved request fields are required.' using errcode = '22023';
  end if;
  if not (p_expected_fields ?& v_fields)
     or (select count(*) from jsonb_object_keys(p_expected_fields)) <> cardinality(v_fields) then
    raise exception 'Provide exactly the editable request fields.' using errcode = '22023';
  end if;

  select * into v_event from public.events where id = p_event_id for update;
  if not found then return; end if;
  if p_organiser_id is null or v_event.organiser_id is distinct from p_organiser_id
     or v_event.status <> 'CHANGES_REQUESTED' or v_event.coordinator_id is null then return; end if;

  select * into v_cycle from public.event_activity_log
  where event_id = p_event_id and action = 'CHANGES_REQUESTED'
  order by created_at desc, id desc limit 1;
  if not found then return; end if;
  if p_cycle_id is null or v_cycle.id is distinct from p_cycle_id
     or (v_cycle.details ->> 'coordinator_id')::uuid is distinct from v_event.coordinator_id then return; end if;
  if exists(select 1 from public.event_activity_log
    where event_id = p_event_id and action = 'REQUEST_RESUBMITTED'
      and details ->> 'cycle_id' = p_cycle_id::text) then return; end if;

  select * into v_expected from jsonb_populate_record(null::public.events, p_expected_fields);
  select * into v_before from jsonb_populate_record(null::public.events, v_cycle.details -> 'before');
  select jsonb_object_agg(key,value) into v_current_fields
    from jsonb_each(to_jsonb(v_event)) where key = any(v_fields);
  select jsonb_object_agg(key,value) into v_expected_fields
    from jsonb_each(to_jsonb(v_expected)) where key = any(v_fields);
  select jsonb_object_agg(key,value) into v_before_fields
    from jsonb_each(to_jsonb(v_before)) where key = any(v_fields);

  -- Recheck the same saved values validated by the server while holding the event lock.
  if v_current_fields is distinct from v_expected_fields then return; end if;

  foreach v_field in array v_fields loop
    v_old := nullif(v_before_fields ->> v_field, '');
    v_new := nullif(v_current_fields ->> v_field, '');
    if v_old is distinct from v_new then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', v_field, 'before', v_before_fields -> v_field,
        'after', v_current_fields -> v_field));
    end if;
  end loop;

  insert into public.event_activity_log(id,event_id,user_id,action,details)
  values(v_activity_id,p_event_id,p_organiser_id,'REQUEST_RESUBMITTED',jsonb_build_object(
    'cycle_id',p_cycle_id,'from_status','CHANGES_REQUESTED','to_status','UNDER_REVIEW',
    'organiser_id',p_organiser_id,'coordinator_id',v_event.coordinator_id,
    'before',v_before_fields,'after',v_current_fields,'changes',v_changes));

  return query update public.events set status = 'UNDER_REVIEW'
    where id = p_event_id returning *;
end;
$$;
revoke all on function public.resubmit_event_request(uuid,uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.resubmit_event_request(uuid,uuid,uuid,jsonb) to service_role;

create function public.enqueue_event_request_resubmitted_notification()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notification_outbox(id,event_id,recipient_id,workflow,payload)
  values(new.id,new.event_id,(new.details ->> 'coordinator_id')::uuid,
    'event-request-resubmitted',jsonb_build_object(
      'eventId',new.event_id,'cycleId',new.details ->> 'cycle_id',
      'eventName',new.details -> 'after' ->> 'name',
      'changedFieldCount',jsonb_array_length(new.details -> 'changes'),
      'requestPath','/assigned-events/' || new.event_id::text));
  return new;
end;
$$;
revoke all on function public.enqueue_event_request_resubmitted_notification()
  from public, anon, authenticated;
create trigger enqueue_event_request_resubmitted_notification
  after insert on public.event_activity_log
  for each row when (new.action = 'REQUEST_RESUBMITTED')
  execute function public.enqueue_event_request_resubmitted_notification();

commit;
```

### Novu configuration for resubmission

Workflow identifier: event-request-resubmitted. One In-App step; subject: Request resubmitted. Body: The organiser has resubmitted {{payload.eventName | escape}}. Open the request to review the updated details. Same-tab redirect: {{payload.requestPath}}. Required payload properties: eventId, cycleId, eventName, requestPath (strings) and changedFieldCount (number). Ryan reports creating the workflow on 22 October 2026. No additional worker deployment change is needed; the existing worker dispatches the queued workflow identifier.

## SCRUM-117 saved-edit version baseline schema reference

Ryan reported applying this correction on 24 October 2026. Apply once after the previous clarification/resubmission setup. No new table, column, status or Novu field. This replaces the comparison baseline; ordinary saves do not advance it.

```sql
begin;

-- SCRUM-117: preserve a submitted version independently of ordinary edits and returns.
create function public.capture_event_request_baseline()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_snapshot jsonb;
  v_source text;
begin
  if tg_op = 'INSERT' then
    if new.status = 'DRAFT' then return new; end if;
    v_source := case when new.status = 'SUBMITTED' then 'SUBMITTED' else 'TRACKING_STARTED' end;
  elsif old.status = 'DRAFT' and new.status = 'SUBMITTED' then
    v_source := 'SUBMITTED';
  elsif old.status = 'CHANGES_REQUESTED' and new.status = 'UNDER_REVIEW' then
    v_source := 'RESUBMITTED';
  else
    return new;
  end if;

  select jsonb_object_agg(key,value) into v_snapshot
  from jsonb_each(to_jsonb(new)) where key = any(array['name','purpose','description','start_time','end_time','registration_start','registration_end','expected_attendance','venue_requirements','accessibility_needs','equipment_needs','other_comments']);
  insert into public.event_activity_log(id,event_id,user_id,action,details,created_at)
  values(gen_random_uuid(),new.id,null,'REQUEST_BASELINE_RECORDED',
    jsonb_build_object('source',v_source,'version_at',clock_timestamp(),'snapshot',v_snapshot),
    clock_timestamp());
  return new;
end;
$$;
revoke all on function public.capture_event_request_baseline() from public, anon, authenticated;
create trigger capture_event_request_baseline
  after insert or update of status on public.events
  for each row execute function public.capture_event_request_baseline();

-- SCRUM-117: retain the best available historical version without inventing old values.
insert into public.event_activity_log(id,event_id,user_id,action,details,created_at)
select gen_random_uuid(),e.id,null,'REQUEST_BASELINE_RECORDED',jsonb_build_object(
  'source',case when submitted.id is not null then 'RESUBMITTED'
    when returned.id is not null then 'RECOVERED_RETURN' else 'TRACKING_STARTED' end,
  'version_at',coalesce(submitted.created_at,returned.created_at,clock_timestamp()),
  'snapshot',coalesce(submitted.details -> 'after',returned.details -> 'before',current_fields.snapshot)
),clock_timestamp()
from public.events e
cross join lateral (
  select jsonb_object_agg(key,value) as snapshot from jsonb_each(to_jsonb(e))
  where key = any(array['name','purpose','description','start_time','end_time','registration_start','registration_end','expected_attendance','venue_requirements','accessibility_needs','equipment_needs','other_comments'])
) current_fields
left join lateral (
  select h.id,h.details,h.created_at from public.event_activity_log h
  where h.event_id=e.id and h.action='REQUEST_RESUBMITTED'
    and jsonb_typeof(h.details -> 'after')='object'
  order by h.created_at desc,h.id desc limit 1
) submitted on true
left join lateral (
  select h.id,h.details,h.created_at from public.event_activity_log h
  where h.event_id=e.id and h.action='CHANGES_REQUESTED'
    and jsonb_typeof(h.details -> 'before')='object'
  order by h.created_at asc,h.id asc limit 1
) returned on true
where e.status <> 'DRAFT' and not exists(
  select 1 from public.event_activity_log h
  where h.event_id=e.id and h.action='REQUEST_BASELINE_RECORDED'
);

create or replace function public.resubmit_event_request(
  p_event_id uuid,
  p_organiser_id uuid,
  p_cycle_id uuid,
  p_expected_fields jsonb
) returns setof public.events
language plpgsql security invoker set search_path = public as $$
declare
  v_event public.events%rowtype;
  v_expected public.events%rowtype;
  v_before public.events%rowtype;
  v_cycle public.event_activity_log%rowtype;
  v_baseline public.event_activity_log%rowtype;
  v_current_fields jsonb;
  v_expected_fields jsonb;
  v_before_fields jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_field text;
  v_old text;
  v_new text;
  v_activity_id uuid := gen_random_uuid();
  v_fields text[] := array['name', 'purpose', 'description', 'start_time', 'end_time',
    'registration_start', 'registration_end', 'expected_attendance', 'venue_requirements',
    'accessibility_needs', 'equipment_needs', 'other_comments'];
begin
  if p_expected_fields is null or jsonb_typeof(p_expected_fields) <> 'object' then
    raise exception 'Expected saved request fields are required.' using errcode = '22023';
  end if;
  if not (p_expected_fields ?& v_fields)
     or (select count(*) from jsonb_object_keys(p_expected_fields)) <> cardinality(v_fields) then
    raise exception 'Provide exactly the editable request fields.' using errcode = '22023';
  end if;

  select * into v_event from public.events where id = p_event_id for update;
  if not found then return; end if;
  if p_organiser_id is null or v_event.organiser_id is distinct from p_organiser_id
     or v_event.status <> 'CHANGES_REQUESTED' or v_event.coordinator_id is null then return; end if;

  select * into v_cycle from public.event_activity_log
  where event_id = p_event_id and action = 'CHANGES_REQUESTED'
  order by created_at desc, id desc limit 1;
  if not found then return; end if;
  if p_cycle_id is null or v_cycle.id is distinct from p_cycle_id
     or (v_cycle.details ->> 'coordinator_id')::uuid is distinct from v_event.coordinator_id then return; end if;
  if exists(select 1 from public.event_activity_log
    where event_id = p_event_id and action = 'REQUEST_RESUBMITTED'
      and details ->> 'cycle_id' = p_cycle_id::text) then return; end if;

  select * into v_baseline from public.event_activity_log
  where event_id = p_event_id and action = 'REQUEST_BASELINE_RECORDED'
  order by created_at desc, id desc limit 1;
  if not found then return; end if;

  select * into v_expected from jsonb_populate_record(null::public.events, p_expected_fields);
  select * into v_before from jsonb_populate_record(null::public.events, v_baseline.details -> 'snapshot');
  select jsonb_object_agg(key,value) into v_current_fields
    from jsonb_each(to_jsonb(v_event)) where key = any(v_fields);
  select jsonb_object_agg(key,value) into v_expected_fields
    from jsonb_each(to_jsonb(v_expected)) where key = any(v_fields);
  select jsonb_object_agg(key,value) into v_before_fields
    from jsonb_each(to_jsonb(v_before)) where key = any(v_fields);

  -- Recheck the same saved values validated by the server while holding the event lock.
  if v_current_fields is distinct from v_expected_fields then return; end if;

  foreach v_field in array v_fields loop
    v_old := nullif(v_before_fields ->> v_field, '');
    v_new := nullif(v_current_fields ->> v_field, '');
    if v_old is distinct from v_new then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', v_field, 'before', v_before_fields -> v_field,
        'after', v_current_fields -> v_field));
    end if;
  end loop;

  insert into public.event_activity_log(id,event_id,user_id,action,details)
  values(v_activity_id,p_event_id,p_organiser_id,'REQUEST_RESUBMITTED',jsonb_build_object(
    'cycle_id',p_cycle_id,'from_status','CHANGES_REQUESTED','to_status','UNDER_REVIEW',
    'organiser_id',p_organiser_id,'coordinator_id',v_event.coordinator_id,
    'before',v_before_fields,'after',v_current_fields,'changes',v_changes,
    'baseline_id',v_baseline.id,'baseline_source',v_baseline.details ->> 'source',
    'baseline_version_at',v_baseline.details -> 'version_at'));

  return query update public.events set status = 'UNDER_REVIEW'
    where id = p_event_id returning *;
end;
$$;
revoke all on function public.resubmit_event_request(uuid,uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.resubmit_event_request(uuid,uuid,uuid,jsonb) to service_role;

commit;
```


## Venue hold warnings and expiry — SCRUM-163

The existing worker prepares venue-hold-expiry deliveries independently of assignment work. It validates the persisted coordinator, reservation generation, venue/event/deadline and current lifecycle before sending. The one-hour warning and historical expiry/release notice share one Novu In-App workflow. The exact additive schema, safety tradeoff, setup and payload contract are in [Venue integration](venue-integration.md#coordinator-venue-hold-expiry-notifications--scrum-163). Shared setup and manual UAT remain pending.

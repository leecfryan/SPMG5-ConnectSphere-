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
4. Body: `Your event “{{payload.eventName | escape}}” was {{payload.outcome}}. {% if payload.remark != "" %}Note: {{payload.remark | escape}}{% endif %}`.
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

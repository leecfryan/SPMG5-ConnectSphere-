# Notification SQL tests

Run these tests from the ConnectSphere repository root. They require Node.js 22
and Docker with Linux containers running. PostgreSQL and Python do not need to
be installed on the host. No application server, credentials or `.env` file is
needed.

Prepare the PostgreSQL image once:

```sh
docker pull postgres:17-alpine
```

Run the SQL tests:

```sh
node tests/sql/run-assignment-notifications.cjs
```

The runner creates an empty PostgreSQL container, loads the existing notification
fixtures and the schema blocks from `docs/notifications.md`, then executes
`assignmentNotifications.assertions.sql`. The container has no network access,
published ports or persistent data volume and is removed when the run finishes.
The tests never contact Supabase or Novu. Readiness and SQL execution both use
TCP loopback inside the container, so the temporary socket-only initialization
server cannot be mistaken for the final PostgreSQL server.

Do not run the fixture or assertion files in the Supabase SQL editor or an
existing database. They clear and replace fixture data.

| Source test ID | Scenario |
| --- | --- |
| TC-SCRUM-155-S01 | An initial assignment queues one notification for the assigned coordinator with the event and assigner names. |
| TC-SCRUM-155-S02 | A reassignment queues incoming and outgoing notifications with the saved event and assigner names. |
| TC-SCRUM-155-S03 | Preparing the same history again creates no duplicate notifications. |
| TC-SCRUM-155-S04 | A queue insert failure preserves pending history; a later retry succeeds. |
| TC-SCRUM-155-S05 | The authenticated browser role cannot read or process notification delivery work. |

A successful run prints a `PASS` line for each scenario and
`5/5 assignment notification SQL scenarios passed.` It also runs the existing
decision-notification SQL assertions before the assignment scenarios.

An assertion failure prints its source test ID and exits with a nonzero status.
For a Docker error, start Docker and check `docker info`. For a missing image,
run the image preparation command above and retry. The runner never downloads
the image automatically.

To run the JavaScript notification tests, use the existing backend dependencies:

```sh
npm --prefix backend run test:events -- tests/unit/notifications/notificationDelivery.test.js tests/integration/notifications.assignment.test.js tests/integration/notifications.delivery.test.js --pool=threads --maxWorkers=1
```

This selects 37 notification tests. The script name `test:events` is the existing
general Vitest entry point; the explicit paths select notification files only.
The HTTP integration tests use a local provider substitute. These tests do not
prove live Novu inbox delivery or the event assignment operation; those remain
manual acceptance checks.


## SCRUM-117 returned-request notifications

From the repository root, with Docker running and the existing postgres:17-alpine image cached, run `node tests/sql/run-assignment-notifications.cjs --clarification`. The existing isolated runner additionally extracts the exact Task 2 return function and Task 3 trigger from the guides. No cloud credentials or shared database connection are used. Expected: `CLARIFICATION SQL ASSERTIONS PASSED`, exit zero. S01 proves refusal without mutations; S02 exact saved recipient/message/link and duplicate rejection; S03 independent cycles; S04 transaction rollback on enqueue failure; S05 browser access restrictions. The setup and assertions are disposable test fixtures, never migrations or shared-database scripts. Executed by Codex on 22 Oct 2026 after Ryan started Docker: all five clarification scenarios passed along with the existing decision/assignment assertions. This optional SQL suite is not part of CI.

The --clarification option also verifies the documented SCRUM-117 resubmission RPC and trigger with resubmission.assertions.sql. It checks all twelve fields, stale snapshots/cycles, equivalent timestamps, unchanged/reverted values, retained coordinator, duplicate refusal, queue rollback and browser-role privileges. Success includes RESUBMISSION SQL ASSERTIONS PASSED.

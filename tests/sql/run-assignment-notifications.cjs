const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawnSync, spawn } = require("node:child_process");

const root = path.resolve(__dirname, "../..");
const image = "postgres:17-alpine";

function docker(args, input) {
  const result = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    timeout: 30000,
    windowsHide: true,
  });
  if (result.error) throw new Error(`Docker could not run: ${result.error.message}`);
  return result;
}

function requireSuccess(result, action) {
  if (result.status !== 0) {
    throw new Error(`${action}\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function schemaBlock(blocks, marker) {
  const matches = blocks.filter(block => block.includes(marker));
  if (matches.length !== 1) throw new Error(`Expected one schema block containing: ${marker}`);
  return matches[0];
}

async function run() {
  // SCRUM-43/SCRUM-163: these exported fixtures each own the disposable events/helper schema.
  if (process.argv.includes("--registration") && process.argv.includes("--venue-holds")) {
    throw new Error("Run --registration and --venue-holds in separate invocations so each owns its disposable database.");
  }
  // SCRUM-41: the venue-holds fixture creates the same venue tables and enums,
  // so the two cannot share one disposable database.
  if (process.argv.includes("--venue-decision") && process.argv.includes("--venue-holds")) {
    throw new Error("Run --venue-decision and --venue-holds in separate invocations so each owns its disposable database.");
  }
  // SCRUM-170: the postpone fixture builds its own events, registration and venue tables.
  if (process.argv.includes("--postpone") && ["--clarification", "--registration", "--venue-holds", "--venue-decision"].some(flag => process.argv.includes(flag))) {
    throw new Error("Run --postpone on its own so it owns its disposable database.");
  }
  const guide = fs.readFileSync(path.join(root, "docs/notifications.md"), "utf8");
  const blocks = [...guide.matchAll(/```sql\r?\n([\s\S]*?)\r?\n```/g)].map(match => match[1]);
  const readSql = name => fs.readFileSync(path.join(__dirname, name), "utf8");
  const parts = [
    readSql("notifications.setup.sql"),
    schemaBlock(blocks, "create table public.notification_outbox ("),
    readSql("notifications.assertions.sql"),
    schemaBlock(blocks, "create table public.event_assignment_history ("),
    readSql("assignmentNotifications.assertions.sql"),
  ];
  if (process.argv.includes("--clarification")) {
    const eventGuide = fs.readFileSync(path.join(root, "docs/event-requests.md"), "utf8");
    const eventBlocks = [...eventGuide.matchAll(/```sql\r?\n([\s\S]*?)\r?\n```/g)].map(match => match[1]);
    parts.push(readSql("clarificationNotifications.setup.sql"),
      schemaBlock(eventBlocks, "create function public.request_event_changes("),
      schemaBlock(blocks, "create function public.enqueue_event_changes_requested_notification()"),
      readSql("clarificationNotifications.assertions.sql"),
      schemaBlock(blocks, "create function public.resubmit_event_request("),
      readSql("resubmission.assertions.sql"),
      schemaBlock(blocks, "create function public.capture_event_request_baseline()"),
      readSql("requestBaseline.assertions.sql"));
  }
  if (process.argv.includes("--venue-holds")) {
    const venueGuide = fs.readFileSync(path.join(root, "docs/venue-integration.md"), "utf8");
    const venueBlocks = [...venueGuide.matchAll(/```sql\r?\n([\s\S]*?)\r?\n```/g)].map(match => match[1]);
    parts.push(readSql("venueHoldNotifications.setup.sql"),
      schemaBlock(venueBlocks, "create table public.venue_hold_notification_state ("),
      readSql("venueHoldNotifications.assertions.sql"));
  }
  if (process.argv.includes("--registration")) {
    parts.push(readSql("registrationNotifications.setup.sql"),
      schemaBlock(blocks, "create table public.registration_notification_history ("),
      readSql("registrationNotifications.assertions.sql"),
      schemaBlock(blocks, "-- SCRUM-43: expired-lease repair for an existing installation."),
      "\ndo $$ declare q public.notification_outbox%rowtype; begin\n  if not has_function_privilege('service_role','public.validate_waitlist_offer_reminder(uuid,uuid)','EXECUTE')\n    or has_function_privilege('authenticated','public.validate_waitlist_offer_reminder(uuid,uuid)','EXECUTE') then\n    raise exception '[TC-SCRUM-43-S24] repair changed execute privileges'; end if;\n  perform public.enqueue_registration_notifications();\n  delete from public.notification_outbox;\n  perform public.enqueue_waitlist_offer_reminders();\n  select * into strict q from public.claim_notification_outbox();\n  update public.notification_outbox set locked_until=clock_timestamp()-interval '1 second' where id=q.id;\n  begin\n    perform public.validate_waitlist_offer_reminder(q.id,q.lease_token);\n    raise exception '[TC-SCRUM-43-S24] existing-installation repair did not reject expired lease';\n  exception when sqlstate '55000' then null; end;\nend $$;\nselect 'REGISTRATION REPAIR ASSERTIONS PASSED';");
  }
  // SCRUM-41: the venue tables the decision trigger reads, then the documented
  // trigger, then its scenarios.
  if (process.argv.includes("--venue-decision")) {
    parts.push(readSql("venueDecisionNotifications.setup.sql"),
      schemaBlock(blocks, "function public.enqueue_venue_booking_decision_notification()"),
      readSql("venueDecisionNotifications.assertions.sql"));
  }
  // SCRUM-170: both venue notification triggers are installed first, so the
  // assertions prove releasing the venues sets neither of them off.
  if (process.argv.includes("--postpone")) {
    const venueGuide = fs.readFileSync(path.join(root, "docs/venue-integration.md"), "utf8");
    const venueBlocks = [...venueGuide.matchAll(/```sql\r?\n([\s\S]*?)\r?\n```/g)].map(match => match[1]);
    const eventGuide = fs.readFileSync(path.join(root, "docs/event-requests.md"), "utf8");
    const eventBlocks = [...eventGuide.matchAll(/```sql\r?\n([\s\S]*?)\r?\n```/g)].map(match => match[1]);
    parts.push(readSql("postponeEvent.setup.sql"),
      schemaBlock(blocks, "function public.enqueue_venue_booking_decision_notification()"),
      schemaBlock(venueBlocks, "create table public.venue_hold_notification_state ("),
      schemaBlock(eventBlocks, "create or replace function public.postpone_event("),
      readSql("postponeEvent.assertions.sql"));
  }
  const script = parts.join("\n");

  requireSuccess(docker(["info", "--format", "{{.ServerVersion}}"]), "Start Docker and try again.");
  requireSuccess(docker(["image", "inspect", image]), `Prepare the test image first: docker pull ${image}`);

  const name = `assignment-notifications-${randomUUID()}`;
  let started = false;
  try {
    requireSuccess(docker([
      "run", "--detach", "--rm", "--pull=never", "--network=none",
      "--name", name, "--tmpfs", "/var/lib/postgresql/data",
      "-e", "POSTGRES_HOST_AUTH_METHOD=trust", image,
    ]), "Could not start the temporary PostgreSQL container.");
    started = true;

    const deadline = Date.now() + 15000;
    // The image's temporary initialization server accepts sockets before the final TCP server starts.
    while (docker(["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]).status !== 0) {
      if (Date.now() >= deadline) throw new Error("Temporary PostgreSQL did not become ready.");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    }

    const output = requireSuccess(docker([
      "exec", "-i", name, "psql", "-h", "127.0.0.1", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres",
    ], script), "SQL assertions failed. The failing test ID appears below.");
    if (!output.includes("ASSIGNMENT SQL ASSERTIONS PASSED")) {
      throw new Error("The SQL run ended without the assignment test completion marker.");
    }
    if (process.argv.includes("--venue-decision") && !output.includes("VENUE DECISION SQL ASSERTIONS PASSED")) {
      throw new Error("Venue decision SQL assertions did not complete.");
    }
    if (process.argv.includes("--clarification") && !output.includes("CLARIFICATION SQL ASSERTIONS PASSED")) {
      throw new Error("Clarification SQL assertions did not complete.");
    }
    if (process.argv.includes("--clarification") && !output.includes("RESUBMISSION SQL ASSERTIONS PASSED")) throw new Error("Resubmission SQL assertions did not complete.");
    if (process.argv.includes("--clarification") && !output.includes("SAVED EDIT BASELINE ASSERTIONS PASSED")) throw new Error("Saved baseline assertions did not complete.");
    if (process.argv.includes("--venue-holds")) {
      if (!output.includes("VENUE HOLD SQL ASSERTIONS PASSED")) throw new Error("Venue hold SQL assertions did not complete.");
      const psql = ["exec", "-i", name, "psql", "-Atq", "-h", "127.0.0.1", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres"];
      requireSuccess(docker(psql, "truncate public.notification_outbox,public.venue_hold_notification_state,public.venue_bookings,public.venue_booking_requests; update public.events set cancelled_at=null,status='APPROVED'; insert into public.venue_bookings(venue_id,event_id,coordinator_id,booking_date,slot,event_name,status,expires_at,requested_by) select 'aaaaaaaa-0163-4163-8163-000000000001','eeeeeeee-0163-4163-8163-000000000001','11111111-1111-4111-8111-111111111111','2099-10-10',s::public.venue_slot,'Client','hold',now()+interval '30 minutes','venue-staff' from unnest(array['am','pm','night']) s;"), "Could not arrange concurrent venue fixture.");
      const first = spawn("docker", psql, { windowsHide: true });
      let firstOutput = "", firstError = "", timer;
      const closed = new Promise(resolve => first.once("close", resolve));
      first.stdin.on("error", () => {});
      const ready = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("First venue transaction never reached the lock barrier.")), 15000);
        first.on("error", reject);
        first.stdout.on("data", chunk => { firstOutput += chunk; if (firstOutput.includes("VENUE_FIRST_READY")) { clearTimeout(timer); resolve(); } });
        first.stderr.on("data", chunk => { firstError += chunk; });
      });
      first.stdin.write("begin; select public.enqueue_venue_hold_notifications();\n\\echo VENUE_FIRST_READY\n");
      try {
        await ready;
        const second = requireSuccess(docker(psql, "set statement_timeout='3s'; select public.enqueue_venue_hold_notifications();"), "Second preparer blocked instead of skipping the owned cohort.");
        if (second.trim() !== "0") throw new Error("Second preparer split or duplicated the first transaction's hold cohort: " + second);
      } finally {
        clearTimeout(timer);
        first.stdin.end("commit;\n");
        if (await closed !== 0) throw new Error("First venue transaction failed: " + firstError);
      }
      const verified = requireSuccess(docker(psql, "do $$ begin if (select count(*) from public.notification_outbox) is distinct from 1 or (select count(distinct warning_id) from public.venue_hold_notification_state) is distinct from 1 or (select count(*) from public.venue_hold_notification_state where warning_id is not null) is distinct from 3 or public.enqueue_venue_hold_notifications() is distinct from 0 then raise exception '[TC-SCRUM-163-S18] concurrent cohort lost or duplicated';end if;end $$;select 'VENUE HOLD CONCURRENCY ASSERTIONS PASSED';"), "Concurrent venue assertions failed.");
      process.stdout.write(verified);
    }
    if (process.argv.includes("--registration") && !output.includes("REGISTRATION SQL ASSERTIONS PASSED")) throw new Error("Registration SQL assertions did not complete.");

    if (process.argv.includes("--registration")) {
      const psql = ["exec", "-i", name, "psql", "-h", "127.0.0.1", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres"];
      requireSuccess(docker(psql, "delete from public.notification_outbox; delete from public.registration_notification_history; update public.events set status='APPROVED',start_time=now()+interval '1 day'; update public.event_waitlist_entries set offer_state='offered',offered_at=now(),offer_expires_at=now()+interval '30 minutes' where status='active';"), "Could not prepare concurrent notification fixture.");
      const prepare = () => new Promise((resolve, reject) => {
        const child = spawn("docker", psql, { windowsHide: true, timeout: 30000 });
        let stderr = "";
        child.stdout.resume();
        child.stderr.on("data", chunk => { stderr += chunk; });
        child.on("error", reject);
        child.on("close", code => code === 0 ? resolve() : reject(new Error("Concurrent preparation failed: " + stderr)));
        child.stdin.on("error", reject);
        child.stdin.end("begin; select public.enqueue_registration_notifications(); select pg_sleep(0.3); select public.enqueue_waitlist_offer_reminders(); commit;");
      });
      const results = await Promise.allSettled([prepare(), prepare()]);
      for (const result of results) if (result.status === "rejected") throw result.reason;
      const result = requireSuccess(docker(psql, "do $$ begin if (select count(*) from public.notification_outbox) <> 2 or public.enqueue_registration_notifications() <> 0 or public.enqueue_waitlist_offer_reminders() <> 0 then raise exception '[TC-SCRUM-43-S16] concurrent workers lost or duplicated deliveries'; end if; end $$; select 'REGISTRATION CONCURRENT ASSERTIONS PASSED';"), "Concurrent notification assertions failed.");
      if (!result.includes("REGISTRATION CONCURRENT ASSERTIONS PASSED")) throw new Error("Concurrent assertions did not finish.");
      process.stdout.write(result);
    }

    if (process.argv.includes("--postpone")) {
      if (!output.includes("POSTPONE SQL ASSERTIONS PASSED")) throw new Error("Postpone SQL assertions did not complete.");
      const psql = ["exec", "-i", name, "psql", "-Atq", "-h", "127.0.0.1", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres"];
      const race = "eeeeeeee-0170-4170-8170-000000000003";
      const postpone = reason => `select count(*) from public.postpone_event('${race}', '22222222-2222-4222-8222-222222222222', '${reason}', true);`;
      requireSuccess(docker(psql, `truncate public.notification_outbox; insert into public.events(id, name, status, organiser_id, coordinator_id) values ('${race}', 'Race', 'APPROVED', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');`), "Could not arrange the concurrent postpone fixture.");
      const session = () => {
        const child = spawn("docker", psql, { windowsHide: true });
        const state = { child, output: "", error: "" };
        child.stdout.on("data", chunk => { state.output += chunk; });
        child.stderr.on("data", chunk => { state.error += chunk; });
        child.stdin.on("error", () => {});
        state.closed = new Promise(resolve => child.once("close", resolve));
        return state;
      };
      const first = session();
      let timer;
      const ready = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("The first postpone never took the event lock.")), 15000);
        first.child.stdout.on("data", () => { if (first.output.includes("FIRST_READY")) { clearTimeout(timer); resolve(); } });
      });
      first.child.stdin.write(`begin; ${postpone("first")}\n\\echo FIRST_READY\n`);
      let second;
      try {
        await ready;
        second = session();
        second.child.stdin.end(`set statement_timeout = '10s'; ${postpone("second")}\n`);
        await new Promise(resolve => setTimeout(resolve, 500));
        if (second.child.exitCode !== null) throw new Error("[TC-SCRUM-170-07] the second postpone did not wait for the first: " + second.output + second.error);
      } finally {
        clearTimeout(timer);
        first.child.stdin.end("commit;\n");
      }
      if (await first.closed !== 0 || await second.closed !== 0) throw new Error("A concurrent postpone failed: " + first.error + second.error);
      if (!first.output.startsWith("1") || second.output.trim() !== "0") {
        throw new Error(`[TC-SCRUM-170-07] expected exactly one postpone to win, got ${JSON.stringify(first.output)} and ${JSON.stringify(second.output)}`);
      }
      const verified = requireSuccess(docker(psql, `do $$ begin if (select count(*) from public.notification_outbox where event_id = '${race}') <> 1 or (select count(*) from public.event_activity_log where event_id = '${race}') <> 1 or (select postponement_reason from public.events where id = '${race}') <> 'first' then raise exception '[TC-SCRUM-170-07] the losing postpone wrote or queued something'; end if; end $$; select 'POSTPONE CONCURRENCY ASSERTIONS PASSED';`), "Concurrent postpone assertions failed.");
      process.stdout.write(verified);
    }

    process.stdout.write(output);
    for (const [id, description] of [
      ["S01", "Initial assignment recipient and names"],
      ["S02", "Incoming/outgoing recipients and saved names"],
      ["S03", "Repeated preparation creates no duplicates"],
      ["S04", "Queue failure preserves history and recovers"],
      ["S05", "Browser role cannot access notification delivery work"],
    ]) {
      process.stdout.write(`PASS TC-SCRUM-155-${id}: ${description}\n`);
    }
    process.stdout.write("5/5 assignment notification SQL scenarios passed.\n");
    if (process.argv.includes("--venue-decision")) for (const [id, description] of [
      ["S01", "Confirmation reaches coordinator, requester and organiser with full detail"],
      ["S02", "Rejection reaches coordinator and requester only, with its reason"],
      ["S03", "A coordinator who made the request is notified once, with an empty note"],
      ["S04", "Every slot's final state is listed, including one cancelled earlier"],
      ["S05", "Cancelling a booking queues nothing"],
      ["S06", "Deciding twice queues no duplicate"],
      ["S07", "The authenticated role cannot read the queue"],
    ]) {
      process.stdout.write(`PASS TC-SCRUM-41-${id}: ${description}\n`);
    }
    if (process.argv.includes("--venue-decision")) {
      process.stdout.write("7/7 venue decision notification SQL scenarios passed.\n");
    }
    if (process.argv.includes("--postpone")) {
      for (const [id, description] of [
        ["01", "The assigned coordinator postpones; live slots and holds are released and history is written"],
        ["02", "The browser role and an unassigned coordinator change nothing"],
        ["04", "A missing or blank reason is refused before any write"],
        ["05", "The event's dates and details are kept"],
        ["06", "Postponing again changes and queues nothing"],
        ["07", "Two postpones at once: one wins, the other writes nothing"],
        ["08", "Rejected slots, expired holds and other events' rows are untouched"],
        ["09", "One notice each to the organiser and pending/confirmed attendees; no venue-lane notices"],
        ["10", "Only the six postponable stages can be postponed"],
        ["11", "A failure part-way saves nothing"],
        ["15", "With the assignment check off (the lead), a non-assigned actor postpones and is recorded"],
        ["20", "With a new date the event is POSTPONED on the new dates and the history keeps both"],
        ["21", "A booking that passed the new-date checks moves to the new date as pending"],
        ["22", "A booking that failed is released; a move naming another event's booking is ignored"],
        ["23", "Half a new date, or one in the past, is refused before any write"],
        ["24", "The notice names the new date"],
      ]) {
        process.stdout.write(`PASS TC-SCRUM-170-${id}: ${description}\n`);
      }
      process.stdout.write("16/16 postpone SQL scenarios passed.\n");
    }
  } finally {
    if (started) {
      requireSuccess(docker(["stop", "--time=1", name]), `Could not remove test container ${name}.`);
    }
  }
}

run().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

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

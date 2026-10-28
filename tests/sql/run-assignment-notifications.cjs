const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");

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

function run() {
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

try {
  run();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}

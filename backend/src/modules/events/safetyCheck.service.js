const { findMissingArrangements } = require("./safetyReadiness");

function createSafetyCheckService({ repository }) {
  async function readiness(eventId) {
    const missing = findMissingArrangements(await repository.findArrangements(eventId));
    return { ready: missing.length === 0, missing };
  }

  async function move(eventId, coordinatorId, from, to) {
    const event = await repository.transitionStatus(eventId, from, to, {}, coordinatorId);
    if (event) return { ok: true, event };

    const existing = await repository.findById(eventId);
    return { ok: false, reason: existing ? "conflict" : "not_found" };
  }

  // SCRUM-139 AC1/AC2: readiness is decided here on the server, never trusted
  // from the page, and an event that isn't ready is left untouched.
  async function submit(eventId, coordinatorId) {
    const event = await repository.findById(eventId);
    if (!event) return { ok: false, reason: "not_found" };
    if (event.status !== "APPROVED") return { ok: false, reason: "conflict" };

    const { ready, missing } = await readiness(eventId);
    if (!ready) return { ok: false, reason: "not_ready", missing };
    return move(eventId, coordinatorId, "APPROVED", "SAFETY_REVIEW");
  }

  // SCRUM-139 AC4: withdrawing reopens venue and equipment planning.
  async function withdraw(eventId, coordinatorId) {
    return move(eventId, coordinatorId, "SAFETY_REVIEW", "APPROVED");
  }

  return { readiness, submit, withdraw };
}

module.exports = { createSafetyCheckService };

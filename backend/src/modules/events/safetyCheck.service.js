const { checkArrangements } = require("./safetyReadiness");

// SCRUM-144 AC4: the flag can change while arrangements are open (planning) or
// awaiting confirmation; not under safety review (locked) or once confirmed.
const ESSENTIAL_EDITABLE = Object.freeze(["APPROVED", "PREPARATION"]);
const ARRANGEMENT_KINDS = Object.freeze(["venue", "equipment"]);

function createSafetyCheckService({ repository }) {
  async function readiness(eventId) {
    const { missing, optional } = checkArrangements(await repository.findArrangements(eventId));
    return { ready: missing.length === 0, missing, optional };
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

  // SCRUM-144 AC1-AC3: only after the safety pass (PREPARATION), and readiness is
  // re-checked here on the server; anything essential outstanding is a 409 with
  // the items, and nothing is written.
  async function confirm(eventId, coordinatorId) {
    const event = await repository.findById(eventId);
    if (!event) return { ok: false, reason: "not_found" };
    if (event.status !== "PREPARATION") return { ok: false, reason: "conflict" };

    const { ready, missing } = await readiness(eventId);
    if (!ready) return { ok: false, reason: "not_ready_to_confirm", missing };
    return move(eventId, coordinatorId, "PREPARATION", "CONFIRMED");
  }

  // SCRUM-144 AC4: the assigned coordinator decides (with Technical Support,
  // #106) whether an outstanding request is essential to this event.
  async function setEssential(eventId, kind, requestId, isEssential) {
    if (!ARRANGEMENT_KINDS.includes(kind) || typeof isEssential !== "boolean") return { ok: false, reason: "invalid_essential" };
    const event = await repository.findById(eventId);
    if (!event) return { ok: false, reason: "not_found" };
    if (!ESSENTIAL_EDITABLE.includes(event.status)) return { ok: false, reason: "essential_locked" };

    const arrangement = await repository.setArrangementEssential(kind, requestId, eventId, isEssential);
    if (!arrangement) return { ok: false, reason: "arrangement_not_found" };
    return { ok: true, arrangement };
  }

  return { readiness, submit, withdraw, confirm, setEssential };
}

module.exports = { createSafetyCheckService };

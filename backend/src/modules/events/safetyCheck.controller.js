const { createSafetyCheckService } = require("./safetyCheck.service");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FAILURES = Object.freeze({
  not_ready: [409, "This event is not ready for the safety check. Finish the arrangements listed."],
  not_ready_to_confirm: [409, "This event cannot be confirmed yet. Finish the essential arrangements listed."],
  invalid_essential: [400, "Choose whether this arrangement is essential."],
  essential_locked: [409, "Arrangements can only be marked while the event is in planning or preparation."],
  arrangement_not_found: [404, "That arrangement is not part of this event."],
  not_found: [404, "That event no longer exists."],
  conflict: [409, "This event has changed since you opened it. Refresh to see its current status."],
});

function createSafetyCheckController(repository) {
  const safetyCheck = createSafetyCheckService({ repository });

  function fail(res, action, error) {
    console.error(`/api/internal/events/:eventId/${action} failed:`, error.message);
    return res.status(500).json({ message: "Something went wrong. Please try again." });
  }

  // Identity comes from the verified token only; neither action reads a body.
  function handle(action, run) {
    return async (req, res) => {
      try {
        const result = await run(req.params.eventId, req.user.id);
        if (result.ok) return res.json({ event: result.event });
        const [status, message] = FAILURES[result.reason];
        return res.status(status).json(result.missing ? { message, missing: result.missing } : { message });
      } catch (error) {
        return fail(res, action, error);
      }
    };
  }

  async function readiness(req, res) {
    try {
      return res.json(await safetyCheck.readiness(req.params.eventId));
    } catch (error) {
      return fail(res, "safety-readiness", error);
    }
  }

  // SCRUM-144 AC4: the body carries only the flag; the event and request come from the path.
  async function setEssential(req, res) {
    if (!UUID_PATTERN.test(req.params.requestId)) {
      return res.status(400).json({ message: "That arrangement reference is not valid." });
    }
    try {
      const result = await safetyCheck.setEssential(req.params.eventId, req.params.kind, req.params.requestId, req.body?.is_essential);
      if (result.ok) return res.json({ arrangement: result.arrangement });
      const [status, message] = FAILURES[result.reason];
      return res.status(status).json({ message });
    } catch (error) {
      return fail(res, "arrangements/:kind/:requestId", error);
    }
  }

  return {
    readiness,
    submit: handle("submit-safety-check", safetyCheck.submit),
    withdraw: handle("withdraw-safety-check", safetyCheck.withdraw),
    confirm: handle("confirm", safetyCheck.confirm),
    setEssential,
  };
}

module.exports = createSafetyCheckController;

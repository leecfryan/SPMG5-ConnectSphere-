const { createSafetyCheckService } = require("./safetyCheck.service");

const FAILURES = Object.freeze({
  not_ready: [409, "This event is not ready for the safety check. Finish the arrangements listed."],
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

  return {
    readiness,
    submit: handle("submit-safety-check", safetyCheck.submit),
    withdraw: handle("withdraw-safety-check", safetyCheck.withdraw),
  };
}

module.exports = createSafetyCheckController;

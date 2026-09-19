const service = require("./events.service");

function createEventsController(repository) {
  return async function create(req, res) {
    if (!repository) {
      return res.status(503).json({ error: "Event submission is not configured. Please try again later." });
    }
    try {
      const result = await service.submitRequest(req.body, req.user.id, repository);
      if (!result.ok) return res.status(400).json({ errors: result.errors });
      return res.status(201).json({ event: result.event });
    } catch (error) {
      // The repository puts the Supabase message in here; it is for the log, not
      // for the organiser's screen.
      console.error("POST /api/events failed:", error.message);
      return res
        .status(500)
        .json({ error: "Could not submit the event request. Please try again." });
    }
  };
}

module.exports = createEventsController;

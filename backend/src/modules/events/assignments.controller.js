const service = require("./assignments.service");

const FAILURES = Object.freeze({
  invalid_coordinator: [400, "Choose an Event Coordinator to assign."],
  unknown_coordinator: [422, "That person is not an Event Coordinator."],
  not_found: [404, "That event request no longer exists."],
  conflict: [409, "This request was assigned by someone else. Refresh to see the current queue."],
});

function createAssignmentsController(dependencies) {
  const assignments = dependencies ? service.createAssignmentsService(dependencies) : undefined;

  function unconfigured(res) {
    return res.status(503).json({ message: "Coordinator assignment is not configured. Please try again later." });
  }

  function failed(res, action, error) {
    console.error(`${action} failed:`, error.message);
    return res.status(500).json({ message: "Something went wrong. Please try again." });
  }

  return {
    async listQueue(req, res) {
      if (!assignments) return unconfigured(res);
      try {
        const result = await assignments.listQueue();
        return res.json({ events: result.events });
      } catch (error) {
        return failed(res, "GET /api/internal/events/unassigned", error);
      }
    },

    async listCoordinators(req, res) {
      if (!assignments) return unconfigured(res);
      try {
        const result = await assignments.listCoordinators();
        return res.json({ coordinators: result.coordinators });
      } catch (error) {
        return failed(res, "GET /api/internal/coordinators", error);
      }
    },

    async assign(req, res) {
      if (!assignments) return unconfigured(res);
      try {
        const result = await assignments.assign(req.params.eventId, req.body?.coordinatorId);
        if (result.ok) return res.json({ event: result.event });
        const [status, message] = FAILURES[result.reason];
        return res.status(status).json({ message });
      } catch (error) {
        return failed(res, "PUT /api/internal/events/:eventId/coordinator", error);
      }
    },
  };
}

module.exports = createAssignmentsController;
